import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { loadConfig } from '../src/config.js';
import { createJsonFileStore } from '../src/store/json-file-store.js';
import type { Store } from '../src/store/types.js';

export const TEST_PASSWORD = 'correct horse battery staple';
/** Low scrypt cost keeps tests fast; production uses the default cost. */
export const fastHash = (pw: string) => hashPassword(pw, { N: 1024, r: 8, p: 1 });

export interface TestApp {
  app: FastifyInstance;
  store: Store;
  /** Cookie header value for an authenticated owner session. */
  cookie: string;
  post: (url: string, body: unknown, cookie?: string) => Promise<LightMyRequestResponse>;
  get: (url: string, cookie?: string) => Promise<LightMyRequestResponse>;
}

export async function makeTestApp(
  opts: {
    env?: Record<string, string>;
    now?: () => Date;
    withOwner?: boolean;
    /** Register extra routes before the app becomes ready. */
    setup?: (app: FastifyInstance) => void;
  } = {},
): Promise<TestApp> {
  const store = await createJsonFileStore({ file: null });
  if (opts.withOwner !== false) await store.setOwnerPasswordHash(await fastHash(TEST_PASSWORD));
  const app = await buildApp(
    loadConfig({ NODE_ENV: 'test', ...opts.env }),
    store,
    opts.now ? { now: opts.now } : {},
  );
  opts.setup?.(app);

  const post = (url: string, body: unknown, cookie?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      payload: JSON.stringify(body),
    });
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  let cookie = '';
  if (opts.withOwner !== false) {
    const res = await post('/api/auth/login', { password: TEST_PASSWORD });
    const c = res.cookies.find((x) => x.name === 'thiran_session');
    if (!c) throw new Error(`login failed in test setup: ${res.statusCode}`);
    cookie = `thiran_session=${c.value}`;
  }
  return { app, store, cookie, post, get };
}
