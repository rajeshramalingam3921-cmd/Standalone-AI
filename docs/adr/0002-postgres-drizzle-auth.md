# ADR 0002 — PostgreSQL with Drizzle, single-owner sessions

**Status:** Accepted (Phase 4)

## Context

Projects and tasks need durable relational storage; the app must be reachable from an
iPhone, so every data route needs authentication. This is a personal, single-user install.

## Decision

- **Drizzle ORM + node-postgres.** Pure TypeScript, no engine binaries or code-generation step
  at runtime; migrations are plain SQL files in `apps/server/drizzle/` that can be reviewed
  before applying. (Prisma was considered; its engine downloads and generate step add
  moving parts we do not need.)
- **Migrations are explicit.** `pnpm db:migrate` lists pending SQL and asks for confirmation.
  The server refuses to start while migrations are pending.
- **The JSON-file store stays** behind the same `Store` interface for zero-setup use; a shared
  contract test suite keeps both implementations equivalent.
- **Single owner, server-side sessions.** Password is set only from a terminal on the server
  (no web "first user wins" setup). scrypt hashing; random 256-bit session tokens stored as
  SHA-256; HttpOnly + SameSite=Strict cookie; logout and password changes revoke sessions.
- **Rate limits** with `@fastify/rate-limit` (in-memory; fine for one process).

## Consequences

- Multi-user accounts and roles are not supported yet; adding them means a `users` table and
  per-project membership, which the store interface can absorb.
- Rate-limit counters reset on restart.
