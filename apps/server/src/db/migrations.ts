import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/** apps/server/drizzle — same relative location from src/db and dist/db. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

interface Journal {
  entries: { idx: number; tag: string }[];
}

/** Migration tags (file names without .sql) that exist in the repository. */
export async function listMigrations(): Promise<string[]> {
  const raw = await readFile(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8');
  return (JSON.parse(raw) as Journal).entries.sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

/** Migrations not yet applied to this database, in order. */
export async function pendingMigrations(pool: Pool): Promise<string[]> {
  const all = await listMigrations();
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  if (!rows[0]?.exists) return all;
  const applied = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations',
  );
  return all.slice(Number(applied.rows[0]?.n ?? 0));
}

/** Apply pending migrations. Only called from the explicit `db:migrate` command and tests. */
export async function applyMigrations(pool: Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
}
