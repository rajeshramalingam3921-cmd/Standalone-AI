import type { AiErrorCode, ChatUsage } from '@thiran/shared';

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderChatRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  signal: AbortSignal;
  onText: (text: string) => void;
}

export interface ProviderChatResult {
  stop: 'complete' | 'truncated' | 'refused';
  usage: ChatUsage;
  /** Model that actually produced the answer (may differ after a safety fallback). */
  servedModel: string;
}

/**
 * Provider-independent chat interface. Adding a provider means implementing this
 * and mapping its errors to AiProviderError codes — routes never see SDK types.
 */
export interface AiProvider {
  readonly id: 'anthropic' | 'mock';
  readonly configured: boolean;
  streamChat(req: ProviderChatRequest): Promise<ProviderChatResult>;
}

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(`AI provider error: ${code}`);
    this.name = 'AiProviderError';
  }
}

/** Thrown when the caller aborted (user pressed stop or disconnected). */
export class AiAbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AiAbortedError';
  }
}
