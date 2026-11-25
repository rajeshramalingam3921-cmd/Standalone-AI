import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ALLOW_NON_LOOPBACK: booleanString,
    /** Directory for persisted data (Phase 3: a JSON file; Phase 4: PostgreSQL). */
    DATA_DIR: z.string().min(1).default('.thiran-data'),
    /** PostgreSQL connection string. When unset, data is kept in a JSON file in DATA_DIR. */
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'Must be a postgres:// or postgresql:// URL')
      .optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Send the session cookie only over HTTPS. "auto" = true in production. */
    COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
    /** Failed + successful login attempts allowed per client per 15 minutes. */
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(5),
    /** General API request limit per client per minute. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(10_000).default(300),
    /** "anthropic" (real Claude API) or "mock" (offline stand-in for development/tests). */
    AI_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
    /** Server-side only. Never sent to the browser, never logged. */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    /** Comma-separated allow-list of selectable models. */
    AI_MODELS: z
      .string()
      .default('claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5')
      .transform((v) =>
        v
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
      ),
    AI_DEFAULT_MODEL: z.string().min(1).default('claude-opus-5-5'),
    AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    AI_MAX_TOKENS: z.coerce.number().int().min(256).max(128_000).default(32_000),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(600_000),
    /** Chat messages per client per minute. */
    AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
    /** How many recent messages of a conversation are sent as context. */
    AI_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(500).default(40),
    /**
     * Comma-separated absolute folders under which project folders may live.
     * Empty = no project may access the file system.
     */
    WORKSPACE_ROOTS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    /** Execution attempts (approve → execute) per task. */
    AGENT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
    /** Plans (incl. re-plans) per task. */
    AGENT_MAX_PLANS: z.coerce.number().int().min(1).max(50).default(10),
    /** Model turns per agent run. */
    AGENT_MAX_TURNS: z.coerce.number().int().min(1).max(200).default(30),
    /** Input+output tokens per agent run. */
    AGENT_TOKEN_BUDGET: z.coerce.number().int().min(1_000).max(20_000_000).default(1_500_000),
    AGENT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(7_200_000).default(1_200_000),
    /** Where `pnpm backup` writes backups. Keep it out of the repository and copy it off-machine. */
    BACKUP_DIR: z.string().min(1).default('.thiran-backups'),
    COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(600_000),
    COMMAND_OUTPUT_MAX: z.coerce.number().int().min(1_000).max(1_000_000).default(64_000),
    /** Host names this server answers to (comma-separated). Guards against DNS rebinding. */
    ALLOWED_HOSTS: z
      .string()
      .default('127.0.0.1,localhost,::1')
      .transform((v) =>
        v
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
  })
  .transform(({ COOKIE_SECURE, ...env }) => ({
    ...env,
    COOKIE_SECURE:
      COOKIE_SECURE === 'auto' ? env.NODE_ENV === 'production' : COOKIE_SECURE === 'true',
  }))
  .superRefine((env, ctx) => {
    if (!env.AI_MODELS.includes(env.AI_DEFAULT_MODEL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_DEFAULT_MODEL'],
        message: 'Must be one of AI_MODELS.',
      });
    }
    if (!LOOPBACK_HOSTS.has(env.HOST) && !env.ALLOW_NON_LOOPBACK) {
      ctx.addIssue({
        code: 'custom',
        path: ['HOST'],
        message:
          'Refusing to bind to a non-loopback address. Set ALLOW_NON_LOOPBACK=true only on a private network you control.',
      });
    }
  });

export type AppConfig = z.output<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parse and validate configuration. Error messages never echo values (they may be secrets). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration — ${details}`);
  }
  return result.data;
}
