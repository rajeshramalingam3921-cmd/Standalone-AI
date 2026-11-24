# Roadmap

Each phase must pass `pnpm check` and its acceptance criteria before the next starts.

| Phase | Scope                                                               | Acceptance criteria                                                                                     | Status  |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1     | Inspect environment, write plan                                     | This document + ARCHITECTURE + SECURITY                                                                 | ✅ Done |
| 2     | Monorepo, config, lint/test/build, CI, health endpoint, mobile UI   | `pnpm check` green; UI shows live server status on iPhone viewport                                      | ✅ Done |
| 3     | Workspace UI: project dashboard, project create/select, task list   | Usable at 375px width; status badges for waiting/running/failed/completed; state survives refresh       | Next    |
| 4     | PostgreSQL + ORM, projects/tasks/events API, owner auth, rate limit | Integration tests against a real test DB; unauthenticated requests rejected; per-project data isolation |         |
| 5     | AI provider layer (Claude first) + chat UI                          | Mocked-provider tests for errors/rate limits/timeouts; keys never reach the browser or logs             |         |
| 6     | Agent engine: sandboxed file ops, diffs, approvals, command runner  | Path-escape tests; destructive actions blocked without approval; diff shown before apply                |         |
| 7     | Logging, audit, backups/rollback, dependency/security checks        | Audit trail for every change; rollback verified on a sample project                                     |         |
| 8     | End-to-end workflow test, setup/usage/deploy docs                   | Plan→approve→execute→verify→report on a sample project, verified end to end                             |         |
| Later | Templates (business site, dashboard, POS, ERP, accounting, …)       | Each template builds and passes its own tests; no unverified compliance claims                          |         |

## Phase 1 findings (2026-11-24)

- Repository was empty (no commits, no files) — nothing to reuse or overwrite.
- Cloud environment: Node 22.23, pnpm 10.28, Git 2.43, PostgreSQL 16 (installed, not running),
  Docker, Rust, Playwright/Chromium.
- No Windows laptop connected; Windows-specific setup is unverified.
- No AI provider API keys configured (needed from Phase 5).
