# திறன் AI (Thiran AI)

A personal, security-first AI development platform: manage multiple software projects,
plan → approve → execute → verify → report coding tasks with AI models, and operate it
from an iPhone.

> **Status: Phase 3 (workspace).** Works today: create and browse projects, add tasks,
> see their status, cancel them, on a mobile-first UI; data is kept in a local JSON file.
> **Not built yet:** login, PostgreSQL, AI chat, the agent that actually runs tasks, and
> file operations. See
> [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- Node.js ≥ 22.12 (see `.nvmrc`)
- pnpm 10 (`corepack enable` then `corepack prepare pnpm@10.28.0 --activate`)
- Git

## Quick start

```bash
pnpm install
cp .env.example .env        # optional; safe defaults are built in
pnpm dev:server             # API on http://127.0.0.1:4000
pnpm dev:web                # UI  on http://127.0.0.1:5173 (proxies /api)
```

## API (Phase 3)

| Method | Path                                             | Purpose                                                    |
| ------ | ------------------------------------------------ | ---------------------------------------------------------- |
| GET    | `/api/health`                                    | Server status                                              |
| GET    | `/api/projects`                                  | Projects with task counts                                  |
| POST   | `/api/projects`                                  | Create project                                             |
| GET    | `/api/projects/:projectId`                       | Project details                                            |
| GET    | `/api/projects/:projectId/tasks`                 | Tasks of one project                                       |
| POST   | `/api/projects/:projectId/tasks`                 | Create task (`draft`)                                      |
| POST   | `/api/projects/:projectId/tasks/:taskId/actions` | `{ "action": "approve" \| "request_changes" \| "cancel" }` |

## Quality gate

```bash
pnpm check   # prettier + eslint + typecheck + tests + build
```

## Layout

| Path              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `apps/server`     | Fastify API + JSON-file store. Loopback-only by default.        |
| `apps/web`        | Mobile-first React + Vite UI.                                   |
| `packages/shared` | Types/contracts shared by server and web (task state machine…). |
| `docs/`           | Architecture, roadmap, security model, decision records.        |

## சுருக்கம் (தமிழில்)

இப்போது project உருவாக்கலாம், task சேர்க்கலாம், அவற்றின் நிலையைப் பார்க்கலாம்.
தரவு `.thiran-data/thiran.json`-இல் சேமிக்கப்படும் — அந்த folder-ஐ backup எடுங்கள்.
Login, AI chat, task-ஐ உண்மையில் இயக்கும் agent ஆகியவை அடுத்த phase-களில் வரும். Server இயல்பாக `127.0.0.1`-இல் மட்டுமே கேட்கும் — internet-க்கு
நேரடியாகத் திறக்கப்படாது.
