import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { InvalidTransitionError } from '@thiran/shared';
import { applyMigrations, pendingMigrations } from '../src/db/migrations.js';
import { ConflictError, NotFoundError } from '../src/store/errors.js';
import { createJsonFileStore } from '../src/store/json-file-store.js';
import { createPool, createPostgresStore, importSnapshot } from '../src/store/postgres-store.js';
import type { Store } from '../src/store/types.js';

/**
 * Every Store implementation must pass the same behavioural contract.
 * PostgreSQL runs only when TEST_DATABASE_URL points at a disposable database.
 */
const PG_URL = process.env.TEST_DATABASE_URL;

let pool: pg.Pool | undefined;
beforeAll(async () => {
  if (!PG_URL) return;
  pool = createPool(PG_URL);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  expect((await pendingMigrations(pool)).length).toBeGreaterThan(0);
  await applyMigrations(pool);
  expect(await pendingMigrations(pool)).toEqual([]);
});
afterAll(async () => {
  await pool?.end();
});

async function resetPg() {
  await pool!.query('TRUNCATE chat_messages, conversations, tasks, projects, sessions, owner');
}

const impls: [string, () => Promise<Store>][] = [
  ['json', () => createJsonFileStore({ file: null })],
];
if (PG_URL) {
  impls.push([
    'postgres',
    async () => {
      await resetPg();
      // Pool is shared across tests; close() must not end it here.
      return { ...createPostgresStore({ pool: pool! }), close: async () => {} };
    },
  ]);
}

const project = (name: string) => ({
  name,
  description: '',
  techStack: ['React'],
  workspacePath: '',
});

describe.each(impls)('Store contract: %s', (_name, make) => {
  let s: Store;
  beforeEach(async () => {
    s = await make();
  });

  it('creates and reads projects, newest first', async () => {
    const a = await s.createProject(project('A'));
    await new Promise((r) => setTimeout(r, 5));
    const b = await s.createProject(project('B'));
    expect(await s.getProject(a.id)).toEqual(a);
    expect((await s.listProjects()).map((p) => p.id)).toEqual([b.id, a.id]);
    expect(a.techStack).toEqual(['React']);
  });

  it('rejects duplicate project names case-insensitively', async () => {
    await s.createProject(project('Inventory'));
    await expect(s.createProject(project('inventory'))).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns undefined for unknown ids', async () => {
    expect(await s.getProject('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('refuses tasks for unknown projects', async () => {
    await expect(
      s.createTask('00000000-0000-4000-8000-000000000000', { title: 'x', description: '' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps tasks isolated per project', async () => {
    const a = await s.createProject(project('A'));
    const b = await s.createProject(project('B'));
    const t = await s.createTask(a.id, { title: 'only in A', description: '' });
    expect(t.status).toBe('draft');
    expect(await s.listTasks(b.id)).toEqual([]);
    expect(await s.getTask(b.id, t.id)).toBeUndefined();
    await expect(s.transitionTask(b.id, t.id, 'cancelled', 'user')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('enforces the state machine and records history', async () => {
    const p = await s.createProject(project('P'));
    const t = await s.createTask(p.id, { title: 'x', description: '' });
    await expect(s.transitionTask(p.id, t.id, 'completed', 'user')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    const done = await s.transitionTask(p.id, t.id, 'cancelled', 'user');
    expect(done.status).toBe('cancelled');
    expect(done.history.map((h) => h.to)).toEqual(['draft', 'cancelled']);
    expect(await s.getTask(p.id, t.id)).toEqual(done);
  });

  it('serializes concurrent transitions of one task (only one wins)', async () => {
    const p = await s.createProject(project('P'));
    const t = await s.createTask(p.id, { title: 'x', description: '' });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => s.transitionTask(p.id, t.id, 'cancelled', 'user')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await s.getTask(p.id, t.id))?.history).toHaveLength(2);
  });

  it('stores conversations and messages, scoped per project', async () => {
    const a = await s.createProject(project('A'));
    const b = await s.createProject(project('B'));
    const c = await s.createConversation(a.id, { title: '', model: 'claude-opus-5-5' });
    expect(await s.getConversation(b.id, c.id)).toBeUndefined();
    expect(await s.listConversations(b.id)).toEqual([]);
    await expect(s.touchConversation(b.id, c.id, 'x')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      s.createConversation('00000000-0000-4000-8000-000000000000', { title: '', model: 'm' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const base = { conversationId: c.id, model: null, error: null, usage: null } as const;
    const u = await s.addMessage({
      ...base,
      id: '11111111-1111-4111-8111-111111111111',
      role: 'user',
      content: 'வணக்கம்',
      status: 'complete',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await s.addMessage({
      ...base,
      id: '22222222-2222-4222-8222-222222222222',
      role: 'assistant',
      content: 'partial',
      status: 'error',
      error: 'rate_limited',
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1, outputTokens: 2 },
      createdAt: '2026-01-01T00:00:01.000Z',
    });
    const msgs = await s.listMessages(c.id);
    expect(msgs[0]).toEqual(u);
    expect(msgs[1]).toMatchObject({
      status: 'error',
      error: 'rate_limited',
      usage: { inputTokens: 1, outputTokens: 2 },
    });

    await new Promise((r) => setTimeout(r, 5));
    await s.touchConversation(a.id, c.id, 'New title');
    const [updated] = await s.listConversations(a.id);
    expect(updated!.title).toBe('New title');
    expect(updated!.updatedAt > c.updatedAt).toBe(true);
    await expect(
      s.addMessage({
        ...base,
        conversationId: '00000000-0000-4000-8000-000000000000',
        id: '33333333-3333-4333-8333-333333333333',
        role: 'user',
        content: 'x',
        status: 'complete',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('manages owner password and sessions', async () => {
    expect(await s.getOwnerPasswordHash()).toBeUndefined();
    await s.setOwnerPasswordHash('scrypt$hash1');
    const h = 'a'.repeat(64);
    await s.createSession({
      tokenHash: h,
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-02-01T00:00:00.000Z',
    });
    expect((await s.getSession(h))?.expiresAt).toBe('2026-02-01T00:00:00.000Z');

    await s.setOwnerPasswordHash('scrypt$hash2'); // signs everyone out
    expect(await s.getOwnerPasswordHash()).toBe('scrypt$hash2');
    expect(await s.getSession(h)).toBeUndefined();
  });

  it('deletes sessions and expired sessions', async () => {
    const mk = (c: string, exp: string) =>
      s.createSession({
        tokenHash: c.repeat(64),
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: exp,
      });
    await mk('a', '2026-01-02T00:00:00.000Z');
    await mk('b', '2026-03-01T00:00:00.000Z');
    await mk('c', '2026-03-01T00:00:00.000Z');
    expect(await s.deleteExpiredSessions(new Date('2026-02-01T00:00:00Z'))).toBe(1);
    await s.deleteSession('b'.repeat(64));
    expect(await s.getSession('a'.repeat(64))).toBeUndefined();
    expect(await s.getSession('b'.repeat(64))).toBeUndefined();
    expect(await s.getSession('c'.repeat(64))).toBeDefined();
  });
});

describe.runIf(PG_URL)('JSON → PostgreSQL import', () => {
  beforeEach(resetPg);

  it('copies projects, tasks and owner into an empty database', async () => {
    const src = await createJsonFileStore({ file: null });
    const p = await src.createProject(project('POS'));
    const t = await src.createTask(p.id, { title: 'Billing', description: 'd' });
    await src.transitionTask(p.id, t.id, 'cancelled', 'user');
    await src.setOwnerPasswordHash('scrypt$owner');

    const snapshot = {
      version: 1 as const,
      projects: await src.listProjects(),
      tasks: await src.listTasks(p.id),
      owner: { passwordHash: 'scrypt$owner' },
      sessions: [],
      conversations: [],
      messages: [],
    };
    expect(await importSnapshot(pool!, snapshot)).toEqual({ projects: 1, tasks: 1 });

    const dst = createPostgresStore({ pool: pool! });
    expect(await dst.getProject(p.id)).toEqual(await src.getProject(p.id));
    expect(await dst.getTask(p.id, t.id)).toEqual(await src.getTask(p.id, t.id));
    expect(await dst.getOwnerPasswordHash()).toBe('scrypt$owner');
  });

  it('refuses to import into a non-empty database', async () => {
    await createPostgresStore({ pool: pool! }).createProject(project('Existing'));
    await expect(
      importSnapshot(pool!, {
        version: 1,
        projects: [],
        tasks: [],
        owner: null,
        sessions: [],
        conversations: [],
        messages: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
