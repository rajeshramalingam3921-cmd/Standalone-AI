# திறன் AI (Thiran AI)

A personal, security-first AI development platform: manage multiple software projects,
plan → approve → execute → verify → report coding tasks with AI models, and operate it
from an iPhone.

> **Status: Phase 4 (persistence + sign-in).** Works today: owner sign-in, projects and
> tasks stored in PostgreSQL (or a JSON file for zero-setup use), task status on a
> mobile-first UI. **Not built yet:** AI chat, the agent that actually runs tasks, and
> file operations. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- Node.js ≥ 22.12 (see `.nvmrc`)
- pnpm 10 (`corepack enable` then `corepack prepare pnpm@10.28.0 --activate`)
- Git

## Setup

```bash
pnpm install
cp .env.example .env            # then edit DATABASE_URL (or leave unset for JSON-file mode)
```

### With PostgreSQL (recommended)

```bash
# once, as a PostgreSQL admin:
#   CREATE ROLE thiran LOGIN PASSWORD '...';  CREATE DATABASE thiran_dev OWNER thiran;
pnpm db:migrate                 # shows pending SQL migrations and asks before applying
pnpm set-password               # owner password (min 12 chars); input is hidden
```

Moving from the Phase 3 JSON file? After `db:migrate`, run `pnpm db:import-json`. It copies
`.thiran-data/thiran.json` into an **empty** database and leaves the JSON file untouched.

### Without PostgreSQL

Leave `DATABASE_URL` unset; data goes to `apps/server/.thiran-data/thiran.json`.
Run `pnpm set-password` the same way.

### Run

```bash
pnpm dev:server                 # API on http://127.0.0.1:4000
pnpm dev:web                    # UI  on http://127.0.0.1:5173 (proxies /api)
```

The server refuses to start if migrations are pending or the data file is corrupt — it
never migrates or overwrites data on its own.

### Backups

- PostgreSQL: `pg_dump -Fc thiran_dev > thiran-$(date +%F).dump` (restore with `pg_restore`).
- JSON mode: copy the `.thiran-data/` folder.

## API

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
| `apps/server`     | Fastify API, auth, PostgreSQL/JSON stores, admin CLI.           |
| `apps/web`        | Mobile-first React + Vite UI.                                   |
| `packages/shared` | Types/contracts shared by server and web (task state machine…). |
| `docs/`           | Architecture, roadmap, security model, decision records.        |

## சுருக்கம் (தமிழில்)

இப்போது கடவுச்சொல்லுடன் உள்நுழையலாம். Projects, tasks PostgreSQL-இல் சேமிக்கப்படும்.
Database மாற்றங்கள் (migrations) நீங்கள் `pnpm db:migrate` ஓட்டி உறுதி செய்தால் மட்டுமே
நடக்கும். கடவுச்சொல்லை server கணினியில் `pnpm set-password` மூலம் மட்டுமே அமைக்க முடியும்.
AI chat, task-ஐ இயக்கும் agent ஆகியவை அடுத்த phase-களில் வரும்.
