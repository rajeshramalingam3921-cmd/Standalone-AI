import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { isHealthResponse } from '@thiran/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function makeApp() {
  app = buildApp(loadConfig({ NODE_ENV: 'test' }));
  return app;
}

describe('HTTP app', () => {
  it('GET /api/health returns the shared health contract', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(isHealthResponse(res.json())).toBe(true);
  });

  it('sets security headers', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'Route not found.' });
  });

  it('hides internal error details from clients', async () => {
    const a = makeApp();
    a.get('/boom', async () => {
      throw new Error('db password is hunter2');
    });
    const res = await a.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.json()).toEqual({ error: 'internal_error', message: 'Something went wrong.' });
  });
});

describe('client errors', () => {
  it('passes 4xx messages through (e.g. malformed JSON)', async () => {
    const a = makeApp();
    a.post('/echo', async (req) => req.body);
    const res = await a.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('request_error');
  });
});
