import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent } from '@thiran/shared';
import { makeTestApp, type TestApp } from './helpers.js';

let web: string;
let t: TestApp | undefined;
beforeEach(async () => {
  web = await mkdtemp(join(tmpdir(), 'thiran-web-'));
  await mkdir(join(web, 'assets'));
  await writeFile(join(web, 'index.html'), '<!doctype html><title>திறன் AI</title>');
  await writeFile(join(web, 'assets', 'index-abc123.js'), 'console.log(1)');
  await writeFile(join(web, 'manifest.webmanifest'), '{}');
});
afterEach(async () => {
  await t?.app.close();
  t = undefined;
  await rm(web, { recursive: true, force: true });
});

describe('production: serving the web UI', () => {
  it('serves index.html publicly with a strict same-origin CSP and no caching', async () => {
    t = await makeTestApp({ webDir: web });
    const res = await t.get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('திறன் AI');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('caches hashed assets long-term', async () => {
    t = await makeTestApp({ webDir: web });
    const res = await t.get('/assets/index-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('keeps the API locked down: JSON CSP, no-store, auth required', async () => {
    t = await makeTestApp({ webDir: web });
    const api = await t.get('/api/projects');
    expect(api.statusCode).toBe(401);
    expect(api.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(api.headers['cache-control']).toBe('no-store');
  });

  it('does not expose files outside the web folder', async () => {
    t = await makeTestApp({ webDir: web });
    for (const url of ['/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/assets/../../secret']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).not.toBe(200);
    }
  });
});

describe('production: running behind a local proxy (TRUST_PROXY)', () => {
  const forwarded = { 'x-forwarded-for': '100.101.102.103' };

  it('ignores X-Forwarded-For unless TRUST_PROXY is set', async () => {
    t = await makeTestApp({ withOwner: true });
    await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.0.1',
      headers: { 'content-type': 'application/json', ...forwarded },
      payload: '{"password":"nope-nope-nope"}',
    });
    const ev = (await t.get('/api/audit', t.cookie)).json<AuditEvent[]>()[0]!;
    expect(ev.detail.ip).toBe('127.0.0.1');
  });

  it('uses the forwarded client address from a loopback proxy when TRUST_PROXY=true', async () => {
    t = await makeTestApp({ env: { TRUST_PROXY: 'true' } });
    await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.0.1',
      headers: { 'content-type': 'application/json', ...forwarded },
      payload: '{"password":"nope-nope-nope"}',
    });
    const ev = (await t.get('/api/audit', t.cookie)).json<AuditEvent[]>()[0]!;
    expect(ev.detail.ip).toBe('100.101.102.103');
  });

  it('never trusts forwarded headers from a non-local peer', async () => {
    t = await makeTestApp({ env: { TRUST_PROXY: 'true' } });
    await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.9',
      headers: { 'content-type': 'application/json', ...forwarded },
      payload: '{"password":"nope-nope-nope"}',
    });
    const ev = (await t.get('/api/audit', t.cookie)).json<AuditEvent[]>()[0]!;
    expect(ev.detail.ip).toBe('203.0.113.9');
  });
});

describe('.env isolation', () => {
  it('THIRAN_NO_ENV_FILE=1 skips the .env file entirely', async () => {
    const { loadEnvFile } = await import('../src/env-file.js');
    const dir = await mkdtemp(join(tmpdir(), 'thiran-env-'));
    const file = join(dir, '.env');
    await writeFile(file, 'DATABASE_URL=postgresql://real:secret@prod/db\n');
    const env: NodeJS.ProcessEnv = { THIRAN_NO_ENV_FILE: '1' };
    loadEnvFile(file, env);
    expect(env.DATABASE_URL).toBeUndefined();
    const env2: NodeJS.ProcessEnv = {};
    loadEnvFile(file, env2);
    expect(env2.DATABASE_URL).toBe('postgresql://real:secret@prod/db');
    await rm(dir, { recursive: true, force: true });
  });
});
