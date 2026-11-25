import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/ai/anthropic.js';
import type { AgentRunRequest } from '../src/ai/types.js';

/** Fake Messages API: each request gets the next scripted turn. */
type Turn = { blocks: Block[]; stop: string; usage?: { input: number; output: number } };
type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

let server: Server;
let baseURL: string;
let script: Turn[] = [];
let requests: Record<string, unknown>[] = [];

function sendTurn(res: ServerResponse, t: Turn) {
  const ev = (e: object) =>
    res.write(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  ev({
    type: 'message_start',
    message: {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: t.usage?.input ?? 100, output_tokens: 1 },
    },
  });
  t.blocks.forEach((b, index) => {
    if (b.type === 'text') {
      ev({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      ev({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else if (b.type === 'thinking') {
      ev({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      });
      ev({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: b.signature },
      });
    } else {
      ev({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
      });
      ev({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
      });
    }
    ev({ type: 'content_block_stop', index });
  });
  ev({
    type: 'message_delta',
    delta: { stop_reason: t.stop, stop_sequence: null, stop_details: null },
    usage: { output_tokens: t.usage?.output ?? 10 },
  });
  ev({ type: 'message_stop' });
  res.end();
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const turn = script.shift();
      if (!turn) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'no script' } }),
        );
      }
      sendTurn(res, turn);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  script = [];
  requests = [];
});

const provider = () =>
  createAnthropicProvider({
    apiKey: 'sk-test',
    maxTokens: 2000,
    effort: 'high',
    timeoutMs: 5000,
    client: new Anthropic({ apiKey: 'sk-test', baseURL, maxRetries: 0 }),
  });

function req(over: Partial<AgentRunRequest> = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const r: AgentRunRequest = {
    model: 'claude-opus-5-5',
    system: 'SYS',
    prompt: 'Plan the task',
    tools: [
      {
        name: 'read_file',
        description: 'read',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      { name: 'submit_plan', description: 'plan', inputSchema: { type: 'object', properties: {} } },
    ],
    maxTurns: 5,
    tokenBudget: 1_000_000,
    signal: new AbortController().signal,
    execute: async (name, input) => {
      calls.push({ name, input });
      if (name === 'submit_plan') return { content: 'ok', stop: true };
      if ((input as { path?: string }).path === 'boom') throw new Error('disk on fire');
      return { content: `content of ${(input as { path: string }).path}` };
    },
    ...over,
  };
  return { r, calls };
}

describe('Anthropic agent loop (fake API)', () => {
  it('runs parallel tool calls, returns all results in one message, echoes thinking, stops on a stop tool', async () => {
    script = [
      {
        blocks: [
          { type: 'thinking', signature: 'sig-1' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.ts' } },
          { type: 'tool_use', id: 't2', name: 'read_file', input: { path: 'boom' } },
        ],
        stop: 'tool_use',
      },
      {
        blocks: [{ type: 'tool_use', id: 't3', name: 'submit_plan', input: {} }],
        stop: 'tool_use',
      },
    ];
    const { r, calls } = req();
    const res = await provider().runAgent(r);
    expect(res.stop).toBe('tool_stop');
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
    expect(calls.map((c) => c.name)).toEqual(['read_file', 'read_file', 'submit_plan']);
    expect(calls[0]!.input).toEqual({ path: 'a.ts' });

    expect(requests).toHaveLength(2);
    const first = requests[0]!;
    expect(first.tool_choice).toBeUndefined(); // never forced
    expect(
      (first.tools as { eager_input_streaming?: boolean }[]).every((t) => t.eager_input_streaming),
    ).toBe(true);
    expect(first.output_config).toEqual({ effort: 'high' });

    const msgs = requests[1]!.messages as { role: string; content: unknown }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const assistant = msgs[1]!.content as { type: string; signature?: string }[];
    expect(assistant[0]).toMatchObject({ type: 'thinking', signature: 'sig-1' }); // passed back unchanged
    const results = msgs[2]!.content as {
      type: string;
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }[];
    expect(results.map((x) => x.tool_use_id)).toEqual(['t1', 't2']);
    expect(results[0]).toMatchObject({ content: 'content of a.ts' });
    expect(results[0]!.is_error).toBeUndefined();
    expect(results[1]).toMatchObject({ is_error: true });
    expect(results[1]!.content).toContain('disk on fire');
  });

  it('never runs tools from a turn cut off at max_tokens', async () => {
    script = [
      {
        blocks: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.ts' } }],
        stop: 'max_tokens',
      },
    ];
    const { r, calls } = req();
    expect((await provider().runAgent(r)).stop).toBe('truncated');
    expect(calls).toEqual([]);
  });

  it('stops on refusal and on a plain text answer', async () => {
    script = [{ blocks: [], stop: 'refusal' }];
    expect((await provider().runAgent(req().r)).stop).toBe('refused');
    script = [{ blocks: [{ type: 'text', text: 'I need more info' }], stop: 'end_turn' }];
    const res = await provider().runAgent(req().r);
    expect(res).toMatchObject({ stop: 'end_turn', finalText: 'I need more info' });
  });

  it('enforces the turn limit and the token budget', async () => {
    const loop = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        blocks: [
          { type: 'tool_use' as const, id: `t${i}`, name: 'read_file', input: { path: 'a' } },
        ],
        stop: 'tool_use',
      }));
    script = loop(10);
    const a = req({ maxTurns: 3 });
    expect((await provider().runAgent(a.r)).stop).toBe('max_turns');
    expect(a.calls).toHaveLength(3);

    script = loop(10).map((t) => ({ ...t, usage: { input: 600, output: 100 } }));
    const b = req({ tokenBudget: 1000 });
    expect((await provider().runAgent(b.r)).stop).toBe('budget');
    expect(b.calls).toHaveLength(2);
  });
});
