import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses safe defaults (loopback only)', () => {
    const c = loadConfig({});
    expect(c.HOST).toBe('127.0.0.1');
    expect(c.PORT).toBe(4000);
    expect(c.ALLOW_NON_LOOPBACK).toBe(false);
  });

  it('refuses to bind 0.0.0.0 without explicit opt-in', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(loadConfig({ HOST: '0.0.0.0', ALLOW_NON_LOOPBACK: 'true' }).HOST).toBe('0.0.0.0');
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('does not echo raw values in error messages', () => {
    try {
      loadConfig({ LOG_LEVEL: 'sk-super-secret-value' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('sk-super-secret-value');
    }
  });
});
