/**
 * Administrative commands. Run on the machine that hosts the server:
 *   pnpm db:migrate [--yes]          apply pending PostgreSQL migrations
 *   pnpm set-password                set or change the owner password (signs out all sessions)
 *   pnpm db:import-json [--yes]      copy JSON-file data into an empty PostgreSQL database
 */
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { loadEnvFile } from './env-file.js';
import { applyMigrations, pendingMigrations } from './db/migrations.js';
import { checkPasswordStrength, hashPassword } from './auth/password.js';
import { readJsonData } from './store/json-file-store.js';
import { jsonDataFile, openStore } from './store/open.js';
import { createPool, importSnapshot } from './store/postgres-store.js';

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
    out(`Imported ${r.projects} project(s) and ${r.tasks} task(s).`);
  } finally {
    await pool.end();
  }
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
    default:
      out('Usage: cli <migrate|set-password|import-json> [--yes]');
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  const e = err as { message?: string; code?: string };
  process.stderr.write(`Error: ${e.code ? `${e.code} ` : ''}${e.message ?? String(err)}\n`);
  process.exit(1);
});
