# திறன் AI (Thiran AI)

A personal, security-first AI development platform: manage multiple software projects,
plan → approve → execute → verify → report coding tasks with AI models, and operate it
from an iPhone.

> **Status: Phase 2 (foundation).** What works today is a verified skeleton — a Fastify
> API with a health endpoint and a mobile-first React UI that shows server status.
> Projects, tasks, AI chat and file operations are **not built yet**. See
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

## Quality gate

```bash
pnpm check   # prettier + eslint + typecheck + tests + build
```

## Layout

| Path              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `apps/server`     | Fastify API (Node + TypeScript). Loopback-only by default.      |
| `apps/web`        | Mobile-first React + Vite UI.                                   |
| `packages/shared` | Types/contracts shared by server and web (task state machine…). |
| `docs/`           | Architecture, roadmap, security model, decision records.        |

## சுருக்கம் (தமிழில்)

இது திறன் AI-இன் அடித்தளம் மட்டுமே. Server, mobile UI இரண்டும் இயங்குகின்றன; tests
அனைத்தும் pass ஆகின்றன. Project மேலாண்மை, AI chat, file செயல்பாடுகள் அடுத்த
phase-களில் வரும். Server இயல்பாக `127.0.0.1`-இல் மட்டுமே கேட்கும் — internet-க்கு
நேரடியாகத் திறக்கப்படாது.
