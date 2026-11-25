import { join, resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import { pendingMigrations } from '../db/migrations.js';
import { createJsonFileStore } from './json-file-store.js';
import { createPool, createPostgresStore } from './postgres-store.js';
import type { Store } from './types.js';

export class PendingMigrationsError extends Error {
  constructor(readonly pending: string[]) {
    super(
      `Database has ${pending.length} pending migration(s): ${pending.join(', ')}. ` +
        'Back up the database, then run `pnpm db:migrate`.',
    );
    this.name = 'PendingMigrationsError';
  }
}

export const jsonDataFile = (config: AppConfig) => join(resolve(config.DATA_DIR), 'thiran.json');

/**
 * Open the configured store. PostgreSQL when DATABASE_URL is set, otherwise the JSON file.
 * Never applies migrations implicitly — the server refuses to start until they are applied.
 */
export async function openStore(
  config: AppConfig,
  opts: { allowPending?: boolean } = {},
): Promise<Store> {
  if (!config.DATABASE_URL) return createJsonFileStore({ file: jsonDataFile(config) });

  const pool = createPool(config.DATABASE_URL);
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length > 0 && !opts.allowPending) throw new PendingMigrationsError(pending);
  } catch (err) {
    await pool.end();
    throw err;
  }
  return createPostgresStore({ pool });
}
