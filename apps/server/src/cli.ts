/**
 * Administrative commands. Run on the machine that hosts the server:
 *   pnpm db:migrate [--yes]          apply pending PostgreSQL migrations
 *   pnpm set-password                set or change the owner password (signs out all sessions)
 *   pnpm db:import-json [--yes]      copy JSON-file data into an empty PostgreSQL database
 *   pnpm backup                      JSON copy or pg_dump into BACKUP_DIR
 *   pnpm restore <file> [--yes]      restore a JSON backup (JSON mode, server stopped)
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { AuditInput } from './audit.js';
import { createBackup, restoreJsonBackup } from './backup.js';
import { loadConfig } from './config.js';
import { loadEnvFile } from './env-file.js';
import { applyMigrations, pendingMigrations } from './db/migrations.js';
import { checkPasswordStrength, hashPassword } from './auth/password.js';
import { readJsonData } from './store/json-file-store.js';
import { jsonDataFile, openStore } from './store/open.js';
import { createPool, importSnapshot } from './store/postgres-store.js';
import type { Store } from './store/types.js';

const out = (s: string) => process.stdout.write(`${s}\n`);

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Suppress echo of typed characters while keeping the prompt visible.
      const rlAny = rl as unknown as {
        _writeToOutput: (s: string) => void;
        output: NodeJS.WriteStream;
      };
      rlAny._writeToOutput = (s: string) => {
        if (s.includes(question)) rlAny.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    out('Not an interactive terminal. Re-run with --yes to confirm.');
    return false;
  }
  return /^y(es)?$/i.test((await ask(`${question} [y/N] `)).trim());
}

async function migrateCmd(yes: boolean) {
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is not set; nothing to migrate.');
  const pool = createPool(config.DATABASE_URL);
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length === 0) return out('Database is up to date.');
    out('Pending migrations (SQL files in apps/server/drizzle/):');
    for (const m of pending) out(`  - ${m}.sql`);
    out('Make sure you have a recent backup (e.g. pg_dump) before continuing.');
    if (!(await confirm('Apply these migrations now?', yes))) return out('Cancelled.');
    await applyMigrations(pool);
    out(`Applied ${pending.length} migration(s).`);
  } finally {
    await pool.end();
  }
}

async function setPasswordCmd() {
  const config = loadConfig();
  const store = await openStore(config);
  try {
    if (!process.stdin.isTTY)
      throw new Error('set-password must be run in an interactive terminal.');
    const pw = await ask('New owner password: ', true);
    const problem = checkPasswordStrength(pw);
    if (problem) throw new Error(problem);
    if ((await ask('Repeat password: ', true)) !== pw) throw new Error('Passwords do not match.');
    await store.setOwnerPasswordHash(await hashPassword(pw));
    await audit(store, { actor: 'owner', action: 'auth.password_set', detail: { via: 'cli' } });
    out(`Owner password saved (${store.kind} store). All existing sessions were signed out.`);
  } finally {
    await store.close();
  }
}

async function importJsonCmd(yes: boolean) {
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('Set DATABASE_URL to the target PostgreSQL database.');
  const file = jsonDataFile(config);
  const data = await readJsonData(file);
  out(`Source: ${file}`);
  out(
    `  ${data.projects.length} project(s), ${data.tasks.length} task(s), owner password: ${data.owner ? 'yes' : 'no'}`,
  );
  out('The target database must be empty. The JSON file is left unchanged.');
  if (!(await confirm('Import now?', yes))) return out('Cancelled.');
  const pool = createPool(config.DATABASE_URL);
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length) throw new Error('Run `pnpm db:migrate` first.');
    const r = await importSnapshot(pool, data);
    const { createPostgresStore } = await import('./store/postgres-store.js');
    await audit(createPostgresStore({ pool }), {
      actor: 'owner',
      action: 'data.imported',
      detail: { projects: r.projects, tasks: r.tasks },
    });
    out(`Imported ${r.projects} project(s) and ${r.tasks} task(s).`);
  } finally {
    await pool.end();
  }
}

async function audit(store: { appendAudit: Store['appendAudit'] }, e: AuditInput) {
  await store.appendAudit({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: e.actor,
    action: e.action,
    projectId: null,
    targetType: null,
    targetId: null,
    detail: e.detail ?? {},
  });
}

async function backupCmd() {
  const config = loadConfig();
  const r = await createBackup(config);
  out(`Backup written: ${r.file} (${r.bytes} bytes, ${r.kind}).`);
  out('Copy the backup folder to another disk or cloud storage you control.');
  // The backup itself succeeded. Recording it must never turn that into a failure:
  // e.g. the backup taken right before a migration runs against the old schema.
  try {
    const store = await openStore(config, { allowPending: true });
    try {
      await audit(store, {
        actor: 'system',
        action: 'backup.created',
        detail: { file: r.file.split(/[\\/]/).pop()!, bytes: r.bytes },
      });
    } finally {
      await store.close();
    }
  } catch {
    out('(Audit entry not recorded — the database schema may be older; run `pnpm db:migrate`.)');
  }
}

async function restoreCmd(file: string | undefined, yes: boolean) {
  if (!file) throw new Error('Usage: pnpm restore <backup-file.json> [--yes]');
  const config = loadConfig();
  out(
    `Restore ${file} over the current data. The current file is saved first as a pre-restore backup.`,
  );
  if (!(await confirm('Continue?', yes))) return out('Cancelled.');
  const r = await restoreJsonBackup(config, file);
  out(`Restored. Previous data saved as: ${r.safetyCopy ?? '(there was no previous data file)'}`);
}

async function main() {
  loadEnvFile();
  const [cmd, ...args] = process.argv.slice(2);
  const yes = args.includes('--yes');
  switch (cmd) {
    case 'migrate':
      return migrateCmd(yes);
    case 'set-password':
      return setPasswordCmd();
    case 'import-json':
      return importJsonCmd(yes);
    case 'backup':
      return backupCmd();
    case 'restore':
      return restoreCmd(
        args.find((a) => !a.startsWith('--')),
        yes,
      );
    default:
      out('Usage: cli <migrate|set-password|import-json|backup|restore <file>> [--yes]');
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  const e = err as { message?: string; code?: string };
  process.stderr.write(`Error: ${e.code ? `${e.code} ` : ''}${e.message ?? String(err)}\n`);
  process.exit(1);
});
