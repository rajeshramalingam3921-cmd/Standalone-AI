import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** Repository-root .env (same relative location from src/ and dist/). */
export const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * Load .env into process.env without overriding variables that are already set.
 * A missing file is fine; values are never printed.
 */
export function loadEnvFile(file = ENV_FILE, env: NodeJS.ProcessEnv = process.env): void {
  // Isolated runs (e.g. the end-to-end test) must never pick up the owner's real settings.
  if (env.THIRAN_NO_ENV_FILE === '1') return;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const [k, v] of Object.entries(parseEnv(raw))) {
    if (env[k] === undefined) env[k] = v;
  }
}
