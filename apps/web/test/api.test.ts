import { describe, expect, it } from 'vitest';
import { fetchHealth, request } from '../src/api';

const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fetchHealth', () => {
  it('returns ok for a valid health payload', async () => {
    const r = await fetchHealth(
      reply({ status: 'ok', service: 'thiran-server', version: '0.1.0', uptimeSeconds: 3 }),
    );
    expect(r.kind).toBe('ok');
  });

  it('reports HTTP errors', async () => {
    expect(await fetchHealth(reply({}, 503))).toEqual({
      kind: 'error',
      message: 'Server பதில்: HTTP 503',
    });
  });

  it('rejects malformed payloads', async () => {
    expect((await fetchHealth(reply({ status: 'ok' }))).kind).toBe('error');
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
    expect(await fetchHealth(hanging, 10)).toEqual({
      kind: 'error',
      message: 'Server பதில் தரவில்லை (timeout)',
    });
  });
});

describe('request', () => {
  it('sends JSON bodies with the JSON content type', async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_u: string, init?: RequestInit) => {
      seen = init;
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    await request('/api/projects', { method: 'POST', body: { name: 'x' } }, spy);
    expect(seen?.method).toBe('POST');
    expect((seen?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(seen?.body).toBe('{"name":"x"}');
  });

  it('maps API error codes to Tamil messages and keeps field issues', async () => {
    const r = await request(
      '/x',
      {},
      reply(
        { error: 'validation_error', message: 'x', issues: [{ path: 'name', message: 'req' }] },
        400,
      ),
    );
    expect(r).toEqual({
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'சில விவரங்கள் தவறாக உள்ளன',
      issues: [{ path: 'name', message: 'req' }],
    });
    expect(await request('/x', {}, reply({ error: 'conflict' }, 409))).toMatchObject({
      message: 'இந்தப் பெயரில் ஏற்கனவே ஒன்று உள்ளது',
    });
  });
});
