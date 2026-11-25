# திறன் AI (Thiran AI)

A personal, security-first AI development platform: manage multiple software projects,
plan → approve → execute → verify → report coding tasks with AI models, and operate it
from an iPhone.

> **Status: Phase 5 (AI chat).** Works today: owner sign-in, projects and tasks in
> PostgreSQL (or a JSON file), and a per-project AI chat with streaming replies (Claude via
> the official Anthropic SDK, or an offline mock). **Not built yet:** the agent that reads
> files, runs commands and executes tasks (Phase 6). See [docs/ROADMAP.md](docs/ROADMAP.md).

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

### AI chat

Put `ANTHROPIC_API_KEY=...` in `.env` (from console.anthropic.com — a Claude subscription does
not include API access) and restart the server. Without a key, the chat screen explains what
to set. To try the UI without any key or cost, run the server with `AI_PROVIDER=mock`.

Each message goes to the Anthropic API and is billed to that key. Answers can be wrong; the
chat cannot see your files or run anything, and says so.

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

| Method | Path                                                  | Purpose                                                    |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/health`                                         | Server status                                              |
| GET    | `/api/projects`                                       | Projects with task counts                                  |
| POST   | `/api/projects`                                       | Create project                                             |
| GET    | `/api/projects/:projectId`                            | Project details                                            |
| GET    | `/api/projects/:projectId/tasks`                      | Tasks of one project                                       |
| POST   | `/api/projects/:projectId/tasks`                      | Create task (`draft`)                                      |
| GET    | `/api/ai/status`                                      | Provider, configured?, allowed models                      |
| GET    | `/api/projects/:projectId/conversations`              | Conversations of a project                                 |
| POST   | `/api/projects/:projectId/conversations`              | New conversation `{ model? }`                              |
| GET    | `/api/projects/:projectId/conversations/:id/messages` | Messages, oldest first                                     |
| POST   | `/api/projects/:projectId/conversations/:id/messages` | `{ content, model? }` → SSE stream                         |
| POST   | `/api/projects/:projectId/tasks/:taskId/actions`      | `{ "action": "approve" \| "request_changes" \| "cancel" }` |

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

இப்போது ஒவ்வொரு project-க்கும் AI Chat உள்ளது. பதில் எழுத்தெழுத்தாக வரும்; நடுவில் நிறுத்தலாம்;
model-ஐத் தேர்ந்தெடுக்கலாம். உண்மையான Claude-க்கு `.env`-இல் `ANTHROPIC_API_KEY` தேவை
(console.anthropic.com — Claude subscription-இல் இது சேர்ந்து வராது). Key server-இல் மட்டுமே
இருக்கும். இந்த chat உங்கள் files-ஐப் படிக்காது, commands-ஐ ஓட்டாது — அது Phase 6.
