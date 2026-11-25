import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, safeEnv } from '../src/agent/runner.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thiran-run-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const node = process.execPath;
const run = (code: string, over: Partial<Parameters<typeof runCommand>[0]> = {}) =>
  runCommand({ argv: [node, '-e', code], cwd: dir, timeoutMs: 10_000, maxOutput: 10_000, ...over });

describe.skipIf(process.platform === 'win32')('runCommand', () => {
  it('reports pass/fail with exit code and combined output', async () => {
    expect(await run('console.log("ok"); console.error("warn")')).toEqual({
      status: 'passed',
      exitCode: 0,
      output: 'ok\nwarn\n',
    });
    expect(await run('process.exit(3)')).toMatchObject({ status: 'failed', exitCode: 3 });
  });

  it('runs in the project folder', async () => {
    await writeFile(join(dir, 'marker.txt'), 'here');
    expect((await run('console.log(require("fs").readFileSync("marker.txt","utf8"))')).output).toBe(
      'here\n',
    );
  });

  it('does not use a shell: metacharacters are plain arguments', async () => {
    const r = await runCommand({
      argv: [
        node,
        '-e',
        'console.log(process.argv.slice(1).join("|"))',
        '; rm -rf /',
        '$(whoami)',
        '&& echo hi',
      ],
      cwd: dir,
      timeoutMs: 10_000,
      maxOutput: 10_000,
    });
    expect(r.output).toBe('; rm -rf /|$(whoami)|&& echo hi\n');
  });

  it('does not pass server secrets to the command', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    try {
      const r = await run('console.log(JSON.stringify(process.env))');
      expect(r.output).not.toContain('sk-ant-should-not-leak');
      expect(r.output).not.toContain('postgresql://');
      expect(JSON.parse(r.output).CI).toBe('1');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.DATABASE_URL;
    }
    expect(Object.keys(safeEnv({ SECRET_TOKEN: 'x', PATH: '/bin' }))).not.toContain('SECRET_TOKEN');
  });

  it('kills the whole process tree on timeout', async () => {
    const pidFile = join(dir, 'child.pid');
    const started = Date.now();
    const r = await run(
      `const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], { stdio: "ignore" });
       require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
       setInterval(() => {}, 1000);`,
      { timeoutMs: 500 },
    );
    expect(r.status).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
    const { readFile } = await import('node:fs/promises');
    const grandchild = Number(await readFile(pidFile, 'utf8'));
    await new Promise((res) => setTimeout(res, 300));
    // The grandchild must be dead. In containers whose PID 1 does not reap orphans it
    // can linger as a zombie ("Z"), which is dead but still answers kill(pid, 0).
    const state = await readFile(`/proc/${grandchild}/status`, 'utf8')
      .then((t) => /State:\s+(\w)/.exec(t)?.[1])
      .catch(() => 'gone');
    expect(['gone', 'Z', 'X']).toContain(state);
  });

  it('keeps only the tail of very long output', async () => {
    const r = await run('for (let i = 0; i < 5000; i++) console.log("line " + i)', {
      maxOutput: 200,
    });
    expect(r.output.length).toBeLessThan(300);
    expect(r.output).toContain('line 4999');
    expect(r.output).not.toContain('line 1\n');
  });

  it('reports a missing program as an error', async () => {
    const r = await runCommand({
      argv: ['definitely-not-a-program-xyz'],
      cwd: dir,
      timeoutMs: 5000,
      maxOutput: 1000,
    });
    expect(r.status).toBe('error');
    expect(r.output).toContain('கிடைக்கவில்லை');
  });
});
