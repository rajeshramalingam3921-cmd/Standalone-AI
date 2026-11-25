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

export interface AgentToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. Inputs are still validated by the executor. */
  inputSchema: Record<string, unknown>;
}

export interface AgentToolResult {
  content: string;
  isError?: boolean;
  /** End the loop after this tool (e.g. submit_plan / finish). */
  stop?: boolean;
}

export interface AgentRunRequest {
  model: string;
  system: string;
  prompt: string;
  tools: AgentToolSpec[];
  /** Max model turns (each turn may call several tools). */
  maxTurns: number;
  /** Stop when input+output tokens exceed this. */
  tokenBudget: number;
  signal: AbortSignal;
  execute: (name: string, input: unknown) => Promise<AgentToolResult>;
}

export interface AgentRunResult {
  stop: 'tool_stop' | 'end_turn' | 'max_turns' | 'budget' | 'refused' | 'truncated';
  usage: ChatUsage;
  finalText: string;
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
  /** Run a tool-using loop. Tools execute locally through `execute`. */
  runAgent(req: AgentRunRequest): Promise<AgentRunResult>;
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
