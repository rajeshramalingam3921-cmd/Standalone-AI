// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage, ChatStreamEvent } from '@thiran/shared';
import { streamChat } from '../src/api';
import { ChatPanel, messageNote } from '../src/components/Chat';
import { splitFences } from '../src/components/MessageContent';
import { href, parseRoute } from '../src/router';

const P = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An SSE response whose bytes arrive in awkward chunk boundaries. */
function sseResponse(events: ChatStreamEvent[], chunkSize = 7) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(ctrl) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          ctrl.enqueue(bytes.slice(i, i + chunkSize));
        ctrl.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm',
  conversationId: C,
  role: 'assistant',
  content: '',
  status: 'complete',
  model: 'claude-opus-5-5',
  error: null,
  usage: null,
  createdAt: '2026-11-25T00:00:00.000Z',
  ...over,
});

describe('router chat routes', () => {
  it('parses and builds chat routes', () => {
    expect(parseRoute(`#/projects/${P}/chat`)).toEqual({
      name: 'project',
      projectId: P,
      tab: 'chat',
    });
    expect(parseRoute(`#/projects/${P}/chat/${C}`)).toEqual({
      name: 'project',
      projectId: P,
      tab: 'chat',
      conversationId: C,
    });
    expect(href({ name: 'project', projectId: P, tab: 'chat', conversationId: C })).toBe(
      `#/projects/${P}/chat/${C}`,
    );
    expect(parseRoute(`#/projects/${P}/chat/../x`)).toEqual({ name: 'dashboard' });
  });
});

describe('splitFences', () => {
  it('separates code blocks from text', () => {
    expect(splitFences('Hi\n```ts\nconst a = 1;\n```\nBye')).toEqual([
      { kind: 'text', text: 'Hi\n' },
      { kind: 'code', lang: 'ts', code: 'const a = 1;' },
      { kind: 'text', text: '\nBye' },
    ]);
  });
  it('handles an unterminated fence while streaming', () => {
    expect(splitFences('```js\nlet x')).toEqual([{ kind: 'code', lang: 'js', code: 'let x' }]);
  });
});

describe('streamChat', () => {
  it('parses events split across arbitrary chunk boundaries (incl. Tamil multi-byte text)', async () => {
    const events: ChatStreamEvent[] = [
      {
        type: 'start',
        userMessage: msg({ role: 'user', id: 'u' }),
        assistantMessageId: 'a',
        model: 'm',
      },
      { type: 'delta', text: 'வணக்கம் ' },
      { type: 'delta', text: 'உலகம்' },
      { type: 'done', message: msg({ id: 'a', content: 'வணக்கம் உலகம்' }) },
    ];
    const seen: ChatStreamEvent[] = [];
    const r = await streamChat(
      P,
      C,
      { content: 'x' },
      (e) => seen.push(e),
      new AbortController().signal,
      (async () => sseResponse(events, 5)) as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: true, data: { stopped: false } });
    expect(seen).toEqual(events);
  });

  it('maps JSON errors returned before streaming starts', async () => {
    const r = await streamChat(
      P,
      C,
      { content: 'x' },
      () => {},
      new AbortController().signal,
      (async () => json({ error: 'busy', message: 'x' }, 409)) as unknown as typeof fetch,
    );
    expect(r).toMatchObject({ ok: false, status: 409, code: 'busy' });
  });

  it('reports a user abort as stopped, not as an error', async () => {
    const ac = new AbortController();
    const hanging = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) =>
        init.signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))),
      )) as unknown as typeof fetch;
    const p = streamChat(P, C, { content: 'x' }, () => {}, ac.signal, hanging);
    ac.abort();
    expect(await p).toEqual({ ok: true, data: { stopped: true } });
  });
});

describe('messageNote', () => {
  it('explains non-complete statuses in Tamil', () => {
    expect(messageNote(msg({ status: 'complete' }))).toBeUndefined();
    expect(messageNote(msg({ status: 'error', error: 'rate_limited' }))).toContain('வரம்பை');
    expect(messageNote(msg({ status: 'refused' }))).toContain('பாதுகாப்பு');
  });
});

describe('ChatPanel', () => {
  const STATUS = {
    provider: 'anthropic',
    configured: true,
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    defaultModel: 'claude-opus-5-5',
  };
  const CONV = {
    id: C,
    projectId: P,
    title: 'Login',
    model: 'claude-opus-5-5',
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
  };

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows setup guidance and disables input when no key is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/ai/status' ? json({ ...STATUS, configured: false }) : json([]),
      ),
    );
    render(<ChatPanel projectId={P} />);
    expect(await screen.findByText('AI இன்னும் அமைக்கப்படவில்லை')).toBeTruthy();
    expect((screen.getByText('+ புதிய உரையாடல்') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends a message with the selected model and renders the streamed reply', async () => {
    let sentBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/ai/status') return json(STATUS);
        if (url.endsWith('/conversations')) return json([CONV]);
        if (url.endsWith('/messages') && init?.method === 'POST') {
          sentBody = JSON.parse(String(init.body));
          return sseResponse([
            {
              type: 'start',
              userMessage: msg({ id: 'u', role: 'user', content: 'Login page?' }),
              assistantMessageId: 'a',
              model: 'claude-haiku-5-5',
            },
            { type: 'delta', text: 'இதோ:\n```ts\nlogin()\n```' },
            {
              type: 'done',
              message: msg({
                id: 'a',
                content: 'இதோ:\n```ts\nlogin()\n```',
                model: 'claude-haiku-5-5',
                usage: { inputTokens: 5, outputTokens: 6 },
              }),
            },
          ]);
        }
        if (url.endsWith('/messages')) return json([]);
        return json({ error: 'not_found' }, 404);
      }),
    );
    render(<ChatPanel projectId={P} conversationId={C} />);
    await screen.findByText(/உங்கள் project பற்றி/);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'claude-haiku-5-5');
    await userEvent.type(screen.getByLabelText('செய்தி'), 'Login page?');
    await userEvent.click(screen.getByText('அனுப்பு'));

    expect(await screen.findByText('login()')).toBeTruthy();
    expect(screen.getByText('Login page?')).toBeTruthy();
    expect(screen.getByText(/Claude Haiku 5.5 · 11 tokens/)).toBeTruthy();
    expect(sentBody).toEqual({ content: 'Login page?', model: 'claude-haiku-5-5' });
    // Draft cleared once the server accepted the message.
    await waitFor(() =>
      expect((screen.getByLabelText('செய்தி') as HTMLTextAreaElement).value).toBe(''),
    );
  });

  it('shows provider errors in Tamil and offers a retry', async () => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/ai/status') return json(STATUS);
        if (url.endsWith('/conversations')) return json([CONV]);
        if (url.endsWith('/messages') && init?.method === 'POST') {
          posts++;
          return sseResponse([
            {
              type: 'start',
              userMessage: msg({ id: `u${posts}`, role: 'user', content: 'hi' }),
              assistantMessageId: `a${posts}`,
              model: 'm',
            },
            {
              type: 'error',
              code: 'overloaded',
              message: msg({ id: `a${posts}`, status: 'error', error: 'overloaded' }),
            },
          ]);
        }
        return json([]);
      }),
    );
    render(<ChatPanel projectId={P} conversationId={C} />);
    await userEvent.type(await screen.findByLabelText('செய்தி'), 'hi');
    await userEvent.click(screen.getByText('அனுப்பு'));
    expect(await screen.findByText(/அதிக சுமையில்/)).toBeTruthy();
    await userEvent.click(screen.getByText('மீண்டும் முயற்சி செய்'));
    await waitFor(() => expect(posts).toBe(2));
  });
});
