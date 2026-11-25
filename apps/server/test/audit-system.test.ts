import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent, ChangeSetView, Project, SystemStatus, Task } from '@thiran/shared';
import { createMockProvider } from '../src/ai/mock.js';
import { createBackup, latestBackup, restoreJsonBackup } from '../src/backup.js';
import { loadConfig } from '../src/config.js';
import { createJsonFileStore } from '../src/store/json-file-store.js';
import { makeTestApp, type TestApp } from './helpers.js';

let base: string;
let proj: string;
let t: TestApp | undefined;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'thiran-audit-'));
  proj = join(base, 'roots', 'pos');
  await mkdir(join(proj, 'src'), { recursive: true });
  await writeFile(join(proj, 'src', 'a.js'), 'module.exports = 1;\n');
});
afterEach(async () => {
  await t?.app.agent.idle();
  await t?.app.close();
  t = undefined;
  await rm(base, { recursive: true, force: true });
});

const node = process.execPath;
async function setup(env: Record<string, string> = {}) {
  t = await makeTestApp({
    provider: createMockProvider({ delayMs: 0 }),
    env: { WORKSPACE_ROOTS: join(base, 'roots'), BACKUP_DIR: join(base, 'backups'), ...env },
  });
  return t;
}
const audit = async (q = '') => (await t!.get(`/api/audit${q}`, t!.cookie)).json<AuditEvent[]>();

describe('audit trail', () => {
  it('records sign-in, failed sign-in and logout without secrets', async () => {
    await setup();
    await t!.post('/api/auth/login', { password: 'wrong-password-123' });
    const events = await audit();
    expect(events.map((e) => e.action)).toEqual(['auth.login_failed', 'auth.login']);
    expect(JSON.stringify(events)).not.toContain('wrong-password-123');
    await t!.post('/api/auth/logout', {}, t!.cookie);
    // Logged out now; sign in again to read.
    const { TEST_PASSWORD } = await import('./helpers.js');
    const res = await t!.post('/api/auth/login', { password: TEST_PASSWORD });
    const cookie = `thiran_session=${res.cookies.find((c) => c.name === 'thiran_session')!.value}`;
    const all = (await t!.get('/api/audit', cookie)).json<AuditEvent[]>();
    expect(all.map((e) => e.action).slice(0, 2)).toEqual(['auth.login', 'auth.logout']);
  });

  it('records project, task, change and command events — never file contents', async () => {
    await setup();
    const p = (
      await t!.post('/api/projects', { name: 'POS', workspacePath: proj }, t!.cookie)
    ).json<Project>();
    await t!.app.inject({
      method: 'PATCH',
      url: `/api/projects/${p.id}`,
      headers: { cookie: t!.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ commands: { test: [node, '-e', 'process.exit(0)'] } }),
    });
    const task = (
      await t!.post(`/api/projects/${p.id}/tasks`, { title: 'X' }, t!.cookie)
    ).json<Task>();
    await t!.post(
      `/api/projects/${p.id}/tasks/${task.id}/actions`,
      { action: 'cancel' },
      t!.cookie,
    );

    const cs = (
      await t!.post(
        `/api/projects/${p.id}/changes`,
        { title: 'edit', files: [{ path: 'src/a.js', content: 'TOP_SECRET_CONTENT\n' }] },
        t!.cookie,
      )
    ).json<ChangeSetView>();
    await t!.post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {}, t!.cookie);
    await t!.post(`/api/projects/${p.id}/changes/${cs.id}/revert`, {}, t!.cookie);
    const cs2 = (
      await t!.post(
        `/api/projects/${p.id}/changes`,
        { title: 'e2', files: [{ path: 'src/a.js', content: 'v2\n' }] },
        t!.cookie,
      )
    ).json<ChangeSetView>();
    await writeFile(join(proj, 'src', 'a.js'), 'hand edit\n');
    await t!.post(`/api/projects/${p.id}/changes/${cs2.id}/apply`, {}, t!.cookie); // conflict
    await t!.post(`/api/projects/${p.id}/changes/${cs2.id}/reject`, {}, t!.cookie);
    const run = (await t!.post(`/api/projects/${p.id}/runs`, { name: 'test' }, t!.cookie)).json();
    for (
      let i = 0;
      i < 100 &&
      (await t!.get(`/api/projects/${p.id}/runs/${run.id}`, t!.cookie)).json().status === 'running';
      i++
    ) {
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 50));

    const events = (await audit(`?projectId=${p.id}`)).reverse();
    expect(events.map((e) => e.action)).toEqual([
      'project.created',
      'project.updated',
      'task.created',
      'task.action',
      'change.created',
      'change.applied',
      'change.reverted',
      'change.created',
      'change.conflict',
      'change.rejected',
      'command.started',
      'command.finished',
    ]);
    expect(events[1]!.detail.commands).toEqual([`test: ${node} -e process.exit(0)`]);
    expect(events[3]!.detail).toMatchObject({ action: 'cancel', from: 'draft', to: 'cancelled' });
    expect(events[8]!.detail).toMatchObject({ attempted: 'apply', paths: ['src/a.js'] });
    expect(events.at(-1)!.detail).toMatchObject({ name: 'test', status: 'passed', exitCode: 0 });
    expect(events.every((e) => e.actor === 'owner')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('TOP_SECRET_CONTENT');
  });

  it('records the agent’s own steps as actor "agent"/"system"', async () => {
    await setup();
    const p = (
      await t!.post(
        '/api/projects',
        { name: 'POS', workspacePath: proj, commands: { test: [node, '-e', 'process.exit(0)'] } },
        t!.cookie,
      )
    ).json<Project>();
    const task = (
      await t!.post(`/api/projects/${p.id}/tasks`, { title: 'X' }, t!.cookie)
    ).json<Task>();
    const act = (action: string) =>
      t!.post(`/api/projects/${p.id}/tasks/${task.id}/actions`, { action }, t!.cookie);
    const wait = async (pred: (x: Task) => boolean) => {
      for (let i = 0; i < 200; i++) {
        await t!.app.agent.idle();
        const cur = (await t!.get(`/api/projects/${p.id}/tasks`, t!.cookie)).json<Task[]>()[0]!;
        if (pred(cur)) return cur;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('timeout');
    };
    await act('plan');
    await wait((x) => x.status === 'awaiting_approval');
    await act('approve');
    const proposed = await wait((x) => x.agent?.phase === 'awaiting_diff');
    await t!.post(
      `/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}/apply`,
      {},
      t!.cookie,
    );
    await wait((x) => x.status === 'completed');
    const events = (await audit(`?projectId=${p.id}`)).reverse();
    const agentSide = events
      .filter((e) => e.actor !== 'owner')
      .map((e) => `${e.actor}:${e.action}`);
    expect(agentSide).toEqual([
      'agent:agent.plan_ready',
      'agent:agent.change_proposed',
      'system:command.finished',
      'agent:agent.finished',
    ]);
    expect(events.at(-1)!.detail.outcome).toBe('completed');
  });

  it('pages with "before", filters by project, validates input and requires sign-in', async () => {
    await setup();
    for (let i = 0; i < 5; i++) await t!.post('/api/projects', { name: `P${i}` }, t!.cookie);
    const first = await audit('?limit=2');
    expect(first).toHaveLength(2);
    const next = await audit(`?limit=2&before=${encodeURIComponent(first[1]!.at)}`);
    expect(next[0]!.at < first[1]!.at).toBe(true);
    expect((await t!.get('/api/audit?limit=999', t!.cookie)).statusCode).toBe(400);
    expect((await t!.get('/api/audit?projectId=x', t!.cookie)).statusCode).toBe(400);
    expect((await t!.get('/api/audit')).statusCode).toBe(401);
  });
});

describe('system status', () => {
  it('reports store, AI, roots and backup freshness', async () => {
    await setup();
    let s = (await t!.get('/api/system/status', t!.cookie)).json<SystemStatus>();
    expect(s).toMatchObject({
      store: 'json',
      aiConfigured: true,
      aiProvider: 'mock',
      workspaceRoots: 1,
      lastBackupAt: null,
      backupStale: true,
    });
    await mkdir(join(base, 'backups'));
    await writeFile(join(base, 'backups', 'thiran-20261125T000000Z.json'), '{}');
    s = (await t!.get('/api/system/status', t!.cookie)).json<SystemStatus>();
    expect(s.lastBackupAt).not.toBeNull();
    expect(s.backupStale).toBe(false);
    expect((await t!.get('/api/system/status')).statusCode).toBe(401);
  });
});

describe('backup and restore (JSON mode)', () => {
  const cfg = (extra: Record<string, string> = {}) =>
    loadConfig({
      DATA_DIR: join(base, 'data'),
      BACKUP_DIR: join(base, 'backups'),
      PORT: '45999',
      ...extra,
    });

  it('backs up a valid data file and finds it as latest', async () => {
    const store = await createJsonFileStore({ file: join(base, 'data', 'thiran.json') });
    await store.createProject({
      name: 'POS',
      description: '',
      techStack: [],
      workspacePath: '',
      commands: {},
    });
    const r = await createBackup(cfg(), new Date('2026-11-25T01:02:03Z'));
    expect(r.file.endsWith('thiran-20261125T010203Z.json')).toBe(true);
    expect(await readFile(r.file, 'utf8')).toBe(
      await readFile(join(base, 'data', 'thiran.json'), 'utf8'),
    );
    expect((await latestBackup(cfg()))!.file).toBe('thiran-20261125T010203Z.json');
    if (process.platform !== 'win32') expect((await stat(r.file)).mode & 0o777).toBe(0o600);
    // Same second again must not overwrite an existing backup.
    await expect(createBackup(cfg(), new Date('2026-11-25T01:02:03Z'))).rejects.toThrow();
  });

  it('refuses to back up a corrupt data file', async () => {
    await mkdir(join(base, 'data'));
    await writeFile(join(base, 'data', 'thiran.json'), '{ broken');
    await expect(createBackup(cfg())).rejects.toThrow(/invalid/);
    await expect(readdir(join(base, 'backups'))).resolves.toEqual([]);
  });

  it('restores atomically and keeps a pre-restore safety copy', async () => {
    const file = join(base, 'data', 'thiran.json');
    const store = await createJsonFileStore({ file });
    await store.createProject({
      name: 'Old',
      description: '',
      techStack: [],
      workspacePath: '',
      commands: {},
    });
    const b = await createBackup(cfg(), new Date('2026-11-25T00:00:00Z'));
    await store.createProject({
      name: 'Newer',
      description: '',
      techStack: [],
      workspacePath: '',
      commands: {},
    });

    const r = await restoreJsonBackup(cfg(), b.file, new Date('2026-11-25T02:00:00Z'));
    const restored = await createJsonFileStore({ file });
    expect((await restored.listProjects()).map((p) => p.name)).toEqual(['Old']);
    const safety = await createJsonFileStore({ file: r.safetyCopy! });
    expect((await safety.listProjects()).map((p) => p.name).sort()).toEqual(['Newer', 'Old']);
  });

  it('refuses invalid backups, wrong names, PostgreSQL mode, and a running server', async () => {
    await mkdir(join(base, 'backups'), { recursive: true });
    const bad = join(base, 'backups', 'thiran-20261125T000000Z.json');
    await writeFile(bad, '{"not":"thiran"}');
    await expect(restoreJsonBackup(cfg(), bad)).rejects.toThrow(/invalid/);
    await expect(restoreJsonBackup(cfg(), join(base, 'evil.json'))).rejects.toThrow(/name/);
    await expect(
      restoreJsonBackup(cfg({ DATABASE_URL: 'postgresql://u:p@localhost/db' }), bad),
    ).rejects.toThrow(/pg_restore/);

    const srv = createServer((_q, res) => res.end('{"status":"ok"}'));
    await new Promise<void>((r) => srv.listen(45999, '127.0.0.1', r));
    try {
      const store = await createJsonFileStore({ file: join(base, 'data', 'thiran.json') });
      await store.createProject({
        name: 'X',
        description: '',
        techStack: [],
        workspacePath: '',
        commands: {},
      });
      const good = await createBackup(cfg(), new Date('2026-11-25T03:00:00Z'));
      await expect(restoreJsonBackup(cfg(), good.file)).rejects.toThrow(/Stop the Thiran server/);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});

describe.runIf(process.env.TEST_DATABASE_URL)('backup (PostgreSQL mode)', () => {
  it('pg_dump produces a restorable custom-format file without exposing the password', async () => {
    const cfg = loadConfig({
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BACKUP_DIR: join(base, 'backups'),
    });
    const r = await createBackup(cfg);
    expect(r.kind).toBe('postgres');
    expect((await stat(r.file)).size).toBeGreaterThan(100);
    expect((await stat(r.file)).mode & 0o777).toBe(0o600);
    const { runCommand } = await import('../src/agent/runner.js');
    const list = await runCommand({
      argv: ['pg_restore', '--list', r.file],
      cwd: base,
      timeoutMs: 30_000,
      maxOutput: 100_000,
    });
    expect(list.status).toBe('passed');
    expect(list.output).toContain('TABLE public projects');
  });
});
