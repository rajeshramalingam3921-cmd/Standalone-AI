# திறன் AI (Thiran AI)

A personal, security-first AI development platform: manage multiple software projects,
plan → approve → execute → verify → report coding tasks with AI models, and operate it
from an iPhone.

> **Status: Phase 8 — feature-complete MVP.** Sign-in, projects, AI chat, a controlled AI
> agent (plan → approve → diff → approve → your checks → Tamil report), audit log, backups,
> production mode, iPhone Home-Screen app, and a black-box end-to-end test.
> **Not yet verified: the real Claude API, Windows, a physical iPhone** — see
> "What is verified" below.

## Documentation

| Guide                                                                | For                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md)                       | Installing and running on your Windows PC            |
| [docs/IPHONE-ACCESS.md](docs/IPHONE-ACCESS.md)                       | Safe access from the iPhone (private network, HTTPS) |
| [docs/USER-GUIDE-TA.md](docs/USER-GUIDE-TA.md)                       | பயன்பாட்டு வழிகாட்டி (தமிழ்)                             |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)                             | Backups, restore, audit, incidents                   |
| [docs/SECURITY.md](docs/SECURITY.md)                                 | Security model                                       |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/adr/](docs/adr/) | Design and decisions                                 |

## What is verified

| Verified (automated, every CI run)                                                                             | Not yet verified                                          |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 250+ unit/integration tests incl. real PostgreSQL 16                                                           | A real Claude API agent run (`pnpm e2e:live`)             |
| `pnpm e2e`: built server as a real process, full workflow over HTTP with a sample project, CLI backup, restart | Windows (paths, `cmd.exe` wrapper, `taskkill`, `pg_dump`) |
| Agent loop against a local fake of the Messages API                                                            | A physical iPhone / Tailscale                             |
| Browser runs at iPhone 13 size (during development)                                                            |                                                           |

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

### AI agent (task → plan → diff → checks → report)

1. Create a task, open it, tap **AI திட்டமிடட்டும்**. The agent reads files (read-only) and
   proposes a plan.
2. **Approve the plan** or **request changes** with written feedback.
3. The agent proposes complete file contents → a pending change. Review the diff in
   **Changes** and apply it (two taps) or reject it.
4. After applying, the project's configured checks run. The task is **completed only if all
   checks pass**; otherwise it needs attention and you can re-plan (failed output is given to
   the next plan). With no checks configured the task is never marked completed.
5. Limits: 3 execution attempts and 10 plans per task, 30 model turns, a token budget and a
   20-minute timeout per run. No automatic retries.

### Production (one server for UI + API)

```bash
pnpm start          # builds, then serves http://127.0.0.1:4000
```

### End-to-end self-test

```bash
pnpm e2e                      # free: mock AI, throwaway data, never reads your .env
ANTHROPIC_API_KEY=... pnpm e2e:live --yes   # REAL agent on a sample bug (billed, token-capped)
```

### Development

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
| GET    | `/api/audit?projectId=&before=&limit=`                | Audit log, newest first                                    |
| GET    | `/api/system/status`                                  | Store, AI, roots, last backup                              |
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
pnpm check        # secret scan + prettier + eslint + typecheck + tests + build
pnpm audit:deps   # known-vulnerable dependencies
pnpm backup       # see docs/OPERATIONS.md for restore
```

## Layout

| Path              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `apps/server`     | Fastify API, auth, PostgreSQL/JSON stores, admin CLI.           |
| `apps/web`        | Mobile-first React + Vite UI.                                   |
| `packages/shared` | Types/contracts shared by server and web (task state machine…). |
| `docs/`           | Architecture, roadmap, security model, decision records.        |

## சுருக்கம் (தமிழில்)

திறன் AI-இல் இப்போது: உள்நுழைவு, projects, AI chat, கட்டுப்படுத்தப்பட்ட AI agent (திட்டம் → உங்கள்
அனுமதி → diff → உங்கள் அனுமதி → உங்கள் tests → தமிழ் அறிக்கை). ஒவ்வொரு முக்கியச் செயலும்
மாற்ற முடியாத "செயல்பாட்டுப் பதிவில்" சேமிக்கப்படும். `pnpm backup` மூலம் backup எடுக்கலாம்;
7 நாட்களுக்கு மேல் backup இல்லையென்றால் System பக்கம் எச்சரிக்கும். Backup-ஐ வேறு disk-க்கு
நகலெடுக்க மறக்காதீர்கள்.
