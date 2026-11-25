import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginSchema, type ApiError, type SessionStatus } from '@thiran/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';
import { verifyPassword } from './password.js';

export const SESSION_COOKIE = 'thiran_session';

/** Only a SHA-256 of the session token is stored; a leaked database cannot be replayed. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Routes reachable without a session. Everything else under /api requires one. */
const PUBLIC_ROUTES = new Set([
  '/api/health',
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
]);

export interface AuthOptions {
  now?: () => Date;
}

export function registerAuth(
  app: FastifyInstance,
  store: Store,
  config: AppConfig,
  opts: AuthOptions = {},
): void {
  const now = opts.now ?? (() => new Date());
  const ttlMs = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.COOKIE_SECURE,
  } as const;

  async function currentSession(req: FastifyRequest) {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || token.length > 200) return undefined;
    const session = await store.getSession(hashToken(token));
    if (!session || new Date(session.expiresAt) <= now()) return undefined;
    return session;
  }

  const unauthenticated = (reply: FastifyReply) =>
    reply
      .status(401)
      .send({ error: 'unauthenticated', message: 'Please sign in.' } satisfies ApiError);

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || PUBLIC_ROUTES.has(path)) return;
    if (!(await currentSession(req))) return unauthenticated(reply);
  });

  app.get('/api/auth/session', async (req): Promise<SessionStatus> => {
    const setupRequired = !(await store.getOwnerPasswordHash());
    return { authenticated: !setupRequired && !!(await currentSession(req)), setupRequired };
  });

  app.post(
    '/api/auth/login',
    {
      config: {
        // Brute-force protection: limited attempts per client per 15 minutes.
        rateLimit: { max: config.LOGIN_RATE_LIMIT_MAX, timeWindow: '15 minutes' },
      },
    },
    async (req, reply) => {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'validation_error', message: 'Password is required.' } satisfies ApiError);
      }
      const stored = await store.getOwnerPasswordHash();
      if (!stored) {
        return reply.status(409).send({
          error: 'setup_required',
          message: 'No owner password is set. Run the set-password command on the server.',
        } satisfies ApiError);
      }
      if (!(await verifyPassword(parsed.data.password, stored))) {
        req.log.warn({ ip: req.ip }, 'Failed login attempt');
        return reply.status(401).send({
          error: 'invalid_credentials',
          message: 'Incorrect password.',
        } satisfies ApiError);
      }

      await store.deleteExpiredSessions(now());
      const token = randomBytes(32).toString('base64url');
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + ttlMs);
      await store.createSession({
        tokenHash: hashToken(token),
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      req.log.info({ ip: req.ip }, 'Owner signed in');
      return reply
        .setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt })
        .send({ authenticated: true, setupRequired: false } satisfies SessionStatus);
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token && token.length <= 200) await store.deleteSession(hashToken(token));
    return reply
      .clearCookie(SESSION_COOKIE, cookieOptions)
      .send({ authenticated: false, setupRequired: false } satisfies SessionStatus);
  });
}
