# திறன் AI (Thiran AI)

A personal, security-first AI development platform: manage multiple software projects,
plan → approve → execute → verify → report coding tasks with AI models, and operate it
from an iPhone.

> **Status: Phase 6a (controlled file changes).** Works today: sign-in, projects and tasks,
> AI chat, and — for project folders you authorize — read-only file browsing, edits that
> become reviewable diffs, apply only after approval, rollback, and running your own
> build/test/lint commands. **Not built yet:** the AI agent that proposes changes and runs
> checks by itself (Phase 6b). See [docs/ROADMAP.md](docs/ROADMAP.md).

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

### Project folders (Files, Changes, Checks)

1. In `.env`, set `WORKSPACE_ROOTS` to the folder that contains your projects
   (e.g. `C:\Users\you\code`). Nothing outside it can ever be read or written.
2. In the project's **Settings** tab, set the project folder (inside that root) and, optionally,
   build / test / lint commands such as `pnpm test`. These run without a shell, with a
   timeout, and without the server's secrets in their environment.
3. **Files**: browse and read. `.env`, keys, `.git`, `node_modules` are never shown or read.
   Editing creates a _change_ — nothing is written yet.
4. **Changes**: review the diff, tap twice to apply. If the file changed on disk in the
   meantime, apply is refused. Applied changes can be rolled back (if untouched since).
5. **Checks**: run your commands and read their output.

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

இப்போது நீங்கள் அனுமதித்த project folder-இல் files-ஐப் பார்க்கலாம், திருத்தலாம். திருத்தம் நேரடியாக
எழுதப்படாது: முதலில் diff ஆகக் காட்டப்பட்டு, நீங்கள் இருமுறை தட்டி அனுமதித்த பிறகே எழுதப்படும்.
இதற்கிடையில் file மாறியிருந்தால் எழுதாது. தேவைப்பட்டால் திரும்பப் பெறலாம். நீங்கள் அமைத்த
build/test commands-ஐ மட்டும் ஓட்டலாம். AI தானாக மாற்றங்களைப் பரிந்துரைப்பது அடுத்த படி (Phase 6b).
