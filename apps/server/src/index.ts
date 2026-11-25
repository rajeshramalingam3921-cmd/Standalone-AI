import { buildApp } from './app.js';
import { loadEnvFile } from './env-file.js';
import { ConfigError, loadConfig } from './config.js';
import { StoreCorruptError } from './store/errors.js';
import { PendingMigrationsError, openStore } from './store/open.js';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }

  let store;
  try {
    store = await openStore(config);
  } catch (err) {
    if (err instanceof StoreCorruptError || err instanceof PendingMigrationsError)
      fail(err.message);
    // Connection errors can include host names; print only the error code/class.
    const code = (err as { code?: string }).code;
    fail(`Could not open the data store (${code ?? (err as Error).name}). Check DATABASE_URL.`);
  }

  if (!(await store.getOwnerPasswordHash())) {
    process.stderr.write('No owner password set yet. Run `pnpm set-password` before signing in.\n');
  }

  const app = await buildApp(config, store);
  app.log.info({ store: store.kind }, 'Data store ready');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

void main();
