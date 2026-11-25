#!/usr/bin/env node
/**
 * Black-box end-to-end test of the BUILT app (run `pnpm build` first).
 *
 *   pnpm e2e                    mock AI, throwaway JSON data — safe, free, runs in CI
 *   pnpm e2e:live               REAL Claude API (needs ANTHROPIC_API_KEY; costs money)
 *
 * It starts the real server process on a free port with an isolated temp folder
 * (your .env is NOT read), creates a sample project that has a real bug and a real
 * failing test, then drives the whole workflow over HTTP:
 *   sign-in → project → failing check → task → AI plan → approve → AI diff → apply
 *   → checks → report → audit → rollback → backup → restart persistence → sign-out.
 *
 * Mock mode expects an honest "needs attention" (the mock does not fix bugs).
 * Live mode expects "completed": the real agent must fix the bug and make the test pass.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_DIST = join(ROOT, 'apps', 'server', 'dist');
const live = process.argv.includes('--live');
const keep = process.argv.includes('--keep');
const PASSWORD = 'e2e-owner-password-123';

const ok = (m) => process.stdout.write(`✔ ${m}\n`);
const info = (m) => process.stdout.write(`  ${m}\n`);
function fail(m) {
  process.stderr.write(`✘ ${m}\n`);
  throw new Error(m);
}
const assert = (cond, m) => (cond ? undefined : fail(m));

if (live) {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      'e2e:live needs ANTHROPIC_API_KEY in the environment (not read from .env).\n',
    );
    process.exit(2);
  }
  if (!process.argv.includes('--yes')) {
    process.stdout.write(
      'This runs the REAL agent on a tiny sample project and is billed to your API key\n' +
        '(budget capped at 400k tokens per run, 2 runs). Re-run with --yes to continue.\n',
    );
    process.exit(2);
  }
}

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

const work = await mkdtemp(join(tmpdir(), 'thiran-e2e-'));
const proj = join(work, 'roots', 'restaurant-pos');
const port = await freePort();
const base = `http://127.0.0.1:${port}`;

const env = {
  ...Object.fromEntries(
    // Never leak the caller's settings into the run; keep only what Node needs.
    Object.entries(process.env).filter(([k]) =>
      /^(PATH|Path|PATHEXT|HOME|USERPROFILE|SystemRoot|TEMP|TMP|TMPDIR|ComSpec|APPDATA|LOCALAPPDATA)$/.test(
        k,
      ),
    ),
  ),
  THIRAN_NO_ENV_FILE: '1',
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'warn',
  COOKIE_SECURE: 'false',
  SERVE_WEB: 'true',
  DATA_DIR: join(work, 'data'),
  BACKUP_DIR: join(work, 'backups'),
  WORKSPACE_ROOTS: join(work, 'roots'),
  AI_PROVIDER: live ? 'anthropic' : 'mock',
  ...(live && {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AGENT_TOKEN_BUDGET: '400000',
    AGENT_MAX_TURNS: '20',
  }),
};

let server;
function startServer() {
  server = spawn(process.execPath, [join(SERVER_DIST, 'index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', (d) => (logs += d));
  server.stderr.on('data', (d) => (logs += d));
  server.logs = () => logs;
}
async function waitHealthy() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  fail(`server did not start:\n${server.logs()}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
}

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(cookie && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}
async function poll(fn, pred, label, timeoutMs = live ? 15 * 60_000 : 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() > until)
      fail(`timeout waiting for ${label}; last: ${JSON.stringify(v).slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, live ? 2000 : 100));
  }
}

try {
  // ---- sample project with a real bug and a real failing test
  await mkdir(join(proj, 'src'), { recursive: true });
  await writeFile(
    join(proj, 'src', 'billing.js'),
    '// Restaurant bill: subtotal + 5% GST, rounded to 2 decimals.\n' +
      'function billTotal(items) {\n' +
      '  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);\n' +
      '  return subtotal; // BUG: GST is not added\n' +
      '}\nmodule.exports = { billTotal };\n',
  );
  await writeFile(
    join(proj, 'src', 'billing.test.js'),
    "const { test } = require('node:test');\nconst assert = require('node:assert');\n" +
      "const { billTotal } = require('./billing');\n" +
      "test('adds 5% GST', () => {\n  assert.strictEqual(billTotal([{ price: 100, qty: 2 }, { price: 50, qty: 1 }]), 262.5);\n});\n",
  );
  await writeFile(join(proj, '.env'), 'SECRET=never-read-this\n');

  // ---- owner password (the CLI needs a terminal, so write the hash directly)
  const { hashPassword } = await import(
    pathToFileURL(join(SERVER_DIST, 'auth', 'password.js')).href
  );
  await mkdir(env.DATA_DIR, { recursive: true });
  await writeFile(
    join(env.DATA_DIR, 'thiran.json'),
    JSON.stringify({
      version: 1,
      projects: [],
      tasks: [],
      owner: { passwordHash: await hashPassword(PASSWORD) },
    }),
  );

  startServer();
  await waitHealthy();
  ok(
    `built server started on port ${port} (${live ? 'REAL Claude API' : 'mock AI'}, isolated temp data)`,
  );

  // ---- web UI + security headers
  const home = await api('GET', '/');
  assert(home.status === 200 && home.text.includes('திறன் AI'), 'web UI not served at /');
  assert(
    String(home.headers.get('content-security-policy')).includes("script-src 'self'"),
    'web CSP missing',
  );
  ok('web UI served with strict CSP');

  // ---- auth
  assert((await api('GET', '/api/projects')).status === 401, 'API reachable without sign-in');
  assert(
    (await api('POST', '/api/auth/login', { password: 'wrong-password' })).status === 401,
    'wrong password accepted',
  );
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert(login.ok, 'login failed');
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert(/HttpOnly/i.test(login.headers.get('set-cookie')), 'cookie not HttpOnly');
  ok('sign-in: 401 without session, wrong password refused, HttpOnly session cookie');

  // ---- project + failing check
  const project = (
    await api('POST', '/api/projects', {
      name: 'உணவக POS',
      techStack: ['Node.js'],
      workspacePath: proj,
      commands: { test: [process.execPath, '--test'] },
    })
  ).json;
  assert(project?.id, 'project not created');
  const P = `/api/projects/${project.id}`;
  const files = (await api('GET', `${P}/files`)).json;
  assert(Array.isArray(files) && !files.some((f) => f.name === '.env'), '.env visible in listing');
  assert((await api('GET', `${P}/file?path=.env`)).status === 403, '.env readable');
  const run1 = (await api('POST', `${P}/runs`, { name: 'test' })).json;
  const r1 = await poll(
    () => api('GET', `${P}/runs/${run1.id}`).then((r) => r.json),
    (r) => r.status !== 'running',
    'first test run',
  );
  assert(
    r1.status === 'failed',
    `expected the sample test to FAIL before the fix, got ${r1.status}`,
  );
  ok('project folder authorized; .env hidden and unreadable; sample test fails (real bug)');

  // ---- agent: plan → approve → diff → apply → checks → report
  const task = (
    await api('POST', `${P}/tasks`, {
      title: 'billTotal-இல் 5% GST சேர்க்கவும்',
      description:
        'src/billing.js billTotal must return subtotal plus 5% GST, rounded to 2 decimals. The test in src/billing.test.js must pass.',
    })
  ).json;
  const T = `${P}/tasks/${task.id}`;
  const getTask = async () => (await api('GET', `${P}/tasks`)).json.find((x) => x.id === task.id);
  assert(
    (await api('POST', `${T}/actions`, { action: 'plan' })).status === 200,
    'plan action failed',
  );
  const planned = await poll(getTask, (t) => t.status !== 'planning', 'plan');
  assert(
    planned.status === 'awaiting_approval',
    `planning ended as ${planned.status}: ${planned.agent?.report ?? ''}`,
  );
  info(`plan: ${planned.agent.plan.summary.slice(0, 160)}`);
  assert(
    (await api('POST', `${T}/actions`, { action: 'approve' })).status === 200,
    'approve failed',
  );
  const proposed = await poll(getTask, (t) => t.agent?.phase !== 'executing', 'proposal');
  assert(
    proposed.agent.phase === 'awaiting_diff',
    `execution ended as ${proposed.agent.phase}: ${proposed.agent.report ?? ''}`,
  );
  const before = await readFile(join(proj, 'src', 'billing.js'), 'utf8');
  assert(before.includes('BUG'), 'agent wrote to disk before approval');
  const change = (await api('GET', `${P}/changes/${proposed.agent.changeSetId}`)).json;
  assert(change.source === 'agent' && change.files.length > 0, 'no agent change set');
  assert(!change.files.some((f) => f.path.includes('.env')), 'agent change touches .env');
  info(
    `agent proposes: ${change.files.map((f) => `${f.path} +${f.additions} −${f.deletions}`).join(', ')}`,
  );
  ok('AI planned → approved → proposed a diff; nothing written before approval');

  assert((await api('POST', `${P}/changes/${change.id}/apply`, {})).status === 200, 'apply failed');
  const done = await poll(
    getTask,
    (t) => !['running', 'verifying'].includes(t.status),
    'verification',
  );
  info(
    `final status: ${done.status}; checks: ${done.agent.checks.map((c) => `${c.name}=${c.status}`).join(', ')}`,
  );
  if (live) {
    assert(
      done.status === 'completed',
      `LIVE: expected completed, got ${done.status}\n${done.agent.report}`,
    );
    assert(done.agent.report.includes('✅'), 'LIVE: report does not say completed');
    ok('LIVE: real agent fixed the bug; test passes; task completed with Tamil report');
  } else {
    assert(done.status === 'needs_attention', `mock: expected needs_attention, got ${done.status}`);
    assert(
      done.agent.report.includes('கவனம் தேவை') && !done.agent.report.includes('✅'),
      'mock: dishonest report',
    );
    ok('mock: checks still fail → honest "needs attention" report (no false success)');
  }

  // ---- audit
  const actions = (await api('GET', `/api/audit?projectId=${project.id}&limit=200`)).json.map(
    (e) => e.action,
  );
  for (const a of [
    'project.created',
    'command.started',
    'task.created',
    'agent.plan_ready',
    'agent.change_proposed',
    'change.applied',
    'agent.finished',
  ]) {
    assert(actions.includes(a), `audit missing ${a}`);
  }
  const auditText = JSON.stringify((await api('GET', '/api/audit?limit=200')).json);
  assert(
    !auditText.includes(PASSWORD) && !auditText.includes('wrong-password'),
    'password in audit',
  );
  ok(`audit trail has ${actions.length} project events; no passwords recorded`);

  // ---- rollback
  assert(
    (await api('POST', `${P}/changes/${change.id}/revert`, {})).status === 200,
    'revert failed',
  );
  assert(
    (await readFile(join(proj, 'src', 'billing.js'), 'utf8')) === before,
    'rollback did not restore the file',
  );
  ok('rollback restored the original file');

  // ---- backup via the real CLI
  const b = spawnSync(process.execPath, [join(SERVER_DIST, 'cli.js'), 'backup'], {
    env,
    encoding: 'utf8',
  });
  assert(b.status === 0, `backup CLI failed: ${b.stderr}`);
  const backups = await readdir(env.BACKUP_DIR);
  assert(
    backups.some((f) => /^thiran-.*\.json$/.test(f)),
    'no backup file',
  );
  ok(`backup CLI wrote ${backups[0]}`);

  // ---- restart: data persists, session survives
  await stopServer();
  startServer();
  await waitHealthy();
  const after = await api('GET', '/api/projects');
  assert(
    after.status === 200 && after.json.some((p) => p.id === project.id),
    'data or session lost after restart',
  );
  ok('after a server restart: data and session persist');

  // ---- sign-out
  await api('POST', '/api/auth/logout', {});
  assert((await api('GET', '/api/projects')).status === 401, 'still signed in after logout');
  ok('sign-out revokes the session');

  process.stdout.write(`\nE2E PASSED (${live ? 'live' : 'mock'})\n`);
} catch (e) {
  process.stderr.write(`\nE2E FAILED: ${e.message}\n`);
  if (server)
    process.stderr.write(`--- server output ---\n${server.logs?.().slice(-4000) ?? ''}\n`);
  process.exitCode = 1;
} finally {
  await stopServer();
  if (keep) process.stdout.write(`(kept ${work})\n`);
  else await rm(work, { recursive: true, force: true });
}
