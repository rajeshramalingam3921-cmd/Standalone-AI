import { join, resolve } from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { StoreCorruptError } from './store/errors.js';
import { createJsonFileStore } from './store/json-file-store.js';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }

  let store;
  try {
    store = await createJsonFileStore({ file: join(resolve(config.DATA_DIR), 'thiran.json') });
  } catch (err) {
    if (err instanceof StoreCorruptError) fail(err.message);
    throw err;
  }

  const app = buildApp(config, store);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

void main();
