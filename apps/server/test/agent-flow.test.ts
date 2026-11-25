import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangeSetView, CommandRun, Project, Task } from '@thiran/shared';
import { createMockProvider } from '../src/ai/mock.js';
import { AiAbortedError, type AgentRunRequest, type AiProvider } from '../src/ai/types.js';
import { makeTestApp, type TestApp } from './helpers.js';

let base: string;
let proj: string;
let t: TestApp;
const node = process.execPath;
const PASS = [node, '-e', 'process.exit(0)'];
const FAIL = [node, '-e', 'console.log("1 test failed"); process.exit(1)'];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'thiran-agent-'));
  proj = join(base, 'roots', 'pos');
  await mkdir(join(proj, 'src'), { recursive: true });
  await writeFile(join(proj, 'src', 'billing.js'), 'module.exports = 1;\n');
  await writeFile(join(proj, '.env'), 'SECRET=hunter2');
  await mkdir(join(base, 'outside'));
});
afterEach(async () => {
  await t?.app.agent.idle();
  await t?.app.close();
  await rm(base, { recursive: true, force: true });
});

async function setup(
  opts: { provider?: AiProvider; commands?: object; env?: Record<string, string> } = {},
) {
  t = await makeTestApp({
    provider: opts.provider ?? createMockProvider({ delayMs: 0 }),
    env: { WORKSPACE_ROOTS: join(base, 'roots'), AI_PROVIDER: 'mock', ...opts.env },
  });
  const p = (
    await t.post(
      '/api/projects',
      { name: 'POS', workspacePath: proj, commands: opts.commands ?? { test: PASS } },
      t.cookie,
    )
  ).json<Project>();
  const task = (
    await t.post(
      `/api/projects/${p.id}/tasks`,
      { title: 'Billing GST', description: 'Add 5% GST' },
      t.cookie,
    )
  ).json<Task>();
  return { p, task };
}

const act = (p: Project, task: Task, action: string, extra = {}) =>
  t.post(`/api/projects/${p.id}/tasks/${task.id}/actions`, { action, ...extra }, t.cookie);
const getTask = async (p: Project, task: Task) =>
  (await t.get(`/api/projects/${p.id}/tasks`, t.cookie))
    .json<Task[]>()
    .find((x) => x.id === task.id)!;

async function waitFor(p: Project, task: Task, pred: (t: Task) => boolean) {
  for (let i = 0; i < 200; i++) {
    await t.app.agent.idle();
    const cur = await getTask(p, task);
    if (pred(cur)) return cur;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout; last: ${JSON.stringify((await getTask(p, task)).agent?.phase)}`);
}

describe('agent workflow (mock provider)', () => {
  it('plan → approve → diff → apply → checks pass → completed with Tamil report', async () => {
    const { p, task } = await setup();
    expect((await act(p, task, 'plan')).statusCode).toBe(200);

    const planned = await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    expect(planned.agent).toMatchObject({ phase: 'awaiting_plan_approval', plans: 1, attempts: 0 });
    expect(planned.agent!.plan!.files).toEqual(['src/billing.js']);
    expect(planned.agent!.activity.some((a) => a.text.includes('read_file src/billing.js'))).toBe(
      true,
    );

    expect((await act(p, task, 'approve')).statusCode).toBe(200);
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    expect(proposed.status).toBe('running');
    // Nothing written yet.
    expect(await readFile(join(proj, 'src', 'billing.js'), 'utf8')).toBe('module.exports = 1;\n');
    const cs = (
      await t.get(`/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}`, t.cookie)
    ).json<ChangeSetView>();
    expect(cs).toMatchObject({ source: 'agent', taskId: task.id, status: 'pending' });

    expect(
      (await t.post(`/api/projects/${p.id}/changes/${cs.id}/apply`, {}, t.cookie)).statusCode,
    ).toBe(200);
    const done = await waitFor(p, task, (x) => x.status === 'completed');
    expect(done.agent!.phase).toBe('done');
    expect(done.agent!.checks).toMatchObject([{ name: 'test', status: 'passed', exitCode: 0 }]);
    expect(done.agent!.report).toContain('✅ முடிந்தது');
    expect(done.agent!.report).toContain('src/billing.js');
    expect(done.agent!.report).toContain('சரிபார்க்கப்படாதது'); // AI's own note is labelled unverified
    expect(await readFile(join(proj, 'src', 'billing.js'), 'utf8')).toContain('Thiran mock agent');
    const runs = (await t.get(`/api/projects/${p.id}/runs`, t.cookie)).json<CommandRun[]>();
    expect(runs[0]).toMatchObject({ name: 'test', status: 'passed' });
  });

  it('failing checks → needs_attention, never completed', async () => {
    const { p, task } = await setup({ commands: { test: FAIL } });
    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    await act(p, task, 'approve');
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    await t.post(
      `/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}/apply`,
      {},
      t.cookie,
    );
    const done = await waitFor(p, task, (x) => x.status === 'needs_attention');
    expect(done.agent!.report).toContain('⚠️');
    expect(done.agent!.checks[0]).toMatchObject({ status: 'failed', exitCode: 1 });
  });

  it('without configured checks the change is NOT reported as completed', async () => {
    const { p, task } = await setup({ commands: {} });
    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    await act(p, task, 'approve');
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    await t.post(
      `/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}/apply`,
      {},
      t.cookie,
    );
    const done = await waitFor(p, task, (x) => x.status === 'needs_attention');
    expect(done.agent!.report).toContain('சரிபார்க்கப்படவில்லை');
  });

  it('feeds the failed check output into the next plan and limits attempts', async () => {
    const prompts: string[] = [];
    const mock = createMockProvider({ delayMs: 0 });
    const spy: AiProvider = {
      ...mock,
      runAgent: (r) => (prompts.push(r.prompt), mock.runAgent(r)),
    };
    const { p, task } = await setup({
      provider: spy,
      commands: { test: FAIL },
      env: { AGENT_MAX_ATTEMPTS: '1' },
    });
    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    await act(p, task, 'approve');
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    await t.post(
      `/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}/apply`,
      {},
      t.cookie,
    );
    await waitFor(p, task, (x) => x.status === 'needs_attention');

    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    expect(prompts.at(-1)).toContain('<previous_check name="test" status="failed">');
    expect(prompts.at(-1)).toContain('1 test failed');
    const res = await act(p, task, 'approve');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('attempt_limit');
  });

  it('request_changes re-plans with the owner feedback', async () => {
    const prompts: string[] = [];
    const mock = createMockProvider({ delayMs: 0 });
    const { p, task } = await setup({
      provider: { ...mock, runAgent: (r) => (prompts.push(r.prompt), mock.runAgent(r)) },
    });
    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    await act(p, task, 'request_changes', { feedback: 'GST 18% வேண்டும்' });
    const again = await waitFor(
      p,
      task,
      (x) => x.status === 'awaiting_approval' && x.agent!.plans === 2,
    );
    expect(prompts.at(-1)).toContain('GST 18% வேண்டும்');
    expect(again.agent!.feedback).toBeNull();
  });

  it('rejecting the agent change fails the task with a report', async () => {
    const { p, task } = await setup();
    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    await act(p, task, 'approve');
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    await t.post(
      `/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}/reject`,
      {},
      t.cookie,
    );
    const done = await waitFor(p, task, (x) => x.status === 'failed');
    expect(done.agent!.report).toContain('நிராகரித்தீர்கள்');
    expect(await readFile(join(proj, 'src', 'billing.js'), 'utf8')).toBe('module.exports = 1;\n');
  });

  it('cancel while waiting for the diff auto-rejects the change', async () => {
    const { p, task } = await setup();
    await act(p, task, 'plan');
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    await act(p, task, 'approve');
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    await act(p, task, 'cancel');
    const cs = (
      await t.get(`/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}`, t.cookie)
    ).json<ChangeSetView>();
    expect(cs.status).toBe('rejected');
    expect((await getTask(p, task)).status).toBe('cancelled');
  });

  it('cancel during planning aborts the AI run', async () => {
    let aborted = false;
    const slow: AiProvider = {
      ...createMockProvider(),
      runAgent: (r) =>
        new Promise((_res, rej) =>
          r.signal.addEventListener('abort', () => {
            aborted = true;
            rej(new (class extends Error {})('aborted'));
          }),
        ),
    };
    const { p, task } = await setup({ provider: slow });
    await act(p, task, 'plan');
    await new Promise((r) => setTimeout(r, 50));
    expect((await act(p, task, 'cancel')).statusCode).toBe(200);
    await t.app.agent.idle();
    expect(aborted).toBe(true);
    expect((await getTask(p, task)).status).toBe('cancelled');
  });

  it('a double tap cannot start two runs', async () => {
    let runs = 0;
    const mock = createMockProvider({ delayMs: 20 });
    const { p, task } = await setup({
      provider: { ...mock, runAgent: (r) => (runs++, mock.runAgent(r)) },
    });
    const [a, b] = await Promise.all([act(p, task, 'plan'), act(p, task, 'plan')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    expect(runs).toBe(1);
  });

  it('refuses to plan without a configured AI provider', async () => {
    const { p, task } = await setup({ provider: { ...createMockProvider(), configured: false } });
    const res = await act(p, task, 'plan');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ai_not_configured');
    expect((await getTask(p, task)).status).toBe('draft');
  });

  it('after a restart, interrupted runs are marked failed', async () => {
    const hanging: AiProvider = {
      ...createMockProvider(),
      runAgent: (r) =>
        new Promise((_res, rej) => {
          if (r.signal.aborted) return rej(new AiAbortedError());
          r.signal.addEventListener('abort', () => rej(new AiAbortedError()));
        }),
    };
    const { p, task } = await setup({ provider: hanging });
    await act(p, task, 'plan'); // never finishes on its own
    expect(await t.app.agent.recover()).toBe(1);
    const cur = await getTask(p, task);
    expect(cur.status).toBe('failed');
    expect(cur.agent!.error).toBe('server_restarted');
    await t.app.agent.idle(); // the in-memory job was aborted and did not overwrite the state
    expect((await getTask(p, task)).agent!.error).toBe('server_restarted');
  });
});

describe('agent sandbox (adversarial scripted AI)', () => {
  /** An "AI" that tries everything it should not be able to do. */
  function attacker(results: Record<string, string>): AiProvider {
    return {
      ...createMockProvider(),
      async runAgent(r: AgentRunRequest) {
        const run = async (label: string, name: string, input: unknown) => {
          const res = await r.execute(name, input);
          results[label] = `${res.isError ? 'ERR ' : ''}${res.content}`;
          return res;
        };
        await run('readEnv', 'read_file', { path: '.env' });
        await run('readUp', 'read_file', { path: '../outside/x' });
        await run('listGit', 'list_files', { path: '.git' });
        await run('badInput', 'read_file', { file: 'src/billing.js' });
        await run('unknownTool', 'run_shell', { cmd: 'rm -rf /' });
        if (r.tools.some((x) => x.name === 'submit_plan')) {
          await run('planSecret', 'submit_plan', {
            summary: 's',
            steps: ['x'],
            files: ['.env'],
            checks: ['test'],
          });
          await run('planOk', 'submit_plan', {
            summary: 's',
            steps: ['x'],
            files: ['src/billing.js'],
            checks: ['test', 'build'],
          });
        } else {
          await run('writeEnv', 'write_file', { path: '.env', content: 'SECRET=stolen' });
          await run('writeGit', 'write_file', { path: '.git/hooks/pre-commit', content: 'evil' });
          await run('writeUp', 'write_file', { path: '../outside/x.txt', content: 'x' });
          await run('writeOk', 'write_file', {
            path: 'src/billing.js',
            content: 'module.exports = 2;\n',
          });
          await run('finish', 'finish', { summary_ta: 'done' });
        }
        return {
          stop: 'tool_stop',
          usage: { inputTokens: 1, outputTokens: 1 },
          finalText: '',
          servedModel: 'm',
        };
      },
    };
  }

  it('every escape attempt fails; only the legitimate file reaches the change set', async () => {
    const results: Record<string, string> = {};
    const { p, task } = await setup({ provider: attacker(results) });
    await act(p, task, 'plan');
    const planned = await waitFor(p, task, (x) => x.status === 'awaiting_approval');
    for (const k of ['readEnv', 'readUp', 'listGit', 'badInput', 'unknownTool', 'planSecret']) {
      expect(results[k], k).toMatch(/^ERR /);
    }
    expect(results.readEnv).not.toContain('hunter2');
    // "build" is not configured, so it is dropped from the plan.
    expect(planned.agent!.plan!.checks).toEqual(['test']);

    await act(p, task, 'approve');
    const proposed = await waitFor(p, task, (x) => x.agent?.phase === 'awaiting_diff');
    for (const k of ['writeEnv', 'writeGit', 'writeUp']) expect(results[k], k).toMatch(/^ERR /);
    const cs = (
      await t.get(`/api/projects/${p.id}/changes/${proposed.agent!.changeSetId}`, t.cookie)
    ).json<ChangeSetView>();
    expect(cs.files.map((f) => f.path)).toEqual(['src/billing.js']);
    expect(await readFile(join(proj, '.env'), 'utf8')).toBe('SECRET=hunter2');
    await expect(readFile(join(base, 'outside', 'x.txt'))).rejects.toThrow();
  });
});
