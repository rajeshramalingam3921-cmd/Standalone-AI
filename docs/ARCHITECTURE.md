# Architecture

## Goals

1. Manage multiple independent projects (local folders first; GitHub optional).
2. Controlled agent workflow: **plan → approve → execute → verify → report**.
3. Provider-independent AI layer (Claude API first; others via their official APIs).
4. Usable from an iPhone without exposing the development machine to the internet.

## Components

```
 iPhone (Safari / PWA)
      │  HTTPS over a private network (e.g. VPN / tailnet) — never public
      ▼
 apps/web  (React, mobile-first)  ──/api──►  apps/server (Fastify, Node)
                                               ├─ Projects & tasks (PostgreSQL, Phase 4)
                                               ├─ AI provider layer (Phase 5)
                                               │    └─ adapters: anthropic, openai, …
                                               ├─ Agent engine (Phase 6)
                                               │    ├─ planner / task state machine
                                               │    ├─ file ops (sandboxed to project root)
                                               │    └─ command runner (allow-listed)
                                               └─ Audit log
```

### Where it runs

| Scenario                          | How                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Building Thiran AI itself         | Claude Code cloud sessions on this repo, driven from the iPhone app.                     |
| Running Thiran AI on your laptop  | `apps/server` on Windows, bound to `127.0.0.1`; iPhone reaches it through a private VPN. |
| Letting a cloud session use files | Claude desktop app → Settings → Claude Code → Remote Control, share a specific folder.   |

A chat app on a phone does **not** grant access to laptop files. Access is always an
explicit, revocable connection.

### Key decisions

- **Monorepo (pnpm workspaces)** — one place for contracts shared by UI and API.
- **Fastify + Zod** — fast, typed, schema-validated input.
- **Task state machine in `packages/shared`** — tasks cannot skip approval or be marked
  complete without passing verification (enforced by tests).
- **PostgreSQL + an ORM in Phase 4** — only when persistence is actually needed.
- **Loopback by default** — non-loopback binding requires `ALLOW_NON_LOOPBACK=true`.

See `docs/adr/` for individual decision records.
