import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AI_ERROR_CODES,
  ProjectSchema,
  TaskSchema,
  assertTransition,
  type ChangeSet,
  type ChatMessage,
  type CommandRun,
  type Conversation,
  type Project,
  type Task,
} from '@thiran/shared';
import { z } from 'zod';
import { ConflictError, NotFoundError, StoreCorruptError } from './errors.js';
import type { NewProject, NewTask, ProjectPatch, SessionRecord, Store } from './types.js';

const SessionSchema = z.object({
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

const ConversationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  model: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const ChatMessageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['complete', 'truncated', 'refused', 'stopped', 'error']),
  model: z.string().nullable(),
  error: z.enum(AI_ERROR_CODES).nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  createdAt: z.iso.datetime(),
});

const ChangeSetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  source: z.enum(['user', 'agent']),
  status: z.enum(['pending', 'applied', 'rejected', 'reverted']),
  files: z.array(
    z.object({
      path: z.string(),
      action: z.enum(['create', 'modify']),
      baseSha256: z.string().nullable(),
      originalContent: z.string().nullable(),
      newContent: z.string(),
      newSha256: z.string(),
    }),
  ),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});

const CommandRunSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.enum(['build', 'test', 'lint']),
  argv: z.array(z.string()),
  status: z.enum(['running', 'passed', 'failed', 'timeout', 'error']),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

export const DataSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
  tasks: z.array(TaskSchema),
  // Added in Phase 4; defaults keep Phase 3 files readable.
  owner: z
    .object({ passwordHash: z.string().min(1) })
    .nullable()
    .default(null),
  sessions: z.array(SessionSchema).default([]),
  // Added in Phase 5.
  conversations: z.array(ConversationSchema).default([]),
  messages: z.array(ChatMessageSchema).default([]),
  // Added in Phase 6.
  changeSets: z.array(ChangeSetSchema).default([]),
  runs: z.array(CommandRunSchema).default([]),
});
export type Data = z.output<typeof DataSchema>;

export interface JsonFileStoreOptions {
  /** File to persist to. `null` keeps data in memory only (tests). */
  file: string | null;
  now?: () => Date;
  newId?: () => string;
}

const empty = (): Data => ({
  version: 1,
  projects: [],
  tasks: [],
  owner: null,
  sessions: [],
  conversations: [],
  messages: [],
  changeSets: [],
  runs: [],
});

/** Read and validate a data file. Missing file → empty data. Invalid → StoreCorruptError. */
export async function readJsonData(file: string | null): Promise<Data> {
  if (!file) return empty();
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw new StoreCorruptError(file, (err as Error).message);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new StoreCorruptError(file, 'not valid JSON');
  }
  const parsed = DataSchema.safeParse(json);
  if (!parsed.success) throw new StoreCorruptError(file, 'schema mismatch');
  return parsed.data;
}

export async function createJsonFileStore(opts: JsonFileStoreOptions): Promise<Store> {
  const { file } = opts;
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? randomUUID;
  let data = await readJsonData(file);

  // Serialize every mutation so concurrent requests cannot interleave writes.
  let queue: Promise<unknown> = Promise.resolve();
  function mutate<T>(fn: (draft: Data) => T): Promise<T> {
    const run = queue.then(async () => {
      const draft = structuredClone(data);
      const result = fn(draft);
      await persist(draft);
      data = draft; // commit to memory only after the write succeeded
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function persist(next: Data): Promise<void> {
    if (!file) return;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, file); // atomic replace: a crash never leaves a half-written file
  }

  const byNewest = <T extends { createdAt: string }>(a: T, b: T) =>
    b.createdAt.localeCompare(a.createdAt);

  return {
    kind: 'json',

    // Reads return copies so callers can never mutate stored state directly.
    async listProjects() {
      return structuredClone(data.projects).sort(byNewest);
    },

    async getProject(projectId) {
      const p = data.projects.find((x) => x.id === projectId);
      return p && structuredClone(p);
    },

    createProject(input: NewProject) {
      return mutate((d) => {
        const key = input.name.toLocaleLowerCase();
        if (d.projects.some((p) => p.name.toLocaleLowerCase() === key)) {
          throw new ConflictError('A project with this name already exists.');
        }
        const ts = now().toISOString();
        const project: Project = { ...input, id: newId(), createdAt: ts, updatedAt: ts };
        d.projects.push(project);
        return structuredClone(project);
      });
    },

    updateProject(projectId, patch: ProjectPatch) {
      return mutate((d) => {
        const p = d.projects.find((x) => x.id === projectId);
        if (!p) throw new NotFoundError('Project');
        if (patch.name !== undefined) {
          const key = patch.name.toLocaleLowerCase();
          if (d.projects.some((x) => x.id !== projectId && x.name.toLocaleLowerCase() === key)) {
            throw new ConflictError('A project with this name already exists.');
          }
        }
        Object.assign(p, patch, { updatedAt: now().toISOString() });
        return structuredClone(p);
      });
    },

    async listTasks(projectId) {
      return structuredClone(data.tasks.filter((t) => t.projectId === projectId)).sort(byNewest);
    },

    async getTask(projectId, taskId) {
      const t = data.tasks.find((x) => x.id === taskId && x.projectId === projectId);
      return t && structuredClone(t);
    },

    createTask(projectId, input: NewTask) {
      return mutate((d) => {
        if (!d.projects.some((p) => p.id === projectId)) throw new NotFoundError('Project');
        const ts = now().toISOString();
        const task: Task = {
          ...input,
          id: newId(),
          projectId,
          status: 'draft',
          history: [{ from: null, to: 'draft', at: ts, by: 'user' }],
          createdAt: ts,
          updatedAt: ts,
        };
        d.tasks.push(task);
        return structuredClone(task);
      });
    },

    transitionTask(projectId, taskId, to, by) {
      return mutate((d) => {
        const task = d.tasks.find((t) => t.id === taskId && t.projectId === projectId);
        if (!task) throw new NotFoundError('Task');
        assertTransition(task.status, to);
        const ts = now().toISOString();
        task.history.push({ from: task.status, to, at: ts, by });
        task.status = to;
        task.updatedAt = ts;
        return structuredClone(task);
      });
    },

    async listConversations(projectId) {
      return structuredClone(data.conversations.filter((c) => c.projectId === projectId)).sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      );
    },

    async getConversation(projectId, conversationId) {
      const c = data.conversations.find(
        (x) => x.id === conversationId && x.projectId === projectId,
      );
      return c && structuredClone(c);
    },

    createConversation(projectId, input) {
      return mutate((d) => {
        if (!d.projects.some((p) => p.id === projectId)) throw new NotFoundError('Project');
        const ts = now().toISOString();
        const c: Conversation = { ...input, id: newId(), projectId, createdAt: ts, updatedAt: ts };
        d.conversations.push(c);
        return structuredClone(c);
      });
    },

    touchConversation(projectId, conversationId, title) {
      return mutate((d) => {
        const c = d.conversations.find((x) => x.id === conversationId && x.projectId === projectId);
        if (!c) throw new NotFoundError('Conversation');
        c.updatedAt = now().toISOString();
        if (title !== undefined) c.title = title;
      });
    },

    async listMessages(conversationId) {
      return structuredClone(data.messages.filter((m) => m.conversationId === conversationId));
    },

    addMessage(message) {
      return mutate((d) => {
        if (!d.conversations.some((c) => c.id === message.conversationId)) {
          throw new NotFoundError('Conversation');
        }
        const m: ChatMessage = { ...message, createdAt: message.createdAt ?? now().toISOString() };
        d.messages.push(m);
        return structuredClone(m);
      });
    },

    createChangeSet(cs: ChangeSet) {
      return mutate((d) => {
        if (!d.projects.some((p) => p.id === cs.projectId)) throw new NotFoundError('Project');
        d.changeSets.push(structuredClone(cs));
        return structuredClone(cs);
      });
    },

    async getChangeSet(projectId, id) {
      const c = data.changeSets.find((x) => x.id === id && x.projectId === projectId);
      return c && structuredClone(c);
    },

    async listChangeSets(projectId, limit = 50) {
      return structuredClone(
        data.changeSets
          .filter((c) => c.projectId === projectId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit),
      );
    },

    setChangeSetStatus(projectId, id, from, to, at) {
      return mutate((d) => {
        const c = d.changeSets.find((x) => x.id === id && x.projectId === projectId);
        if (!c || c.status !== from) return false;
        c.status = to;
        c.decidedAt = at;
        return true;
      });
    },

    createRun(run: CommandRun) {
      return mutate((d) => {
        if (!d.projects.some((p) => p.id === run.projectId)) throw new NotFoundError('Project');
        d.runs.push(structuredClone(run));
        return structuredClone(run);
      });
    },

    updateRun(projectId, runId, patch) {
      return mutate((d) => {
        const r = d.runs.find((x) => x.id === runId && x.projectId === projectId);
        if (!r) throw new NotFoundError('Run');
        Object.assign(r, patch);
      });
    },

    async getRun(projectId, runId) {
      const r = data.runs.find((x) => x.id === runId && x.projectId === projectId);
      return r && structuredClone(r);
    },

    async listRuns(projectId, limit = 20) {
      return structuredClone(
        data.runs
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, limit),
      );
    },

    failInterruptedRuns(at) {
      if (!data.runs.some((r) => r.status === 'running')) return Promise.resolve(0);
      return mutate((d) => {
        let n = 0;
        for (const r of d.runs) {
          if (r.status === 'running') {
            r.status = 'error';
            r.finishedAt = at;
            r.output += '\n[Server restarted while this command was running]';
            n++;
          }
        }
        return n;
      });
    },

    async getOwnerPasswordHash() {
      return data.owner?.passwordHash;
    },

    setOwnerPasswordHash(hash) {
      return mutate((d) => {
        d.owner = { passwordHash: hash };
        d.sessions = [];
      });
    },

    createSession(session: SessionRecord) {
      return mutate((d) => {
        d.sessions.push({ ...session });
      });
    },

    async getSession(tokenHash) {
      const s = data.sessions.find((x) => x.tokenHash === tokenHash);
      return s && { ...s };
    },

    deleteSession(tokenHash) {
      return mutate((d) => {
        d.sessions = d.sessions.filter((x) => x.tokenHash !== tokenHash);
      });
    },

    deleteExpiredSessions(at) {
      const nowIso = at.toISOString();
      if (!data.sessions.some((x) => x.expiresAt <= nowIso)) return Promise.resolve(0);
      return mutate((d) => {
        const before = d.sessions.length;
        d.sessions = d.sessions.filter((x) => x.expiresAt > nowIso);
        return before - d.sessions.length;
      });
    },

    async close() {
      await queue;
    },
  };
}
