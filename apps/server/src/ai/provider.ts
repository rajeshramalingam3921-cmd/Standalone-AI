import type { AiModelInfo } from '@thiran/shared';
import type { AppConfig } from '../config.js';
import { createAnthropicProvider } from './anthropic.js';
import { createMockProvider } from './mock.js';
import type { AiProvider } from './types.js';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-fable-5-2': 'Claude Fable 5.2',
};

export function modelInfo(config: AppConfig): AiModelInfo[] {
  return config.AI_MODELS.map((id) => ({ id, label: MODEL_LABELS[id] ?? id }));
}

export function createProvider(config: AppConfig): AiProvider {
  if (config.AI_PROVIDER === 'mock') return createMockProvider();
  return createAnthropicProvider({
    apiKey: config.ANTHROPIC_API_KEY,
    maxTokens: config.AI_MAX_TOKENS,
    effort: config.AI_EFFORT,
    timeoutMs: config.AI_TIMEOUT_MS,
  });
}
