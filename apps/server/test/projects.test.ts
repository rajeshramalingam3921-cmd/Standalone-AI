import { afterEach, describe, expect, it } from 'vitest';
import type { Project, ProjectSummary, Task } from '@thiran/shared';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

async function setup() {
  t = await makeTestApp();
  return t;
}

const post = (url: string, body: unknown) => t.post(url, body, t.cookie);
const get = (url: string) => t.get(url, t.cookie);

async function createProject(name = 'Restaurant POS') {
  const res = await post('/api/projects', { name, techStack: ['React', 'Node'] });
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

describe('authentication is required', () => {
  it('rejects every project/task route without a session', async () => {
    await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [method, url] of [
      ['GET', '/api/projects'],
      ['POST', '/api/projects'],
      ['GET', `/api/projects/${id}`],
      ['GET', `/api/projects/${id}/tasks`],
      ['POST', `/api/projects/${id}/tasks`],
      ['POST', `/api/projects/${id}/tasks/${id}/actions`],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' && { payload: '{}' }),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json().error).toBe('unauthenticated');
    }
  });
});

describe('projects API', () => {
  it('creates, lists and fetches projects with task counts', async () => {
    await setup();
    const p = await createProject();
    expect(p.techStack).toEqual(['React', 'Node']);

    const list = (await get('/api/projects')).json<ProjectSummary[]>();
    expect(list).toHaveLength(1);
    expect(list[0]!.taskCounts).toEqual({ waiting: 0, running: 0, failed: 0, done: 0 });

    expect((await get(`/api/projects/${p.id}`)).json<Project>().name).toBe('Restaurant POS');
  });

  it('validates input without echoing values', async () => {
    await setup();
    const res = await post('/api/projects', { name: '', description: 'sk-secret-123' });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toBe('name');
    expect(res.body).not.toContain('sk-secret-123');
  });

  it('returns 409 for duplicate names', async () => {
    await setup();
    await createProject('ERP');
    const dup = await post('/api/projects', { name: 'erp' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('conflict');
  });

  it('returns 404 for unknown or malformed ids', async () => {
    await setup();
    expect((await get('/api/projects/not-a-uuid')).statusCode).toBe(404);
    expect((await get('/api/projects/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
});

describe('tasks API', () => {
  it('creates draft tasks and updates project counts', async () => {
    await setup();
    const p = await createProject();
    const res = await post(`/api/projects/${p.id}/tasks`, { title: 'Menu management' });
    expect(res.statusCode).toBe(201);
    expect(res.json<Task>().status).toBe('draft');

    const tasks = (await get(`/api/projects/${p.id}/tasks`)).json<Task[]>();
    expect(tasks).toHaveLength(1);
    const list = (await get('/api/projects')).json<ProjectSummary[]>();
    expect(list[0]!.taskCounts.waiting).toBe(1);
  });

  it('allows cancel but refuses approve on a draft, and refuses unknown actions', async () => {
    await setup();
    const p = await createProject();
    const t = (await post(`/api/projects/${p.id}/tasks`, { title: 'x' })).json<Task>();
    const url = `/api/projects/${p.id}/tasks/${t.id}/actions`;

    expect((await post(url, { action: 'approve' })).statusCode).toBe(409);
    expect((await post(url, { action: 'complete' })).statusCode).toBe(400);

    const cancelled = await post(url, { action: 'cancel' });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<Task>().status).toBe('cancelled');
    expect((await post(url, { action: 'cancel' })).statusCode).toBe(409);
  });

  it('cannot reach a task through another project', async () => {
    await setup();
    const a = await createProject('A');
    const b = await createProject('B');
    const t = (await post(`/api/projects/${a.id}/tasks`, { title: 'secret' })).json<Task>();
    expect((await get(`/api/projects/${b.id}/tasks`)).json()).toEqual([]);
    expect(
      (await post(`/api/projects/${b.id}/tasks/${t.id}/actions`, { action: 'cancel' })).statusCode,
    ).toBe(404);
  });
});
