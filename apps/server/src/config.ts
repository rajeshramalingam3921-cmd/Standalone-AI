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
