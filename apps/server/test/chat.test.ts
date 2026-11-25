import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatStreamEvent, Conversation, Project } from '@thiran/shared';
import { buildHistory, buildSystemPrompt, titleFrom } from '../src/ai/context.js';
import { createMockProvider } from '../src/ai/mock.js';
import { AiProviderError, type AiProvider, type ProviderChatRequest } from '../src/ai/types.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

/** Records what the route sent to the provider and replies with fixed text. */
function spyProvider(reply = 'பதில்', opts: { configured?: boolean } = {}) {
  const calls: ProviderChatRequest[] = [];
  const p: AiProvider = {
    id: 'anthropic',
    configured: opts.configured ?? true,
    async streamChat(req) {
      calls.push(req);
      for (const part of [reply.slice(0, 2), reply.slice(2)]) req.onText(part);
      return {
        stop: 'complete',
        usage: { inputTokens: 3, outputTokens: 4 },
        servedModel: req.model,
      };
    },
  };
  return { p, calls };
}

async function setup(provider: AiProvider = createMockProvider({ delayMs: 0 }), env = {}) {
  t = await makeTestApp({ provider, env });
  const project = (
    await t.post('/api/projects', { name: 'ERP', techStack: ['React'] }, t.cookie)
  ).json<Project>();
  const conv = (
    await t.post(`/api/projects/${project.id}/conversations`, {}, t.cookie)
  ).json<Conversation>();
  return { project, conv, base: `/api/projects/${project.id}/conversations/${conv.id}` };
}

function parseSse(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)) as ChatStreamEvent);
}

describe('AI status', () => {
  it('reports provider, models and default without exposing any key', async () => {
    t = await makeTestApp({ env: { ANTHROPIC_API_KEY: 'sk-ant-secret-value' } });
    const res = await t.get('/api/ai/status', t.cookie);
    expect(res.json()).toMatchObject({
      provider: 'anthropic',
      configured: true,
      defaultModel: 'claude-opus-5-5',
    });
    expect(res.json().models.map((m: { id: string }) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
    expect(res.body).not.toContain('sk-ant-secret-value');
  });

  it('requires sign-in', async () => {
    t = await makeTestApp();
    expect((await t.get('/api/ai/status')).statusCode).toBe(401);
  });
});

describe('conversations', () => {
  it('creates conversations with the default model and rejects unknown models', async () => {
    const { project, conv } = await setup();
    expect(conv.model).toBe('claude-opus-5-5');
    const bad = await t.post(
      `/api/projects/${project.id}/conversations`,
      { model: 'gpt-x' },
      t.cookie,
    );
    expect(bad.statusCode).toBe(400);
    const list = (await t.get(`/api/projects/${project.id}/conversations`, t.cookie)).json();
    expect(list).toHaveLength(1);
  });

  it('cannot reach a conversation through another project', async () => {
    const { base, conv } = await setup();
    const other = (await t.post('/api/projects', { name: 'Other' }, t.cookie)).json<Project>();
    const url = `/api/projects/${other.id}/conversations/${conv.id}/messages`;
    expect((await t.get(url, t.cookie)).statusCode).toBe(404);
    expect((await t.post(url, { content: 'hi' }, t.cookie)).statusCode).toBe(404);
    expect((await t.get(`${base}/messages`, t.cookie)).statusCode).toBe(200);
  });
});

describe('sending messages (SSE stream)', () => {
  it('streams start → deltas → done and persists both messages', async () => {
    const spy = spyProvider('வணக்கம்!');
    const { base, project } = await setup(spy.p);
    const res = await t.post(`${base}/messages`, { content: 'Login page எப்படி?' }, t.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-store');

    const events = parseSse(res.body);
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'delta', 'done']);
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: 'done' }>;
    expect(done.message).toMatchObject({
      role: 'assistant',
      content: 'வணக்கம்!',
      status: 'complete',
    });

    const stored = (await t.get(`${base}/messages`, t.cookie)).json<ChatMessage[]>();
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Login page எப்படி?'],
      ['assistant', 'வணக்கம்!'],
    ]);
    // First message becomes the conversation title.
    const convs = (await t.get(`/api/projects/${project.id}/conversations`, t.cookie)).json<
      Conversation[]
    >();
    expect(convs[0]!.title).toBe('Login page எப்படி?');
  });

  it('sends project context and prior turns to the provider', async () => {
    const spy = spyProvider('ok');
    const { base } = await setup(spy.p);
    await t.post(`${base}/messages`, { content: 'first' }, t.cookie);
    await t.post(`${base}/messages`, { content: 'second', model: 'claude-haiku-5-5' }, t.cookie);
    const last = spy.calls.at(-1)!;
    expect(last.model).toBe('claude-haiku-5-5');
    expect(last.system).toContain('Project name: ERP');
    expect(last.system).toContain('cannot read or change the project files');
    expect(last.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ]);
  });

  it('records provider errors with a safe code and sends an error event', async () => {
    const failing: AiProvider = {
      id: 'anthropic',
      configured: true,
      async streamChat(req) {
        req.onText('partial ');
        throw new AiProviderError('rate_limited', 30);
      },
    };
    const { base } = await setup(failing);
    const events = parseSse((await t.post(`${base}/messages`, { content: 'x' }, t.cookie)).body);
    const last = events.at(-1) as Extract<ChatStreamEvent, { type: 'error' }>;
    expect(last.type).toBe('error');
    expect(last.code).toBe('rate_limited');
    expect(last.message).toMatchObject({
      status: 'error',
      error: 'rate_limited',
      content: 'partial ',
    });
  });

  it('records refusals', async () => {
    const { base } = await setup();
    const events = parseSse(
      (await t.post(`${base}/messages`, { content: '/mock refuse' }, t.cookie)).body,
    );
    expect((events.at(-1) as Extract<ChatStreamEvent, { type: 'done' }>).message.status).toBe(
      'refused',
    );
  });

  it('leaves failed replies out of later context', async () => {
    const spy = spyProvider('ok');
    let fail = true;
    const p: AiProvider = {
      ...spy.p,
      async streamChat(req) {
        if (fail) {
          fail = false;
          throw new AiProviderError('overloaded');
        }
        return spy.p.streamChat(req);
      },
    };
    const { base } = await setup(p);
    await t.post(`${base}/messages`, { content: 'one' }, t.cookie);
    await t.post(`${base}/messages`, { content: 'two' }, t.cookie);
    expect(spy.calls[0]!.messages).toEqual([
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
    ]);
  });

  it('returns 503 when no provider key is configured (no stream, no stored message)', async () => {
    const { base } = await setup(spyProvider('x', { configured: false }).p);
    const res = await t.post(`${base}/messages`, { content: 'hi' }, t.cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_not_configured');
    expect((await t.get(`${base}/messages`, t.cookie)).json()).toEqual([]);
  });

  it('rejects a second message while a reply is in progress (409)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: AiProvider = {
      id: 'anthropic',
      configured: true,
      async streamChat() {
        await gate;
        return { stop: 'complete', usage: { inputTokens: 0, outputTokens: 0 }, servedModel: 'm' };
      },
    };
    const { base } = await setup(slow);
    const first = t.post(`${base}/messages`, { content: 'one' }, t.cookie);
    await new Promise((r) => setTimeout(r, 50));
    const second = await t.post(`${base}/messages`, { content: 'two' }, t.cookie);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('busy');
    release();
    expect((await first).statusCode).toBe(200);
    // Lock is released afterwards.
    expect((await t.post(`${base}/messages`, { content: 'three' }, t.cookie)).statusCode).toBe(200);
  });

  it('validates content and model', async () => {
    const { base } = await setup();
    expect((await t.post(`${base}/messages`, { content: '  ' }, t.cookie)).statusCode).toBe(400);
    expect(
      (await t.post(`${base}/messages`, { content: 'x'.repeat(20_001) }, t.cookie)).statusCode,
    ).toBe(400);
    expect(
      (await t.post(`${base}/messages`, { content: 'x', model: 'gpt-x' }, t.cookie)).statusCode,
    ).toBe(400);
  });

  it('rate-limits chat messages per client', async () => {
    const { base } = await setup(createMockProvider({ delayMs: 0 }), {
      AI_RATE_LIMIT_PER_MINUTE: '2',
    });
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push((await t.post(`${base}/messages`, { content: `m${i}` }, t.cookie)).statusCode);
    expect(codes).toEqual([200, 200, 429]);
  });

  it('requires sign-in', async () => {
    const { base } = await setup();
    expect((await t.post(`${base}/messages`, { content: 'hi' })).statusCode).toBe(401);
  });
});

describe('context helpers', () => {
  const msg = (
    role: 'user' | 'assistant',
    content: string,
    status: ChatMessage['status'] = 'complete',
  ): ChatMessage => ({
    id: 'x',
    conversationId: 'c',
    role,
    content,
    status,
    model: null,
    error: null,
    usage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('keeps only usable turns, limits length and starts with a user turn', () => {
    const h = buildHistory(
      [
        msg('user', 'a'),
        msg('assistant', 'b'),
        msg('user', 'c'),
        msg('assistant', '', 'error'),
        msg('assistant', 'nope', 'refused'),
        msg('user', 'd'),
      ],
      3,
    );
    expect(h).toEqual([
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]);
  });

  it('builds a system prompt with project facts and honest capability limits', () => {
    const s = buildSystemPrompt({
      id: '1',
      name: 'POS',
      description: 'billing',
      techStack: ['React'],
      workspacePath: '',
      commands: {},
      createdAt: '',
      updatedAt: '',
    });
    expect(s).toContain('Project name: POS');
    expect(s).toContain('Technology stack: React');
    expect(s).not.toContain('Workspace path');
    expect(s).toContain('Never claim you ran, tested or verified something.');
  });

  it('makes short single-line titles', () => {
    expect(titleFrom('  a\nb  ')).toBe('a b');
    expect(titleFrom('x'.repeat(100))).toHaveLength(58);
  });
});
