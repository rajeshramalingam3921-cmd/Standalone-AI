import { afterEach, describe, expect, it } from 'vitest';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../src/auth/password.js';
import { hashToken } from '../src/auth/routes.js';
import { TEST_PASSWORD, fastHash, makeTestApp, type TestApp } from './helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.app.close();
  t = undefined;
});

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const h = await fastHash('a long enough password');
    expect(h.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await verifyPassword('a long enough password', h)).toBe(true);
    expect(await verifyPassword('a long enough passworD', h)).toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    expect(await fastHash('same password!!')).not.toBe(await fastHash('same password!!'));
  });

  it('uses a strong default cost', async () => {
    expect((await hashPassword('another password')).startsWith('scrypt$32768$8$1$')).toBe(true);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    for (const bad of ['', 'plain', 'scrypt$x$8$1$aa$bb', 'scrypt$1024$8$1$c2FsdA==$']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('enforces minimum strength', () => {
    expect(checkPasswordStrength('short')).toBeDefined();
    expect(checkPasswordStrength('aaaaaaaaaaaaaaaa')).toBeDefined();
    expect(checkPasswordStrength('a reasonable passphrase')).toBeUndefined();
  });
});

describe('auth routes', () => {
  it('reports setup required when no owner password exists', async () => {
    t = await makeTestApp({ withOwner: false });
    expect((await t.get('/api/auth/session')).json()).toEqual({
      authenticated: false,
      setupRequired: true,
    });
    const res = await t.post('/api/auth/login', { password: 'whatever password' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('setup_required');
  });

  it('issues a hardened session cookie and stores only its hash', async () => {
    t = await makeTestApp({ withOwner: true });
    const res = await t.post('/api/auth/login', { password: TEST_PASSWORD });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'thiran_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    expect(c.path).toBe('/');
    expect(c.value.length).toBeGreaterThanOrEqual(43);
    expect(await t.store.getSession(c.value)).toBeUndefined();
    expect(await t.store.getSession(hashToken(c.value))).toBeDefined();
    expect((await t.get('/api/auth/session', `thiran_session=${c.value}`)).json()).toEqual({
      authenticated: true,
      setupRequired: false,
    });
  });

  it('rejects a wrong password without setting a cookie', async () => {
    t = await makeTestApp();
    const res = await t.post('/api/auth/login', { password: 'wrong password here' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_credentials');
    expect(res.cookies).toHaveLength(0);
  });

  it('rate-limits login attempts', async () => {
    t = await makeTestApp({ env: { LOGIN_RATE_LIMIT_MAX: '3' } }); // setup used 1 attempt
    const codes = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await t.post('/api/auth/login', { password: 'guess number ' + i })).statusCode);
    }
    expect(codes).toEqual([401, 401, 429]);
    // Even the correct password is refused while limited.
    expect((await t.post('/api/auth/login', { password: TEST_PASSWORD })).statusCode).toBe(429);
  });

  it('logout invalidates the session server-side', async () => {
    t = await makeTestApp();
    expect((await t.get('/api/projects', t.cookie)).statusCode).toBe(200);
    const out = await t.post('/api/auth/logout', {}, t.cookie);
    expect(out.statusCode).toBe(200);
    expect((await t.get('/api/projects', t.cookie)).statusCode).toBe(401);
  });

  it('rejects expired sessions', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    t = await makeTestApp({ env: { SESSION_TTL_DAYS: '1' }, now: () => now });
    expect((await t.get('/api/projects', t.cookie)).statusCode).toBe(200);
    now = new Date('2026-01-02T00:00:01Z');
    expect((await t.get('/api/projects', t.cookie)).statusCode).toBe(401);
  });

  it('changing the password signs out every session', async () => {
    t = await makeTestApp();
    await t.store.setOwnerPasswordHash(await fastHash('a brand new password'));
    expect((await t.get('/api/projects', t.cookie)).statusCode).toBe(401);
  });

  it('rejects forged or oversized cookies', async () => {
    t = await makeTestApp();
    expect((await t.get('/api/projects', 'thiran_session=forged')).statusCode).toBe(401);
    expect((await t.get('/api/projects', `thiran_session=${'x'.repeat(500)}`)).statusCode).toBe(
      401,
    );
  });

  it('marks the cookie Secure when COOKIE_SECURE=true', async () => {
    t = await makeTestApp({ env: { COOKIE_SECURE: 'true' }, withOwner: true });
    const res = await t.post('/api/auth/login', { password: TEST_PASSWORD });
    expect(res.cookies.find((x) => x.name === 'thiran_session')?.secure).toBe(true);
  });
});
