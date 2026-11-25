import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Sandboxed file access for one project folder.
 *
 * Rules (enforced for every call):
 * - The folder must be inside one of the owner-configured WORKSPACE_ROOTS.
 * - Paths are relative, use "/" only, and may not contain "..", ":", "\", NUL,
 *   or Windows device names. After resolving symlinks the target must still be
 *   inside the project folder.
 * - Secrets and VCS internals are never read or written; generated folders are hidden.
 * - Writes are atomic (temp file + rename) and never follow a symlink.
 */

export const MAX_READ_BYTES = 512 * 1024;
export const MAX_WRITE_BYTES = 512 * 1024;
const MAX_LIST_ENTRIES = 1000;

export type WorkspaceErrorCode =
  | 'not_configured'
  | 'not_allowed'
  | 'missing'
  | 'invalid_path'
  | 'denied'
  | 'not_found'
  | 'not_a_file'
  | 'not_a_directory'
  | 'too_large'
  | 'binary';

export class WorkspaceError extends Error {
  constructor(readonly code: WorkspaceErrorCode) {
    super(`Workspace error: ${code}`);
    this.name = 'WorkspaceError';
  }
}

/** Directories that are hidden from listings and never touched. */
const HIDDEN_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'coverage',
  '.next',
  '.thiran-data',
  '.venv',
  '__pycache__',
]);

/** Files that may contain secrets: never read, never written. */
function isSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === '.env' ||
    (n.startsWith('.env.') && n !== '.env.example' && n !== '.env.sample') ||
    n.endsWith('.pem') ||
    n.endsWith('.key') ||
    n.endsWith('.p12') ||
    n.endsWith('.pfx') ||
    n.startsWith('id_rsa') ||
    n.startsWith('id_ed25519') ||
    n === '.npmrc' ||
    n === '.pypirc' ||
    n === 'credentials.json'
  );
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Validate a client-supplied relative path and split it into segments. "" = project root. */
export function parseRelPath(p: string): string[] {
  if (p === '' || p === '.') return [];
  if (p.length > 400 || /[\0\\:]/.test(p) || p.startsWith('/') || isAbsolute(p)) {
    throw new WorkspaceError('invalid_path');
  }
  const segs = p.split('/');
  if (segs.length > 40) throw new WorkspaceError('invalid_path');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..' || WINDOWS_DEVICE.test(s) || /[. ]$/.test(s)) {
      throw new WorkspaceError('invalid_path');
    }
  }
  return segs;
}

function checkPolicy(segs: string[]): void {
  for (const s of segs.slice(0, -1))
    if (HIDDEN_DIRS.has(s.toLowerCase())) throw new WorkspaceError('denied');
  const last = segs.at(-1);
  if (last && (HIDDEN_DIRS.has(last.toLowerCase()) || isSecretName(last)))
    throw new WorkspaceError('denied');
}

/** Validate a path for staging a write (syntax + secret/VCS policy), without touching disk. */
export function checkWritablePath(p: string): string {
  const segs = parseRelPath(p);
  if (segs.length === 0) throw new WorkspaceError('invalid_path');
  checkPolicy(segs);
  return segs.join('/');
}

const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number | null;
}

export interface FileContent {
  path: string;
  content: string;
  sha256: string;
  size: number;
}

export interface Workspace {
  readonly root: string;
  list(dir: string): Promise<FileEntry[]>;
  read(path: string): Promise<FileContent>;
  /** Current content hash, or null if the file does not exist. */
  hashOf(path: string): Promise<string | null>;
  /** Atomically write UTF-8 content. Creates parent folders inside the project. */
  write(path: string, content: string): Promise<void>;
  /** Delete a regular file (used only to roll back a file this app created). */
  remove(path: string): Promise<void>;
}

export type WorkspaceStatus =
  { state: 'ok'; root: string } | { state: 'not_configured' | 'not_allowed' | 'missing' };

/**
 * Resolve a project's folder against the allowed roots.
 * `not_configured`: project has no path; `not_allowed`: outside WORKSPACE_ROOTS
 * (or no roots configured); `missing`: folder does not exist.
 */
export async function resolveWorkspace(
  workspacePath: string,
  allowedRoots: string[],
): Promise<WorkspaceStatus> {
  if (!workspacePath) return { state: 'not_configured' };
  if (!isAbsolute(workspacePath)) return { state: 'not_allowed' };
  let real: string;
  try {
    real = await realpath(resolve(workspacePath));
    if (!(await stat(real)).isDirectory()) return { state: 'missing' };
  } catch {
    return { state: 'missing' };
  }
  for (const r of allowedRoots) {
    try {
      const realRoot = await realpath(resolve(r));
      // The project must be strictly inside a root, never a root itself or a parent of one.
      if (real !== realRoot && inside(realRoot, real)) return { state: 'ok', root: real };
    } catch {
      /* a configured root that does not exist simply matches nothing */
    }
  }
  return { state: 'not_allowed' };
}

export function openWorkspace(root: string): Workspace {
  async function target(p: string) {
    const segs = parseRelPath(p);
    checkPolicy(segs);
    return { segs, abs: join(root, ...segs) };
  }

  /** realpath of an existing path, which must stay inside the root. */
  async function realInside(abs: string) {
    let real: string;
    try {
      real = await realpath(abs);
    } catch {
      throw new WorkspaceError('not_found');
    }
    if (!inside(root, real)) throw new WorkspaceError('denied');
    return real;
  }

  async function readExisting(p: string): Promise<{ buf: Buffer; abs: string }> {
    const { abs } = await target(p);
    const real = await realInside(abs);
    const st = await stat(real);
    if (!st.isFile()) throw new WorkspaceError('not_a_file');
    if (st.size > MAX_READ_BYTES) throw new WorkspaceError('too_large');
    const fh = await open(real, constants.O_RDONLY);
    try {
      return { buf: await fh.readFile(), abs: real };
    } finally {
      await fh.close();
    }
  }

  return {
    root,

    async list(dir) {
      const { segs, abs } = await target(dir);
      const real = await realInside(abs);
      if (!(await stat(real)).isDirectory()) throw new WorkspaceError('not_a_directory');
      const entries = await readdir(real, { withFileTypes: true });
      const out: FileEntry[] = [];
      for (const e of entries) {
        if (out.length >= MAX_LIST_ENTRIES) break;
        const lower = e.name.toLowerCase();
        if (HIDDEN_DIRS.has(lower) || isSecretName(e.name)) continue;
        const path = [...segs, e.name].join('/');
        if (e.isSymbolicLink()) {
          // Show a symlink only if it resolves inside the project.
          try {
            const r = await realpath(join(real, e.name));
            if (!inside(root, r)) continue;
            const st = await stat(r);
            out.push({
              name: e.name,
              path,
              type: st.isDirectory() ? 'dir' : 'file',
              size: st.isFile() ? st.size : null,
            });
          } catch {
            continue;
          }
        } else if (e.isDirectory()) {
          out.push({ name: e.name, path, type: 'dir', size: null });
        } else if (e.isFile()) {
          out.push({
            name: e.name,
            path,
            type: 'file',
            size: (await stat(join(real, e.name))).size,
          });
        }
      }
      return out.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
      );
    },

    async read(p) {
      const { buf } = await readExisting(p);
      if (buf.subarray(0, 8192).includes(0)) throw new WorkspaceError('binary');
      const content = buf.toString('utf8');
      // Not valid UTF-8 → editing would corrupt it; treat as binary.
      if (!Buffer.from(content, 'utf8').equals(buf)) throw new WorkspaceError('binary');
      return { path: parseRelPath(p).join('/'), content, sha256: sha256(buf), size: buf.length };
    },

    async hashOf(p) {
      try {
        const { buf } = await readExisting(p);
        return sha256(buf);
      } catch (e) {
        if (e instanceof WorkspaceError && e.code === 'not_found') return null;
        throw e;
      }
    },

    async write(p, content) {
      const data = Buffer.from(content, 'utf8');
      if (data.length > MAX_WRITE_BYTES) throw new WorkspaceError('too_large');
      const { segs, abs } = await target(p);
      if (segs.length === 0) throw new WorkspaceError('invalid_path');

      // Find the nearest existing ancestor and make sure it resolves inside the root.
      let existing = dirname(abs);
      const toCreate: string[] = [];
      for (;;) {
        try {
          await lstat(existing);
          break;
        } catch {
          toCreate.unshift(existing);
          existing = dirname(existing);
        }
      }
      const realParent = await realInside(existing);
      if (!(await stat(realParent)).isDirectory()) throw new WorkspaceError('not_a_directory');
      for (const d of toCreate) await mkdir(d);

      let mode: number | undefined;
      try {
        const st = await lstat(abs);
        if (st.isSymbolicLink()) throw new WorkspaceError('denied'); // never write through a link
        if (!st.isFile()) throw new WorkspaceError('not_a_file');
        mode = st.mode & 0o777;
      } catch (e) {
        if (e instanceof WorkspaceError) throw e;
      }

      const tmp = join(dirname(abs), `.thiran-tmp-${randomBytes(6).toString('hex')}`);
      const fh = await open(
        tmp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        mode ?? 0o644,
      );
      try {
        await fh.writeFile(data);
        await fh.sync();
      } finally {
        await fh.close();
      }
      try {
        if (mode !== undefined) await chmod(tmp, mode);
        await rename(tmp, abs);
      } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
      }
    },

    async remove(p) {
      const { abs } = await target(p);
      const st = await lstat(abs).catch(() => undefined);
      if (!st) return;
      if (!st.isFile()) throw new WorkspaceError('not_a_file');
      await realInside(dirname(abs));
      await unlink(abs);
    },
  };
}
