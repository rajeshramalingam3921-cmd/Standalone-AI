import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/ai/anthropic.js';
import { AiAbortedError, AiProviderError } from '../src/ai/types.js';

/** A local stand-in for the Messages API so the real SDK code path is exercised offline. */
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler;
let server: Server;
let baseURL: string;
let lastRequest: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastRequest = { headers: req.headers, body: body ? JSON.parse(body) : {} };
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

function sse(
  res: ServerResponse,
  events: object[],
  opts: { delayMs?: number; hang?: boolean } = {},
) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  let i = 0;
  const next = () => {
    if (res.destroyed) return;
    if (i >= events.length) return opts.hang ? undefined : res.end();
    const e = events[i++] as { type: string };
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    setTimeout(next, opts.delayMs ?? 0);
  };
  next();
}

const messageEvents = (texts: string[], stopReason: string, model = 'claude-opus-5-5') => [
  {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 12,
        output_tokens: 1,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 5,
      },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...texts.map((t) => ({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: t },
  })),
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null, stop_details: null },
    usage: { output_tokens: 7 },
  },
  { type: 'message_stop' },
];

function errorReply(status: number, type: string, headers: Record<string, string> = {}): Handler {
  return (_req, _body, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ type: 'error', error: { type, message: 'test error' } }));
  };
}

function provider(timeoutMs = 5000) {
  return createAnthropicProvider({
    apiKey: 'sk-test-not-real',
    maxTokens: 1000,
    effort: 'high',
    timeoutMs,
    client: new Anthropic({
      apiKey: 'sk-test-not-real',
      baseURL,
      maxRetries: 0,
      timeout: timeoutMs,
    }),
  });
}

async function run(p = provider(), signal = new AbortController().signal) {
  const chunks: string[] = [];
  const result = await p.streamChat({
    model: 'claude-opus-5-5',
    system: 'SYSTEM',
    messages: [{ role: 'user', content: 'hello' }],
    signal,
    onText: (t) => chunks.push(t),
  });
  return { result, text: chunks.join('') };
}

describe('Anthropic provider (against a local fake API)', () => {
  it('streams text and reports usage, stop reason and served model', async () => {
    handler = (_req, _body, res) => sse(res, messageEvents(['வணக்கம்', ' world'], 'end_turn'));
    const { result, text } = await run();
    expect(text).toBe('வணக்கம் world');
    expect(result).toEqual({
      stop: 'complete',
      usage: { inputTokens: 20, outputTokens: 7 },
      servedModel: 'claude-opus-5-5',
    });
  });

  it('sends the expected request: model, system, effort, caching, safety fallback', async () => {
    handler = (_req, _body, res) => sse(res, messageEvents(['ok'], 'end_turn'));
    await run();
    const { body, headers } = lastRequest!;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toBe('SYSTEM');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1000);
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.fallbacks).toBe('default');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    // SDK 1.x sends the key in the Authorization header.
    expect(String(headers.authorization)).toContain('sk-test-not-real');
  });

  it('maps refusal and max_tokens stop reasons', async () => {
    handler = (_req, _body, res) => sse(res, messageEvents([], 'refusal'));
    expect((await run()).result.stop).toBe('refused');
    handler = (_req, _body, res) => sse(res, messageEvents(['partial'], 'max_tokens'));
    expect((await run()).result.stop).toBe('truncated');
  });

  it('reports the fallback model when a fallback served the answer', async () => {
    handler = (_req, _body, res) => sse(res, messageEvents(['ok'], 'end_turn', 'claude-opus-4-8'));
    expect((await run()).result.servedModel).toBe('claude-opus-4-8');
  });

  it.each([
    [401, 'authentication_error', 'auth'],
    [403, 'permission_error', 'permission'],
    [404, 'not_found_error', 'model_unavailable'],
    [400, 'invalid_request_error', 'bad_request'],
    [500, 'api_error', 'overloaded'],
    [529, 'overloaded_error', 'overloaded'],
  ])('maps HTTP %i to %s → %s', async (status, type, code) => {
    handler = errorReply(status, type);
    await expect(run()).rejects.toMatchObject({ code });
  });

  it('maps 429 with retry-after', async () => {
    handler = errorReply(429, 'rate_limit_error', { 'retry-after': '17' });
    const e = await run().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiProviderError);
    expect(e).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 17 });
  });

  it('maps a mid-stream error event', async () => {
    handler = (_req, _body, res) =>
      sse(res, [
        ...messageEvents(['part'], 'end_turn').slice(0, 3),
        { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },
      ]);
    await expect(run()).rejects.toMatchObject({ code: 'overloaded' });
  });

  it('times out when the API does not answer', async () => {
    handler = () => {}; // never responds
    await expect(run(provider(300))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('stops promptly when aborted mid-stream', async () => {
    handler = (_req, _body, res) =>
      sse(res, messageEvents(['a', 'b', 'c', 'd', 'e'], 'end_turn'), { delayMs: 100, hang: true });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const started = Date.now();
    await expect(run(provider(), ac.signal)).rejects.toBeInstanceOf(AiAbortedError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('is "not configured" without a key and never calls the API', async () => {
    const p = createAnthropicProvider({
      apiKey: undefined,
      maxTokens: 10,
      effort: 'low',
      timeoutMs: 1000,
    });
    expect(p.configured).toBe(false);
    await expect(run(p)).rejects.toMatchObject({ code: 'not_configured' });
  });
});
