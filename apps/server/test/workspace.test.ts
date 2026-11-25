import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_READ_BYTES,
  WorkspaceError,
  openWorkspace,
  parseRelPath,
  resolveWorkspace,
  sha256,
  type Workspace,
} from '../src/agent/workspace.js';

let base: string; // plays the role of WORKSPACE_ROOTS
let proj: string; // a project folder inside it
let outside: string; // somewhere the agent must never reach
let ws: Workspace;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'thiran-ws-'));
  proj = join(base, 'roots', 'pos');
  outside = join(base, 'outside');
  await mkdir(join(proj, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(proj, 'src', 'app.ts'), 'export const a = 1;\n');
  await writeFile(join(proj, 'README.md'), '# POS\n');
  await writeFile(join(proj, '.env'), 'SECRET=1');
  await writeFile(join(proj, '.env.example'), 'SECRET=');
  await writeFile(join(outside, 'secret.txt'), 'top secret');
  await mkdir(join(proj, 'node_modules', 'x'), { recursive: true });
  await mkdir(join(proj, '.git'));
  await writeFile(join(proj, '.git', 'config'), '[core]');
  ws = openWorkspace(
    ((await resolveWorkspace(proj, [join(base, 'roots')])) as { root: string }).root,
  );
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof WorkspaceError) return e.code;
    throw e;
  }
};

describe('resolveWorkspace (folder authorization)', () => {
  it('accepts a folder strictly inside an allowed root', async () => {
    expect((await resolveWorkspace(proj, [join(base, 'roots')])).state).toBe('ok');
  });
  it('rejects folders outside the roots, the root itself, relative paths, and no roots', async () => {
    expect((await resolveWorkspace(outside, [join(base, 'roots')])).state).toBe('not_allowed');
    expect((await resolveWorkspace(join(base, 'roots'), [join(base, 'roots')])).state).toBe(
      'not_allowed',
    );
    expect((await resolveWorkspace(base, [join(base, 'roots')])).state).toBe('not_allowed');
    expect((await resolveWorkspace('roots/pos', [join(base, 'roots')])).state).toBe('not_allowed');
    expect((await resolveWorkspace(proj, [])).state).toBe('not_allowed');
    expect((await resolveWorkspace('', [join(base, 'roots')])).state).toBe('not_configured');
    expect((await resolveWorkspace(join(base, 'roots', 'nope'), [join(base, 'roots')])).state).toBe(
      'missing',
    );
  });
  it('rejects a symlink inside the roots that points outside', async () => {
    await symlink(outside, join(base, 'roots', 'sneaky'));
    expect(
      (await resolveWorkspace(join(base, 'roots', 'sneaky'), [join(base, 'roots')])).state,
    ).toBe('not_allowed');
  });
  it('rejects ../ tricks in the configured path', async () => {
    expect(
      (await resolveWorkspace(join(proj, '..', '..', 'outside'), [join(base, 'roots')])).state,
    ).toBe('not_allowed');
  });
});

describe('path validation', () => {
  it.each([
    '../outside/secret.txt',
    'src/../../outside',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'src\\app.ts',
    'a\0b',
    'src//app.ts',
    './src/app.ts',
    'CON',
    'src/nul.txt',
    'file.txt:stream',
    'trailingdot.',
    'x'.repeat(401),
  ])('rejects %j', (p) => {
    expect(() => parseRelPath(p)).toThrow(WorkspaceError);
  });
  it('accepts normal and Tamil paths', () => {
    expect(parseRelPath('src/app.ts')).toEqual(['src', 'app.ts']);
    expect(parseRelPath('docs/கணக்கு.md')).toEqual(['docs', 'கணக்கு.md']);
    expect(parseRelPath('')).toEqual([]);
  });
});

describe('reading', () => {
  it('lists folders first, hides secrets and generated/VCS folders', async () => {
    const names = (await ws.list('')).map((e) => `${e.type}:${e.name}`);
    expect(names).toEqual(['dir:src', 'file:.env.example', 'file:README.md']);
  });

  it('reads text files with a hash', async () => {
    const f = await ws.read('src/app.ts');
    expect(f).toMatchObject({ path: 'src/app.ts', content: 'export const a = 1;\n', size: 20 });
    expect(f.sha256).toBe(sha256('export const a = 1;\n'));
  });

  it('refuses secrets, VCS internals, dependencies', async () => {
    expect(await code(ws.read('.env'))).toBe('denied');
    expect(await code(ws.read('.git/config'))).toBe('denied');
    expect(await code(ws.list('node_modules'))).toBe('denied');
    expect(await code(ws.read('.env.example'))).toBe('ok');
  });

  it('refuses symlinks that escape the project, and hides them in listings', async () => {
    await symlink(join(outside, 'secret.txt'), join(proj, 'link.txt'));
    await symlink(outside, join(proj, 'linkdir'));
    expect(await code(ws.read('link.txt'))).toBe('denied');
    expect(await code(ws.read('linkdir/secret.txt'))).toBe('denied');
    expect(await code(ws.list('linkdir'))).toBe('denied');
    expect((await ws.list('')).map((e) => e.name)).not.toContain('link.txt');
  });

  it('allows symlinks that stay inside the project', async () => {
    await symlink(join(proj, 'README.md'), join(proj, 'readme-link.md'));
    expect((await ws.read('readme-link.md')).content).toBe('# POS\n');
  });

  it('refuses binary, non-UTF-8 and oversized files', async () => {
    await writeFile(join(proj, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
    await writeFile(join(proj, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    await writeFile(join(proj, 'big.txt'), 'x'.repeat(MAX_READ_BYTES + 1));
    expect(await code(ws.read('logo.png'))).toBe('binary');
    expect(await code(ws.read('latin1.txt'))).toBe('binary');
    expect(await code(ws.read('big.txt'))).toBe('too_large');
    expect(await code(ws.read('missing.txt'))).toBe('not_found');
    expect(await code(ws.read('src'))).toBe('not_a_file');
  });
});

describe('writing', () => {
  it('overwrites atomically, keeps file mode, leaves no temp files', async () => {
    await chmod(join(proj, 'src', 'app.ts'), 0o640);
    await ws.write('src/app.ts', 'export const a = 2;\n');
    expect(await readFile(join(proj, 'src', 'app.ts'), 'utf8')).toBe('export const a = 2;\n');
    if (process.platform !== 'win32')
      expect((await stat(join(proj, 'src', 'app.ts'))).mode & 0o777).toBe(0o640);
    expect((await readdir(join(proj, 'src'))).filter((n) => n.includes('thiran-tmp'))).toEqual([]);
  });

  it('creates new files and folders inside the project', async () => {
    await ws.write('src/pages/login.tsx', 'login');
    expect(await readFile(join(proj, 'src', 'pages', 'login.tsx'), 'utf8')).toBe('login');
    expect(await ws.hashOf('src/pages/login.tsx')).toBe(sha256('login'));
    expect(await ws.hashOf('nope.txt')).toBeNull();
  });

  it('refuses to write secrets, VCS internals, outside paths, or through symlinks', async () => {
    await symlink(outside, join(proj, 'linkdir'));
    await symlink(join(outside, 'secret.txt'), join(proj, 'link.txt'));
    expect(await code(ws.write('.env', 'X=1'))).toBe('denied');
    expect(await code(ws.write('.git/hooks/pre-commit', 'evil'))).toBe('denied');
    expect(await code(ws.write('../outside/x.txt', 'x'))).toBe('invalid_path');
    expect(await code(ws.write('linkdir/new.txt', 'x'))).toBe('denied');
    expect(await code(ws.write('link.txt', 'x'))).toBe('denied');
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('top secret');
    expect(await readdir(outside)).toEqual(['secret.txt']);
  });

  it('refuses oversized writes', async () => {
    expect(await code(ws.write('big.txt', 'x'.repeat(512 * 1024 + 1)))).toBe('too_large');
  });

  it('removes only regular files', async () => {
    await ws.write('tmp.txt', 'x');
    await ws.remove('tmp.txt');
    expect(await ws.hashOf('tmp.txt')).toBeNull();
    expect(await code(ws.remove('src'))).toBe('not_a_file');
  });
});
