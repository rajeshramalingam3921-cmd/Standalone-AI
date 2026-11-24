import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@thiran/shared';
import type { AppConfig } from './config.js';
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
];

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    },
    bodyLimit: 1024 * 1024,
  });

  // Conservative security headers for an API that serves JSON only.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
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
      error: 'request_error',
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

  return app;
}
