import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangeSetView, CommandRun, Project } from '@thiran/shared';
import { makeTestApp, type TestApp } from './helpers.js';

let base: string;
let roots: string;
let proj: string;
let t: TestApp;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'thiran-api-'));
  roots = join(base, 'roots');
  proj = join(roots, 'pos');
  await mkdir(join(proj, 'src'), { recursive: true });
  await writeFile(join(proj, 'src', 'app.ts'), 'export const a = 1;\n');
  await writeFile(join(proj, '.env'), 'SECRET=1');
  await mkdir(join(base, 'outside'));
  t = await makeTestApp({ env: { WORKSPACE_ROOTS: roots, COMMAND_TIMEOUT_MS: '5000' } });
});
afterEach(async () => {
  await t.app.close();
  await rm(base, { recursive: true, force: true });
});

const post = (url: string, body: unknown) => t.post(url, body, t.cookie);
const get = (url: string) => t.get(url, t.cookie);
const patch = (url: string, body: unknown) =>
  t.app.inject({
    method: 'PATCH',
    url,
    headers: { cookie: t.cookie, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });

async function project(workspacePath = proj, commands = {}) {
  const res = await post('/api/projects', { name: `P-${Math.random()}`, workspacePath, commands });
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

describe('workspace access', () => {
  it('reports folder state without leaking the resolved path', async () => {
    const ok = await project();
    const res = await get(`/api/projects/${ok.id}/workspace`);
    expect(res.json()).toEqual({ state: 'ok', commands: {} });
    const out = await project(join(base, 'outside'));
    expect((await get(`/api/projects/${out.id}/workspace`)).json().state).toBe('not_allowed');
    const none = await project('');
    expect((await get(`/api/projects/${none.id}/workspace`)).json().state).toBe('not_configured');
  });

  it('refuses file access for folders outside WORKSPACE_ROOTS', async () => {
    const out = await project(join(base, 'outside'));
    const res = await get(`/api/projects/${out.id}/files`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'workspace_unavailable', state: 'not_allowed' });
  });

  it('lists and reads files, hiding and refusing secrets', async () => {
    const p = await project();
    expect(
      (await get(`/api/projects/${p.id}/files`)).json().map((e: { name: string }) => e.name),
    ).toEqual(['src']);
    const f = await get(`/api/projects/${p.id}/file?path=src/app.ts`);
    expect(f.json()).toMatchObject({ content: 'export const a = 1;\n' });
    expect((await get(`/api/projects/${p.id}/file?path=.env`)).statusCode).toBe(403);
    expect((await get(`/api/projects/${p.id}/file?path=../outside/x`)).statusCode).toBe(400);
    expect((await get(`/api/projects/${p.id}/file?path=src/nope.ts`)).statusCode).toBe(404);
  });

  it('requires sign-in', async () => {
    const p = await project();
    expect((await t.get(`/api/projects/${p.id}/files`)).statusCode).toBe(401);
    expect((await t.get(`/api/projects/${p.id}/file?path=src/app.ts`)).statusCode).toBe(401);
  });
});

describe('change sets', () => {
  async function propose(p: Project, files: object[], title = 'Update') {
    return post(`/api/projects/${p.id}/changes`, { title, files });
  }

  it('creating a change writes nothing and shows a diff', async () => {
    const p = await project();
    const res = await propose(p, [
      { path: 'src/app.ts', content: 'export const a = 2;\n' },
      { path: 'src/new.ts', content: 'export {};\n' },
    ]);
    expect(res.statusCode).toBe(201);
    const cs = res.json<ChangeSetView>();
    expect(cs.status).toBe('pending');
    expect(cs.files.map((f) => [f.path, f.action, f.additions, f.deletions])).toEqual([
      ['src/app.ts', 'modify', 1, 1],
      ['src/new.ts', 'create', 1, 0],
    ]);
    expect(cs.files[0]!.diff).toContain('-export const a = 1;');
    expect(cs.files[0]!.diff).toContain('+export const a = 2;');
    expect(await readFile(join(proj, 'src', 'app.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('apply writes files; revert restores them and removes created files', async () => {
    const p = await project();
    const cs = (
      await propose(p, [
        { path: 'src/app.ts', content: 'export const a = 2;\n' },
        { path: 'src/pages/new.ts', content: 'new\n' },
      ])
    ).json<ChangeSetView>();
    const applied = await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {});
    expect(applied.json().status).toBe('applied');
    expect(await readFile(join(proj, 'src', 'app.ts'), 'utf8')).toBe('export const a = 2;\n');
    expect(await readFile(join(proj, 'src', 'pages', 'new.ts'), 'utf8')).toBe('new\n');

    expect((await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {})).statusCode).toBe(409);

    const reverted = await post(`/api/projects/${p.id}/changes/${cs.id}/revert`, {});
    expect(reverted.json().status).toBe('reverted');
    expect(await readFile(join(proj, 'src', 'app.ts'), 'utf8')).toBe('export const a = 1;\n');
    await expect(readFile(join(proj, 'src', 'pages', 'new.ts'))).rejects.toThrow();
  });

  it('never overwrites a file edited after the change was prepared', async () => {
    const p = await project();
    const cs = (
      await propose(p, [{ path: 'src/app.ts', content: 'from AI\n' }])
    ).json<ChangeSetView>();
    await writeFile(join(proj, 'src', 'app.ts'), 'my own edit\n');
    const res = await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'files_changed', paths: ['src/app.ts'] });
    expect(await readFile(join(proj, 'src', 'app.ts'), 'utf8')).toBe('my own edit\n');
    expect((await get(`/api/projects/${p.id}/changes/${cs.id}`)).json().status).toBe('pending');
  });

  it('refuses to revert if files were edited after applying', async () => {
    const p = await project();
    const cs = (await propose(p, [{ path: 'src/app.ts', content: 'v2\n' }])).json<ChangeSetView>();
    await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {});
    await writeFile(join(proj, 'src', 'app.ts'), 'v3 by hand\n');
    expect((await post(`/api/projects/${p.id}/changes/${cs.id}/revert`, {})).statusCode).toBe(409);
    expect(await readFile(join(proj, 'src', 'app.ts'), 'utf8')).toBe('v3 by hand\n');
  });

  it('detects a stale editor base hash at creation', async () => {
    const p = await project();
    const res = await propose(p, [
      { path: 'src/app.ts', content: 'x\n', baseSha256: 'a'.repeat(64) },
    ]);
    expect(res.statusCode).toBe(409);
  });

  it('rejects secrets, escapes, symlink escapes, duplicates and no-op changes', async () => {
    const p = await project();
    await symlink(join(base, 'outside'), join(proj, 'out'));
    expect((await propose(p, [{ path: '.env', content: 'X=1' }])).statusCode).toBe(403);
    expect((await propose(p, [{ path: '../outside/a', content: 'x' }])).statusCode).toBe(400);
    const viaLink = await propose(p, [{ path: 'out/a.txt', content: 'x' }]);
    expect(viaLink.statusCode).toBe(201); // preparing only reads; writing is checked at apply
    const applyLink = await post(`/api/projects/${p.id}/changes/${viaLink.json().id}/apply`, {});
    expect(applyLink.statusCode).toBe(403);
    await expect(readFile(join(base, 'outside', 'a.txt'))).rejects.toThrow();
    expect(
      (
        await propose(p, [
          { path: 'a', content: 'x' },
          { path: 'a', content: 'y' },
        ])
      ).statusCode,
    ).toBe(400);
    const noop = await propose(p, [{ path: 'src/app.ts', content: 'export const a = 1;\n' }]);
    expect(noop.statusCode).toBe(400);
    expect(noop.json().error).toBe('no_changes');
  });

  it('reject marks a pending change and blocks applying it', async () => {
    const p = await project();
    const cs = (await propose(p, [{ path: 'src/app.ts', content: 'x\n' }])).json<ChangeSetView>();
    expect((await post(`/api/projects/${p.id}/changes/${cs.id}/reject`, {})).json().status).toBe(
      'rejected',
    );
    expect((await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {})).statusCode).toBe(409);
  });

  it('keeps change sets isolated per project', async () => {
    const a = await project();
    const b = await project();
    const cs = (await propose(a, [{ path: 'src/app.ts', content: 'x\n' }])).json<ChangeSetView>();
    expect((await post(`/api/projects/${b.id}/changes/${cs.id}/apply`, {})).statusCode).toBe(404);
    expect((await get(`/api/projects/${b.id}/changes`)).json()).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('commands', () => {
  const node = process.execPath;

  async function waitRun(p: Project, id: string) {
    for (let i = 0; i < 100; i++) {
      const r = (await get(`/api/projects/${p.id}/runs/${id}`)).json<CommandRun>();
      if (r.status !== 'running') return r;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('run did not finish');
  }

  it('runs only owner-configured commands, in the project folder', async () => {
    const p = await project(proj, {
      test: [node, '-e', 'console.log(require("fs").readdirSync("src").join(","))'],
    });
    const res = await post(`/api/projects/${p.id}/runs`, { name: 'test' });
    expect(res.statusCode).toBe(202);
    const run = await waitRun(p, res.json().id);
    expect(run).toMatchObject({ status: 'passed', exitCode: 0, output: 'app.ts\n' });
    expect((await post(`/api/projects/${p.id}/runs`, { name: 'build' })).json().error).toBe(
      'command_not_configured',
    );
    expect((await post(`/api/projects/${p.id}/runs`, { name: 'deploy' })).statusCode).toBe(400);
    expect(
      (await post(`/api/projects/${p.id}/runs`, { name: 'test', argv: ['rm', '-rf', '/'] }))
        .statusCode,
    ).toBe(400);
  });

  it('reports failures and blocks file changes while a command runs', async () => {
    const p = await project(proj, { test: [node, '-e', 'setTimeout(() => process.exit(2), 400)'] });
    const run = (await post(`/api/projects/${p.id}/runs`, { name: 'test' })).json<CommandRun>();
    const cs = (
      await post(`/api/projects/${p.id}/changes`, {
        title: 'x',
        files: [{ path: 'src/app.ts', content: 'y\n' }],
      })
    ).json();
    expect((await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {})).json().error).toBe(
      'busy',
    );
    expect((await post(`/api/projects/${p.id}/runs`, { name: 'test' })).json().error).toBe('busy');
    expect(await waitRun(p, run.id)).toMatchObject({ status: 'failed', exitCode: 2 });
    expect((await post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {})).statusCode).toBe(200);
  });

  it('only the owner can change commands (PATCH, validated)', async () => {
    const p = await project();
    const ok = await patch(`/api/projects/${p.id}`, { commands: { test: ['pnpm', 'test'] } });
    expect(ok.json().commands).toEqual({ test: ['pnpm', 'test'] });
    expect(
      (await patch(`/api/projects/${p.id}`, { commands: { test: 'rm -rf /' } })).statusCode,
    ).toBe(400);
    expect((await patch(`/api/projects/${p.id}`, { evil: true })).statusCode).toBe(400);
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: `/api/projects/${p.id}`,
          headers: { 'content-type': 'application/json' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('diff statistics', () => {
  it('counts only real added/removed lines, never the file header', async () => {
    const { toView } = await import('../src/agent/changes.js');
    const v = toView({
      id: 'x',
      projectId: 'p',
      title: 't',
      source: 'user',
      taskId: null,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      decidedAt: null,
      files: [
        {
          path: 'a.ts',
          action: 'modify',
          baseSha256: 'b',
          originalContent: 'a\nb\nc\n',
          newContent: 'a\nB\nc\nd\n',
          newSha256: 'n',
        },
      ],
    });
    expect(v.files[0]).toMatchObject({ additions: 2, deletions: 1 });
    expect(v.files[0]!.diff).toContain('+++ b/a.ts');
  });
});
