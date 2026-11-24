import { describe, expect, it } from 'vitest';
import { fetchHealth } from '../src/api';

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fetchHealth', () => {
  it('returns ok for a valid health payload', async () => {
    const r = await fetchHealth(
      json({ status: 'ok', service: 'thiran-server', version: '0.1.0', uptimeSeconds: 3 }),
    );
    expect(r.kind).toBe('ok');
  });

  it('reports HTTP errors', async () => {
    const r = await fetchHealth(json({}, 503));
    expect(r).toEqual({ kind: 'error', message: 'Server பதில்: HTTP 503' });
  });

  it('rejects malformed payloads', async () => {
    const r = await fetchHealth(json({ status: 'ok' }));
    expect(r.kind).toBe('error');
  });

  it('handles network failures without throwing', async () => {
    const failing = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    expect((await fetchHealth(failing)).kind).toBe('error');
  });

  it('times out', async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const r = await fetchHealth(hanging, 10);
    expect(r).toEqual({ kind: 'error', message: 'Server பதில் தரவில்லை (timeout)' });
  });
});
