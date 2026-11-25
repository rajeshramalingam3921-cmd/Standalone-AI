import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  assertTransition,
  type AiErrorCode,
  type ChatMessage,
  type ChatMessageStatus,
  type Conversation,
  type Project,
  type Task,
  type TaskStatus,
} from '@thiran/shared';
import * as schema from '../db/schema.js';
import { chatMessages, conversations, owner, projects, sessions, tasks } from '../db/schema.js';
import { ConflictError, NotFoundError } from './errors.js';
import type { Data } from './json-file-store.js';
import type { NewProject, NewTask, SessionRecord, Store } from './types.js';

type Db = NodePgDatabase<typeof schema>;
type ProjectRow = typeof projects.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  techStack: r.techStack,
  workspacePath: r.workspacePath,
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
    if (data.owner) {
      await tx
        .insert(owner)
        .values({ id: 1, passwordHash: data.owner.passwordHash, updatedAt: new Date() })
        .onConflictDoUpdate({ target: owner.id, set: { passwordHash: data.owner.passwordHash } });
    }
    return { projects: data.projects.length, tasks: data.tasks.length };
  });
}
