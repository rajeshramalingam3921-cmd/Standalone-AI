import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@thiran/shared';
import { AgentEngine } from './agent/engine.js';
import { AuditLog } from './audit.js';
import { ProjectLocks } from './agent/locks.js';
import { createProvider } from './ai/provider.js';
import type { AiProvider } from './ai/types.js';
import { registerAuth } from './auth/routes.js';
import type { AppConfig } from './config.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import type { Store } from './store/types.js';
import { VERSION } from './version.js';

/** Paths redacted from structured logs so credentials never reach log files. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.password',
  '*.token',
  '*.secret',
  'req.body.password',
  '*.ANTHROPIC_API_KEY',
];

/** Built web UI location (same relative path from src/ and dist/). */
export const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface AppOptions {
  now?: () => Date;
  /** Override the AI provider (tests). Defaults to the one selected by config. */
  provider?: AiProvider;
  /** Override the web UI folder (tests). */
  webDir?: string;
}

export async function buildApp(
  config: AppConfig,
  store: Store,
  opts: AppOptions = {},
): Promise<FastifyInstance> {
  const webDir =
    opts.webDir ??
    (config.SERVE_WEB === 'true' || (config.SERVE_WEB === 'auto' && config.NODE_ENV !== 'test')
      ? existsSync(`${WEB_DIST}/index.html`)
        ? WEB_DIST
        : null
      : null);
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    },
    bodyLimit: 1024 * 1024,
    // Only a proxy on this machine may set the client address.
    trustProxy: config.TRUST_PROXY ? ['127.0.0.1', '::1'] : false,
  });

  // DNS-rebinding protection: only answer requests addressed to an allowed host name.
  const allowedHosts = new Set(config.ALLOWED_HOSTS);
  app.addHook('onRequest', async (req, reply) => {
    const host = req.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!allowedHosts.has(host)) {
      return reply.status(421).send({ error: 'misdirected_request', message: 'Host not allowed.' });
    }
  });

  await app.register(cookie);
  // In-memory limits suit this single-instance personal server.
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
  });

  // CSRF hardening: state-changing requests must be JSON (forces a CORS preflight,
  // which this API never approves for foreign origins).
  app.addHook('preValidation', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return reply
        .status(415)
        .send({ error: 'unsupported_media_type', message: 'Use application/json.' });
    }
  });

  // Security headers. The API serves JSON only; the web UI gets a strict same-origin CSP.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    const path = req.url.split('?')[0]!;
    if (path.startsWith('/api/') || !webDir) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    } else {
      reply.header('Content-Security-Policy', WEB_CSP);
      // Hashed build assets never change; the HTML entry point must always be revalidated.
      reply.header(
        'Cache-Control',
        path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    }
    return payload;
  });

  // Safe error responses: never leak stack traces or internal messages to clients.
  app.setErrorHandler((error: unknown, request, reply) => {
    const e = (typeof error === 'object' && error !== null ? error : {}) as {
      statusCode?: unknown;
      message?: unknown;
    };
    const statusCode =
      typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 600
        ? e.statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply
        .status(statusCode)
        .send({ error: 'internal_error', message: 'Something went wrong.' });
    }
    return reply.status(statusCode).send({
      error:
        statusCode === 409 ? 'conflict' : statusCode === 429 ? 'rate_limited' : 'request_error',
      message: typeof e.message === 'string' ? e.message : 'Bad request.',
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'Route not found.' }),
  );

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'thiran-server',
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  const audit = new AuditLog(store, app.log, opts.now);
  app.decorate('audit', audit);
  if (webDir)
    await app.register(fastifyStatic, { root: webDir, index: ['index.html'], wildcard: false });
  registerAuth(app, store, config, opts.now ? { now: opts.now } : {});
  const provider = opts.provider ?? createProvider(config);
  const locks = new ProjectLocks();
  const agent = new AgentEngine({
    store,
    config,
    provider,
    locks,
    log: app.log,
    audit,
    ...(opts.now && { now: opts.now }),
  });
  app.decorate('agent', agent);

  registerProjectRoutes(app, store, agent);
  registerChatRoutes(app, store, config, provider, opts.now);
  registerWorkspaceRoutes(app, store, config, locks, agent, opts.now);
  registerSystemRoutes(app, store, config, provider, opts.now);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    agent: AgentEngine;
    audit: AuditLog;
  }
}
