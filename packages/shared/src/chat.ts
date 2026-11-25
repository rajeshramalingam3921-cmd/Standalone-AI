import { z } from 'zod';

export const CHAT_MESSAGE_MAX_CHARS = 20_000;

export const ConversationCreateSchema = z.object({
  title: z.string().trim().max(120).default(''),
  model: z.string().trim().min(1).max(100).optional(),
});
export type ConversationCreateInput = z.input<typeof ConversationCreateSchema>;

export const ChatSendSchema = z.object({
  content: z.string().trim().min(1, 'Message is required').max(CHAT_MESSAGE_MAX_CHARS),
  /** Optional per-message model override; must be one of the server's allowed models. */
  model: z.string().trim().min(1).max(100).optional(),
});
export type ChatSendInput = z.input<typeof ChatSendSchema>;

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * complete  – the model finished normally
 * truncated – hit the output token limit
 * refused   – the model (and any fallback) declined for safety reasons
 * stopped   – the user stopped generation or disconnected
 * error     – the provider failed; `error` holds a safe code
 */
export type ChatMessageStatus = 'complete' | 'truncated' | 'refused' | 'stopped' | 'error';

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  status: ChatMessageStatus;
  model: string | null;
  error: AiErrorCode | null;
  usage: ChatUsage | null;
  createdAt: string;
}

export const AI_ERROR_CODES = [
  'not_configured',
  'auth',
  'permission',
  'rate_limited',
  'overloaded',
  'timeout',
  'network',
  'bad_request',
  'model_unavailable',
  'unknown',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_ERROR_LABEL_TA: Readonly<Record<AiErrorCode, string>> = {
  not_configured: 'AI provider அமைக்கப்படவில்லை (API key இல்லை)',
  auth: 'API key தவறானது அல்லது காலாவதியானது',
  permission: 'இந்த API key-க்கு இந்தச் செயலுக்கு அனுமதி இல்லை',
  rate_limited: 'AI provider வரம்பை எட்டியது. சிறிது நேரம் கழித்து முயற்சிக்கவும்',
  overloaded: 'AI provider தற்போது அதிக சுமையில் உள்ளது. மீண்டும் முயற்சிக்கவும்',
  timeout: 'AI பதில் நேரம் கடந்தது',
  network: 'AI provider-ஐ அணுக முடியவில்லை',
  bad_request: 'AI provider கோரிக்கையை ஏற்கவில்லை',
  model_unavailable: 'இந்த model கிடைக்கவில்லை',
  unknown: 'AI பதிலில் எதிர்பாராத பிழை',
};

export interface AiModelInfo {
  id: string;
  label: string;
}

/** GET /api/ai/status */
export interface AiStatus {
  provider: 'anthropic' | 'mock';
  configured: boolean;
  models: AiModelInfo[];
  defaultModel: string;
}

/** Server-sent events emitted while an assistant reply streams. */
export type ChatStreamEvent =
  | { type: 'start'; userMessage: ChatMessage; assistantMessageId: string; model: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; code: AiErrorCode | 'busy'; message: ChatMessage | null };
