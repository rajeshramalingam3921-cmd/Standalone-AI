import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  assertTransition,
  type AiErrorCode,
  type AuditAction,
  type AuditActor,
  type AuditEvent,
  type ChangeSet,
  type ChangeSetStatus,
  type CommandName,
  type CommandRun,
  type CommandRunStatus,
  type ChatMessage,
  type ChatMessageStatus,
  type Conversation,
  type Project,
  type Task,
  type TaskStatus,
} from '@thiran/shared';
import * as schema from '../db/schema.js';
import {
  auditEvents,
  changeSets,
  chatMessages,
  commandRuns,
  conversations,
  owner,
  projects,
  sessions,
  tasks,
} from '../db/schema.js';
import { ConflictError, NotFoundError } from './errors.js';
import type { Data } from './json-file-store.js';
import type { NewProject, NewTask, ProjectPatch, SessionRecord, Store } from './types.js';

type Db = NodePgDatabase<typeof schema>;
type ProjectRow = typeof projects.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  techStack: r.techStack,
  workspacePath: r.workspacePath,
  commands: r.commands,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  projectId: r.projectId,
  title: r.title,
  description: r.description,
  status: r.status as TaskStatus,
  history: r.history,
  agent: r.agent ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toConversation = (r: typeof conversations.$inferSelect): Conversation => ({
  id: r.id,
  projectId: r.projectId,
  title: r.title,
  model: r.model,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toMessage = (r: typeof chatMessages.$inferSelect): ChatMessage => ({
  id: r.id,
  conversationId: r.conversationId,
  role: r.role as ChatMessage['role'],
  content: r.content,
  status: r.status as ChatMessageStatus,
  model: r.model,
  error: r.error as AiErrorCode | null,
  usage: r.usage ?? null,
  createdAt: r.createdAt.toISOString(),
});

const toChangeSet = (r: typeof changeSets.$inferSelect): ChangeSet => ({
  id: r.id,
  projectId: r.projectId,
  title: r.title,
  source: r.source as ChangeSet['source'],
  taskId: r.taskId,
  status: r.status as ChangeSetStatus,
  files: r.files,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

const toRun = (r: typeof commandRuns.$inferSelect): CommandRun => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name as CommandName,
  argv: r.argv,
  status: r.status as CommandRunStatus,
  exitCode: r.exitCode,
  output: r.output,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

const isForeignKeyViolation = (err: unknown) =>
  (err as { code?: string }).code === '23503' ||
  (err as { cause?: { code?: string } }).cause?.code === '23503';

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  ((err as { code?: string }).code === '23505' ||
    (err as { cause?: { code?: string } }).cause?.code === '23505');

export interface PostgresStoreOptions {
  pool: pg.Pool;
  now?: () => Date;
  newId?: () => string;
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export function createPostgresStore(opts: PostgresStoreOptions): Store {
  const { pool } = opts;
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? randomUUID;
  const db: Db = drizzle(pool, { schema });

  return {
    kind: 'postgres',

    async listProjects() {
      const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
      return rows.map(toProject);
    },

    async getProject(projectId) {
      const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
      return row && toProject(row);
    },

    async createProject(input: NewProject) {
      const at = now();
      try {
        const [row] = await db
          .insert(projects)
          .values({ ...input, id: newId(), createdAt: at, updatedAt: at })
          .returning();
        return toProject(row!);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ConflictError('A project with this name already exists.');
        throw err;
      }
    },

    async updateProject(projectId, patch: ProjectPatch) {
      try {
        const [row] = await db
          .update(projects)
          .set({ ...patch, updatedAt: now() })
          .where(eq(projects.id, projectId))
          .returning();
        if (!row) throw new NotFoundError('Project');
        return toProject(row);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ConflictError('A project with this name already exists.');
        throw err;
      }
    },

    async listTasks(projectId) {
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(desc(tasks.createdAt));
      return rows.map(toTask);
    },

    async getTask(projectId, taskId) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
      return row && toTask(row);
    },

    async createTask(projectId, input: NewTask) {
      const at = now();
      const iso = at.toISOString();
      return db.transaction(async (tx) => {
        const [p] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId));
        if (!p) throw new NotFoundError('Project');
        const [row] = await tx
          .insert(tasks)
          .values({
            ...input,
            id: newId(),
            projectId,
            status: 'draft',
            history: [{ from: null, to: 'draft', at: iso, by: 'user' }],
            agent: null,
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        return toTask(row!);
      });
    },

    async transitionTask(projectId, taskId, to, by) {
      return db.transaction(async (tx) => {
        // Row lock: concurrent transitions of the same task are serialized.
        const [row] = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
          .for('update');
        if (!row) throw new NotFoundError('Task');
        const from = row.status as TaskStatus;
        assertTransition(from, to);
        const at = now();
        const [updated] = await tx
          .update(tasks)
          .set({
            status: to,
            history: [...row.history, { from, to, at: at.toISOString(), by }],
            updatedAt: at,
          })
          .where(eq(tasks.id, taskId))
          .returning();
        return toTask(updated!);
      });
    },

    async setTaskAgent(projectId, taskId, agent) {
      const [row] = await db
        .update(tasks)
        .set({ agent, updatedAt: now() })
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
        .returning();
      if (!row) throw new NotFoundError('Task');
      return toTask(row);
    },

    async listActiveAgentTasks() {
      const rows = await db
        .select()
        .from(tasks)
        .where(sql`${tasks.agent}->>'phase' IN ('planning', 'executing', 'verifying')`);
      return rows.map(toTask);
    },

    async listConversations(projectId) {
      const rows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, projectId))
        .orderBy(desc(conversations.updatedAt));
      return rows.map(toConversation);
    },

    async getConversation(projectId, conversationId) {
      const [row] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
      return row && toConversation(row);
    },

    async createConversation(projectId, input) {
      const at = now();
      try {
        const [row] = await db
          .insert(conversations)
          .values({ ...input, id: newId(), projectId, createdAt: at, updatedAt: at })
          .returning();
        return toConversation(row!);
      } catch (err) {
        if (isForeignKeyViolation(err)) throw new NotFoundError('Project');
        throw err;
      }
    },

    async touchConversation(projectId, conversationId, title) {
      const res = await db
        .update(conversations)
        .set({ updatedAt: now(), ...(title !== undefined && { title }) })
        .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
      if (!res.rowCount) throw new NotFoundError('Conversation');
    },

    async listMessages(conversationId) {
      const rows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .orderBy(asc(chatMessages.createdAt));
      return rows.map(toMessage);
    },

    async addMessage(message) {
      try {
        const [row] = await db
          .insert(chatMessages)
          .values({
            id: message.id,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content,
            status: message.status,
            model: message.model,
            error: message.error,
            usage: message.usage,
            createdAt: message.createdAt ? new Date(message.createdAt) : now(),
          })
          .returning();
        return toMessage(row!);
      } catch (err) {
        if (isForeignKeyViolation(err)) throw new NotFoundError('Conversation');
        throw err;
      }
    },

    async createChangeSet(cs: ChangeSet) {
      try {
        const [row] = await db
          .insert(changeSets)
          .values({
            ...cs,
            createdAt: new Date(cs.createdAt),
            decidedAt: cs.decidedAt ? new Date(cs.decidedAt) : null,
          })
          .returning();
        return toChangeSet(row!);
      } catch (err) {
        if (isForeignKeyViolation(err)) throw new NotFoundError('Project');
        throw err;
      }
    },

    async getChangeSet(projectId, id) {
      const [row] = await db
        .select()
        .from(changeSets)
        .where(and(eq(changeSets.id, id), eq(changeSets.projectId, projectId)));
      return row && toChangeSet(row);
    },

    async listChangeSets(projectId, limit = 50) {
      const rows = await db
        .select()
        .from(changeSets)
        .where(eq(changeSets.projectId, projectId))
        .orderBy(desc(changeSets.createdAt))
        .limit(limit);
      return rows.map(toChangeSet);
    },

    async setChangeSetStatus(projectId, id, from, to, at) {
      // Conditional update: only one concurrent caller can win the transition.
      const res = await db
        .update(changeSets)
        .set({ status: to, decidedAt: new Date(at) })
        .where(
          and(
            eq(changeSets.id, id),
            eq(changeSets.projectId, projectId),
            eq(changeSets.status, from),
          ),
        );
      return (res.rowCount ?? 0) > 0;
    },

    async createRun(run: CommandRun) {
      try {
        const [row] = await db
          .insert(commandRuns)
          .values({
            ...run,
            startedAt: new Date(run.startedAt),
            finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
          })
          .returning();
        return toRun(row!);
      } catch (err) {
        if (isForeignKeyViolation(err)) throw new NotFoundError('Project');
        throw err;
      }
    },

    async updateRun(projectId, runId, patch) {
      const res = await db
        .update(commandRuns)
        .set({
          status: patch.status,
          exitCode: patch.exitCode,
          output: patch.output,
          finishedAt: patch.finishedAt ? new Date(patch.finishedAt) : null,
        })
        .where(and(eq(commandRuns.id, runId), eq(commandRuns.projectId, projectId)));
      if (!res.rowCount) throw new NotFoundError('Run');
    },

    async getRun(projectId, runId) {
      const [row] = await db
        .select()
        .from(commandRuns)
        .where(and(eq(commandRuns.id, runId), eq(commandRuns.projectId, projectId)));
      return row && toRun(row);
    },

    async listRuns(projectId, limit = 20) {
      const rows = await db
        .select()
        .from(commandRuns)
        .where(eq(commandRuns.projectId, projectId))
        .orderBy(desc(commandRuns.startedAt))
        .limit(limit);
      return rows.map(toRun);
    },

    async failInterruptedRuns(at) {
      const res = await db
        .update(commandRuns)
        .set({
          status: 'error',
          finishedAt: new Date(at),
          output: sql`${commandRuns.output} || E'\\n[Server restarted while this command was running]'`,
        })
        .where(eq(commandRuns.status, 'running'));
      return res.rowCount ?? 0;
    },

    async appendAudit(e: AuditEvent) {
      await db.insert(auditEvents).values({ ...e, at: new Date(e.at) });
    },

    async listAudit({ projectId, limit, before }) {
      const conds = [
        projectId ? eq(auditEvents.projectId, projectId) : undefined,
        before ? lt(auditEvents.at, new Date(before)) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(auditEvents)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditEvents.at))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        actor: r.actor as AuditActor,
        action: r.action as AuditAction,
        projectId: r.projectId,
        targetType: r.targetType,
        targetId: r.targetId,
        detail: r.detail,
      }));
    },

    async getOwnerPasswordHash() {
      const [row] = await db.select().from(owner).where(eq(owner.id, 1));
      return row?.passwordHash;
    },

    async setOwnerPasswordHash(hash) {
      const at = now();
      await db.transaction(async (tx) => {
        await tx
          .insert(owner)
          .values({ id: 1, passwordHash: hash, updatedAt: at })
          .onConflictDoUpdate({ target: owner.id, set: { passwordHash: hash, updatedAt: at } });
        await tx.delete(sessions);
      });
    },

    async createSession(s: SessionRecord) {
      await db.insert(sessions).values({
        tokenHash: s.tokenHash,
        createdAt: new Date(s.createdAt),
        expiresAt: new Date(s.expiresAt),
      });
    },

    async getSession(tokenHash) {
      const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
      return (
        row && {
          tokenHash: row.tokenHash,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        }
      );
    },

    async deleteSession(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteExpiredSessions(at) {
      const res = await db.delete(sessions).where(lte(sessions.expiresAt, at));
      return res.rowCount ?? 0;
    },

    async close() {
      await pool.end();
    },
  };
}

/**
 * Copy a validated JSON-store snapshot into an EMPTY database in one transaction.
 * Refuses to run if any project already exists — it never merges or overwrites.
 */
export async function importSnapshot(
  pool: pg.Pool,
  data: Data,
): Promise<{ projects: number; tasks: number }> {
  const db: Db = drizzle(pool, { schema });
  return db.transaction(async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(projects);
    if (n > 0)
      throw new ConflictError('Target database already contains projects; import refused.');
    const ordered = [...data.projects].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const p of ordered) {
      await tx.insert(projects).values({
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      });
    }
    for (const t of [...data.tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      await tx.insert(tasks).values({
        ...t,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      });
    }
    for (const c of data.conversations) {
      await tx.insert(conversations).values({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      });
    }
    for (const m of data.messages) {
      await tx.insert(chatMessages).values({ ...m, createdAt: new Date(m.createdAt) });
    }
    for (const c of data.changeSets) {
      await tx.insert(changeSets).values({
        ...c,
        createdAt: new Date(c.createdAt),
        decidedAt: c.decidedAt ? new Date(c.decidedAt) : null,
      });
    }
    for (const r of data.runs) {
      await tx.insert(commandRuns).values({
        ...r,
        startedAt: new Date(r.startedAt),
        finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
      });
    }
    for (const e of data.audit) {
      await tx.insert(auditEvents).values({ ...e, at: new Date(e.at) });
    }
    if (data.owner) {
      await tx
        .insert(owner)
        .values({ id: 1, passwordHash: data.owner.passwordHash, updatedAt: new Date() })
        .onConflictDoUpdate({ target: owner.id, set: { passwordHash: data.owner.passwordHash } });
    }
    return { projects: data.projects.length, tasks: data.tasks.length };
  });
}
