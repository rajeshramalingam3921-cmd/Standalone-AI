import Anthropic from '@anthropic-ai/sdk';
import {
  AiAbortedError,
  AiProviderError,
  type AiProvider,
  type ProviderChatRequest,
} from './types.js';

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  timeoutMs: number;
  /** For tests: inject a client (e.g. pointed at a fake server). */
  client?: Anthropic;
}

/** Map SDK errors to provider-neutral codes. Most specific classes first. */
export function mapAnthropicError(err: unknown): Error {
  if (err instanceof AiProviderError || err instanceof AiAbortedError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AiAbortedError();
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('timeout');
  if (err instanceof Anthropic.APIConnectionError) return new AiProviderError('network');
  if (err instanceof Anthropic.AuthenticationError) return new AiProviderError('auth');
  if (err instanceof Anthropic.PermissionDeniedError) return new AiProviderError('permission');
  if (err instanceof Anthropic.NotFoundError) return new AiProviderError('model_unavailable');
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get('retry-after'));
    return new AiProviderError(
      'rate_limited',
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }
  if (err instanceof Anthropic.BadRequestError) return new AiProviderError('bad_request');
  if (err instanceof Anthropic.InternalServerError) return new AiProviderError('overloaded');
  if (err instanceof Anthropic.APIError) {
    // Errors delivered inside an open stream have no HTTP status; classify by error type.
    const type = (err as { type?: string | null }).type;
    if (err.status === 529 || type === 'overloaded_error' || type === 'api_error') {
      return new AiProviderError('overloaded');
    }
    if (type === 'rate_limit_error') return new AiProviderError('rate_limited');
    if (type === 'authentication_error') return new AiProviderError('auth');
    if (type === 'invalid_request_error') return new AiProviderError('bad_request');
    return new AiProviderError('unknown');
  }
  return new AiProviderError('unknown');
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): AiProvider {
  const configured = Boolean(opts.apiKey) || Boolean(opts.client);
  // The key stays server-side; it is never sent to the browser or logged.
  const client =
    opts.client ??
    (configured
      ? new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 2 })
      : undefined);

  return {
    id: 'anthropic',
    configured,

    async streamChat(req: ProviderChatRequest) {
      if (!client) throw new AiProviderError('not_configured');
      try {
        const stream = client.beta.messages.stream(
          {
            model: req.model,
            max_tokens: opts.maxTokens,
            system: req.system,
            messages: req.messages,
            output_config: { effort: opts.effort },
            // Cache the stable prefix (system + earlier turns) across a conversation.
            cache_control: { type: 'ephemeral' },
            // If the model declines for policy reasons, let the API retry on its
            // server-defined fallback model inside the same call.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: req.signal },
        );

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            req.onText(event.delta.text);
          }
        }
        const final = await stream.finalMessage();
        const u = final.usage;
        return {
          stop:
            final.stop_reason === 'refusal'
              ? 'refused'
              : final.stop_reason === 'max_tokens'
                ? 'truncated'
                : 'complete',
          usage: {
            inputTokens:
              u.input_tokens +
              (u.cache_creation_input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0),
            outputTokens: u.output_tokens,
          },
          servedModel: final.model,
        };
      } catch (err) {
        if (req.signal.aborted) throw new AiAbortedError();
        throw mapAnthropicError(err);
      }
    },
  };
}
