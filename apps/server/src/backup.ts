import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { runCommand } from './agent/runner.js';
import type { AppConfig } from './config.js';
import { readJsonData } from './store/json-file-store.js';
import { jsonDataFile } from './store/open.js';

export const BACKUP_FILE = /^thiran-(\d{8}T\d{6}Z)(?:-[\w-]+)?\.(json|dump)$/;

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

export interface BackupResult {
  file: string;
  bytes: number;
  kind: 'json' | 'postgres';
}

/**
 * JSON mode: validated copy of the data file. PostgreSQL mode: `pg_dump -Fc`
 * (custom format, restore with pg_restore). The password goes through PGPASSWORD,
 * never on the command line.
 */
export async function createBackup(config: AppConfig, now = new Date()): Promise<BackupResult> {
  const dir = resolve(config.BACKUP_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  if (!config.DATABASE_URL) {
    const src = jsonDataFile(config);
    await readJsonData(src); // refuse to back up a corrupt file silently
    const file = join(dir, `thiran-${stamp(now)}.json`);
    await copyFile(src, file, constants.COPYFILE_EXCL);
    await chmod(file, 0o600); // backups are confidential
    return { file, bytes: (await stat(file)).size, kind: 'json' };
  }

  const url = new URL(config.DATABASE_URL);
  const file = join(dir, `thiran-${stamp(now)}.dump`);
  const argv = [
    'pg_dump',
    '--format=custom',
    `--file=${file}`,
    `--host=${url.hostname}`,
    `--port=${url.port || '5432'}`,
    `--username=${decodeURIComponent(url.username)}`,
    `--dbname=${decodeURIComponent(url.pathname.slice(1))}`,
    '--no-password',
  ];
  const sslmode = url.searchParams.get('sslmode');
  const r = await runCommand({
    argv,
    cwd: dir,
    timeoutMs: 30 * 60_000,
    maxOutput: 10_000,
    extraEnv: {
      PGPASSWORD: decodeURIComponent(url.password),
      ...(sslmode && { PGSSLMODE: sslmode }),
    },
  });
  if (r.status !== 'passed') {
    // pg_dump output never contains the password (it was not on the command line).
    throw new Error(
      `pg_dump failed (${r.status}, exit ${r.exitCode}): ${r.output.trim().slice(-500)}`,
    );
  }
  await chmod(file, 0o600); // backups are confidential
  return { file, bytes: (await stat(file)).size, kind: 'postgres' };
}

export async function latestBackup(config: AppConfig): Promise<{ file: string; at: Date } | null> {
  const dir = resolve(config.BACKUP_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let best: { file: string; at: Date } | null = null;
  for (const n of names) {
    if (!BACKUP_FILE.test(n)) continue;
    const st = await stat(join(dir, n)).catch(() => null);
    if (st?.isFile() && (!best || st.mtime > best.at)) best = { file: n, at: st.mtime };
  }
  return best;
}

/** Is a Thiran server answering on the configured address? */
export async function serverIsRunning(config: AppConfig): Promise<boolean> {
  try {
    const host = config.HOST.includes(':') ? `[${config.HOST}]` : config.HOST;
    const res = await fetch(`http://${host}:${config.PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Restore a JSON backup (JSON mode only). The current data file is saved first as
 * a "pre-restore" backup; the replacement is atomic. Refuses while the server runs,
 * because a running server would overwrite the file from memory.
 */
export async function restoreJsonBackup(config: AppConfig, backupPath: string, now = new Date()) {
  if (config.DATABASE_URL)
    throw new Error('PostgreSQL mode: restore with pg_restore (see docs/OPERATIONS.md).');
  if (!BACKUP_FILE.test(basename(backupPath)) || !backupPath.endsWith('.json')) {
    throw new Error('Not a Thiran JSON backup file name.');
  }
  if (await serverIsRunning(config)) throw new Error('Stop the Thiran server before restoring.');
  await readJsonData(backupPath); // must be valid before we touch anything

  const target = jsonDataFile(config);
  const dir = resolve(config.BACKUP_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let safety: string | null = null;
  try {
    await stat(target);
    safety = join(dir, `thiran-${stamp(now)}-pre-restore.json`);
    await copyFile(target, safety, constants.COPYFILE_EXCL);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const tmp = `${target}.${randomBytes(4).toString('hex')}.restore`;
  await mkdir(resolve(config.DATA_DIR), { recursive: true, mode: 0o700 });
  await copyFile(backupPath, tmp);
  await rename(tmp, target);
  return { restoredFrom: backupPath, safetyCopy: safety };
}
