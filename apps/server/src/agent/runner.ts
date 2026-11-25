import { spawn } from 'node:child_process';

export interface RunOptions {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  /** Keep at most this many characters of combined output (the tail). */
  maxOutput: number;
  /** Extra variables (never secrets). */
  extraEnv?: Record<string, string>;
}

export interface RunResult {
  status: 'passed' | 'failed' | 'timeout' | 'error';
  exitCode: number | null;
  output: string;
}

/**
 * Environment passed to project commands: only what build tools need to find
 * programs and temp folders. Server secrets (API keys, DATABASE_URL, …) are
 * never inherited.
 */
const ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ComSpec',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'NVM_DIR',
  'PNPM_HOME',
  'COREPACK_HOME',
  'JAVA_HOME',
];

export function safeEnv(
  source: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
) {
  const env: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    const v = source[k];
    if (v !== undefined) env[k] = v;
  }
  return { ...env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...extra };
}

/** Windows cannot spawn .cmd/.bat (npm, pnpm, npx…) without cmd.exe. Quote each argument. */
function windowsCommand(argv: string[]): { file: string; args: string[] } {
  const quote = (a: string) =>
    /^[\w\-./:=@\\]+$/.test(a)
      ? a
      : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  // cmd.exe metacharacters are rejected outright rather than escaped.
  if (argv.some((a) => /[&|<>^%!\r\n]/.test(a))) throw new Error('unsafe_argument');
  return {
    file: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${argv.map(quote).join(' ')}"`],
  };
}

function killTree(pid: number) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM'); // whole process group
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }, 3000).unref();
    }
  } catch {
    /* already gone */
  }
}

export function runCommand(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = '';
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > opts.maxOutput * 2) output = output.slice(-opts.maxOutput);
    };
    const finish = (r: Omit<RunResult, 'output'>) => {
      const trimmed =
        output.length > opts.maxOutput
          ? `[…முந்தைய output வெட்டப்பட்டது]\n${output.slice(-opts.maxOutput)}`
          : output;
      resolve({ ...r, output: trimmed });
    };

    let file = opts.argv[0]!;
    let args = opts.argv.slice(1);
    if (process.platform === 'win32') {
      try {
        ({ file, args } = windowsCommand(opts.argv));
      } catch {
        return finish({ status: 'error', exitCode: null });
      }
    }

    let child;
    try {
      child = spawn(file, args, {
        cwd: opts.cwd,
        env: safeEnv(process.env, opts.extraEnv),
        shell: false,
        detached: process.platform !== 'win32', // own process group so the tree can be killed
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      append(`[இயக்க முடியவில்லை: ${(e as Error).message}]\n`);
      return finish({ status: 'error', exitCode: null });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      append(`\n[நேர வரம்பு ${Math.round(opts.timeoutMs / 1000)}s கடந்ததால் நிறுத்தப்பட்டது]\n`);
      if (child.pid) killTree(child.pid);
    }, opts.timeoutMs);

    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      append(
        `[இயக்க முடியவில்லை: ${e.code === 'ENOENT' ? `"${opts.argv[0]}" கிடைக்கவில்லை` : (e.code ?? e.message)}]\n`,
      );
      finish({ status: 'error', exitCode: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return finish({ status: 'timeout', exitCode: code });
      finish({ status: code === 0 ? 'passed' : 'failed', exitCode: code });
    });
  });
}
