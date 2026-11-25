import { afterEach, describe, expect, it } from 'vitest';
import { isHealthResponse } from '@thiran/shared';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.app.close();
  t = undefined;
});

async function setup() {
  t = await makeTestApp();
  return t;
}

describe('HTTP app', () => {
  it('GET /api/health is public and returns the shared health contract', async () => {
    const res = await (await setup()).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(isHealthResponse(res.json())).toBe(true);
  });

  it('sets security headers', async () => {
    const res = await (await setup()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns a JSON 404 for unknown non-API routes', async () => {
    const res = await (await setup()).get('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'Route not found.' });
  });

  it('hides internal error details from clients', async () => {
    t = await makeTestApp({
      setup: (app) =>
        app.get('/api/boom', async () => {
          throw new Error('db password is hunter2');
        }),
    });
    const { get, cookie } = t;
    const res = await get('/api/boom', cookie);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.json()).toEqual({ error: 'internal_error', message: 'Something went wrong.' });
  });

  it('passes 4xx messages through (e.g. malformed JSON)', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json', cookie },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('request_error');
  });
});

describe('request guards', () => {
  it('rejects requests for foreign host names (DNS rebinding)', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'evil.example:4000' },
    });
    expect(res.statusCode).toBe(421);
  });

  it('rejects non-JSON state-changing requests (CSRF)', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'text/plain', cookie },
      payload: '{"name":"x"}',
    });
    expect(res.statusCode).toBe(415);
  });

  it('applies a general per-client rate limit', async () => {
    t = await makeTestApp({ env: { RATE_LIMIT_PER_MINUTE: '10' } });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await t.get('/api/health')).statusCode);
    expect(codes.slice(0, 9).every((c) => c === 200)).toBe(true);
    const last = await t.get('/api/health');
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toBe('rate_limited');
  });
});
