import { AiAbortedError, AiProviderError, type AgentRunRequest, type AiProvider } from './types.js';

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

    /**
     * Scripted agent: finds the first text file, then either submits a plan for it
     * (plan mode) or proposes adding one review comment line (execute mode).
     * It never fixes anything — it only exercises the workflow.
     */
    async runAgent(req: AgentRunRequest) {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const call = async (name: string, input: unknown) => {
        await sleep(delay, req.signal);
        return req.execute(name, input);
      };
      let file: string | undefined;
      const queue = [''];
      while (!file && queue.length) {
        const dir = queue.shift()!;
        const listing = (await call('list_files', { path: dir })).content;
        for (const line of listing.split('\n')) {
          const m = /^(dir |file) (\S+)/.exec(line);
          if (m?.[1] === 'file' && /\.(js|ts|tsx|jsx|py|md|txt)$/.test(m[2]!)) {
            file = m[2];
            break;
          }
          if (m?.[1] === 'dir ') queue.push(m[2]!);
        }
      }
      if (!file)
        return {
          stop: 'end_turn' as const,
          usage,
          finalText: 'No file found.',
          servedModel: req.model,
        };
      const content = (await call('read_file', { path: file })).content;
      const isPlan = req.tools.some((t) => t.name === 'submit_plan');
      if (isPlan) {
        await call('submit_plan', {
          summary: `[Mock — உண்மையான AI அல்ல] ${file} file-இல் ஒரு குறிப்பு வரி சேர்க்கப்படும்.`,
          steps: [`${file} படிக்கப்பட்டது`, 'கடைசியில் ஒரு கருத்து வரி சேர்க்கப்படும்'],
          files: [file],
          checks: ['test'],
        });
      } else {
        await call('write_file', {
          path: file,
          content: `${content.replace(/\n?$/, '\n')}// Thiran mock agent: reviewed\n`,
        });
        await call('finish', {
          summary_ta: `[Mock] ${file}-இல் ஒரு கருத்து வரி சேர்க்கப்பட்டது. Bug எதுவும் சரிசெய்யப்படவில்லை.`,
        });
      }
      return { stop: 'tool_stop' as const, usage, finalText: '', servedModel: req.model };
    },
  };
}
