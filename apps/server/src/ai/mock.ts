import { AiAbortedError, AiProviderError, type AiProvider } from './types.js';

/**
 * Deterministic stand-in for development and tests (AI_PROVIDER=mock).
 * It does NOT call any AI; the UI labels it clearly. Special inputs:
 *   "/mock error <code>"  → throws that AiProviderError code
 *   "/mock refuse"        → refused stop
 *   "/mock long"          → slow stream (to test stop / disconnect)
 */
export function createMockProvider(opts: { delayMs?: number } = {}): AiProvider {
  const delay = opts.delayMs ?? 15;
  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new AiAbortedError());
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new AiAbortedError());
        },
        { once: true },
      );
    });

  return {
    id: 'mock',
    configured: true,
    async streamChat(req) {
      const last = req.messages.at(-1)?.content ?? '';
      const cmd = /^\/mock (\w+)(?: (\w+))?/.exec(last);
      if (cmd?.[1] === 'error') {
        await sleep(delay, req.signal);
        throw new AiProviderError((cmd[2] as never) ?? 'unknown');
      }
      if (cmd?.[1] === 'refuse')
        return {
          stop: 'refused',
          usage: { inputTokens: 1, outputTokens: 0 },
          servedModel: req.model,
        };

      const reply =
        cmd?.[1] === 'long'
          ? Array.from({ length: 200 }, (_, i) => `வரி ${i + 1}. `).join('')
          : `[Mock பதில் — உண்மையான AI அல்ல] நீங்கள் எழுதியது: "${last}" (${req.messages.length} செய்திகள், model ${req.model})`;
      const chunks = reply.match(/.{1,12}/gsu) ?? [];
      for (const c of chunks) {
        await sleep(cmd?.[1] === 'long' ? 50 : delay, req.signal);
        req.onText(c);
      }
      return {
        stop: 'complete',
        usage: {
          inputTokens: req.messages.reduce((n, m) => n + m.content.length, 0),
          outputTokens: reply.length,
        },
        servedModel: req.model,
      };
    },
  };
}
