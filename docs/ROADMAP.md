# Roadmap

Each phase must pass `pnpm check` and its acceptance criteria before the next starts.

| Phase | Scope                                                               | Acceptance criteria                                                                                     | Status  |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1     | Inspect environment, write plan                                     | This document + ARCHITECTURE + SECURITY                                                                 | ✅ Done |
| 2     | Monorepo, config, lint/test/build, CI, health endpoint, mobile UI   | `pnpm check` green; UI shows live server status on iPhone viewport                                      | ✅ Done |
| 3     | Workspace UI: project dashboard, project create/select, task list   | Usable at 375px width; status badges for waiting/running/failed/completed; state survives refresh       | ✅ Done |
| 4     | PostgreSQL + ORM, projects/tasks/events API, owner auth, rate limit | Integration tests against a real test DB; unauthenticated requests rejected; per-project data isolation | ✅ Done |
| 5     | AI provider layer (Claude first) + chat UI                          | Mocked-provider tests for errors/rate limits/timeouts; keys never reach the browser or logs             | ✅ Done |
| 6     | Agent engine: sandboxed file ops, diffs, approvals, command runner  | Path-escape tests; destructive actions blocked without approval; diff shown before apply                | ✅ Done |
| 7     | Logging, audit, backups/rollback, dependency/security checks        | Audit trail for every change; rollback verified on a sample project                                     | ✅ Done |
| 8     | End-to-end workflow test, setup/usage/deploy docs                   | Plan→approve→execute→verify→report on a sample project, verified end to end                             | Next    |
| Later | Templates (business site, dashboard, POS, ERP, accounting, …)       | Each template builds and passes its own tests; no unverified compliance claims                          |         |

## Phase 1 findings (2026-11-24)

- Repository was empty (no commits, no files) — nothing to reuse or overwrite.
- Cloud environment: Node 22.23, pnpm 10.28, Git 2.43, PostgreSQL 16 (installed, not running),
  Docker, Rust, Playwright/Chromium.
- No Windows laptop connected; Windows-specific setup is unverified.
- No AI provider API keys configured (needed from Phase 5).

## Phase 3 notes (2026-11-25)

- Persistence is a JSON file (`DATA_DIR/thiran.json`, default `.thiran-data/`) behind a
  `Store` interface; Phase 4 replaces it with PostgreSQL without changing the API.
  Writes are serialized and atomic (temp file + rename, mode 600). A corrupt file stops the
  server instead of being overwritten.
- Tasks are created as `draft`. Users can only **approve**, **request changes** or **cancel**;
  no one can mark a task completed by hand — that will come only from verification (Phase 6).
- Verified in Chromium at iPhone 13 size: create project → add tasks → cancel (two-tap
  confirm) → filter → reload keeps screen, drafts and state → dashboard counts → server
  restart keeps data. Not yet verified on a physical iPhone.

## Phase 4 notes (2026-11-25)

- PostgreSQL via Drizzle ORM (ADR 0002); JSON file remains for zero-setup use. Both pass the
  same store contract tests (9 contract + 2 import tests run against real PostgreSQL 16).
- Owner sign-in with server-side sessions; login and API rate limits.
- Verified end to end on PostgreSQL 16: refusal with pending migrations → `db:migrate` →
  `db:import-json` of Phase 3 data → `set-password` in a real terminal (input not echoed) →
  browser sign-in at iPhone 13 size → create task → reload → logout → API returns 401;
  6th login attempt in 15 minutes returns 429; passwords never appear in logs.
- Not yet verified: physical iPhone, Windows host, CI run on GitHub.

## Phase 5 notes (2026-11-25)

- Provider interface (`apps/server/src/ai/types.ts`) with an Anthropic implementation (official
  SDK, streaming, effort setting, prompt caching, server-side safety fallback) and an offline
  mock. Adding another provider = one file implementing `AiProvider`.
- Per-project conversations in PostgreSQL/JSON (migration `0001_chat`, additive only).
- SSE streaming with stop, one-reply-at-a-time lock, per-client rate limit, safe error codes.
- Verified: provider tests against a local fake Messages API (streaming, request shape, every
  error class, timeout, abort, refusal, fallback model); chat API and UI tests; browser run at
  iPhone 13 size with the mock provider (send, stream, stop, error + retry, reload restores
  messages and draft). Migration applied to the dev database after a `pg_dump` backup.
- **Not verified: a real Claude API call** — no API key was available in this environment.

## Phase 6a notes (2026-11-25)

- Sandbox (`apps/server/src/agent/workspace.ts`), change sets with diff/apply/revert
  (`changes.ts`), command runner (`runner.ts`); migration `0002_workspace` (additive).
- Verified: 29 adversarial sandbox tests (traversal, symlink escape, secrets, devices,
  binary/non-UTF-8, atomic writes), runner tests (no shell, no secret env, process-tree kill on
  timeout, output cap), API tests (conflicts, isolation, busy lock), store contract on
  PostgreSQL. Browser run at iPhone 13 size on a sample project: folder outside the roots
  refused → test fails on a real bug → fix in editor → diff → two-tap apply → test passes →
  rollback → manual edit made meanwhile is not overwritten.
- Not verified: Windows (paths, `cmd.exe` wrapper, `taskkill`), a physical iPhone.

## Phase 6b notes (2026-11-25)

- Agent engine (`apps/server/src/agent/engine.ts`) on the task state machine; tools in
  `tools.ts`; Tamil report built from recorded facts (`report.ts`); migration `0003_agent`.
- Messages API tool loop in the provider (`runAgent`): no forced tool choice, full assistant
  content passed back, all tool results in one message, no tool runs from a `max_tokens`-cut
  turn, `is_error` results, turn/token limits.
- Verified: agent loop against a local fake Messages API (parallel tools, thinking echo,
  truncation, refusal, limits); 12 workflow tests (happy path, failing checks, no checks,
  limits, feedback, reject, cancel, double tap, restart recovery) and an adversarial scripted
  agent (secrets, traversal, `.git`, unknown tools, unconfigured checks); browser run at iPhone
  13 size with the mock agent: plan → approve → diff → apply → test fails → honest "needs
  attention" report → re-plan → request changes.
- Bugs found and fixed by these tests: failed-check output was dropped before re-planning;
  restart recovery could hang on an already-aborted run; `/task/` URLs fell back to the
  dashboard.
- **Not verified: a real Claude agent run** (no API key here), Windows, physical iPhone.

## Phase 7 notes (2026-11-25)

- Audit log (`audit_events`, migration `0004_audit` with an append-only trigger) wired into
  auth, projects, tasks, changes, commands, the agent and the CLI. Audit and System pages.
- `pnpm backup` (pg_dump custom format or validated JSON copy, 0600), `pnpm restore` (JSON mode,
  refuses while the server runs, keeps a pre-restore copy), `docs/OPERATIONS.md`.
- Secret scan (`scripts/check-secrets.mjs`) in `pnpm check`; `pnpm audit:deps` in CI; patched a
  moderate dev-only advisory (esbuild inside drizzle-kit) with a pnpm override.
- Verified for real: backup before migration → migrate → backup → restore into a fresh database
  (identical row counts, server starts on it) → `DELETE FROM audit_events` refused.
- Bugs found by that run and fixed: a backup taken before a schema migration exited with an
  error (audit table not there yet); `.dump` files were world-readable.
