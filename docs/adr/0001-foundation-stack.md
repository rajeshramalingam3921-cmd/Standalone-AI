# ADR 0001 — Foundation stack

**Status:** Accepted (Phase 2)

## Context

Empty repository; owner works mainly from an iPhone; target is a secure, maintainable
platform that can later run on a Windows laptop.

## Decision

pnpm monorepo with TypeScript everywhere: Fastify + Zod API, React + Vite web UI, shared
contracts package, Vitest, ESLint (typescript-eslint), Prettier. TypeScript pinned to 6.0.x
(7.x not yet supported by typescript-eslint at time of writing). No database, auth or AI SDK
added until the phase that needs them.

## Consequences

- One language and one test runner across the codebase.
- Web UI works on iPhone directly; a native/desktop shell can be added later if needed.
- `packages/shared` must be built before dependants typecheck/test (`pnpm test` does this).
