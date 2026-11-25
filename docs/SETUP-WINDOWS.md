# Windows setup

> ⚠️ **Not yet verified on Windows.** Everything was built and tested on Linux. Windows-specific
> parts (paths like `C:\…`, running `pnpm`/`npm` commands through `cmd.exe`, `taskkill` on
> timeout, `pg_dump` on PATH) are written for Windows but untested. Run `pnpm e2e` after setup:
> it exercises all of them and tells you exactly what fails.

## 1. Install the tools (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS        # Node.js 22 LTS
winget install Git.Git
winget install PostgreSQL.PostgreSQL.16 # remember the 'postgres' password you choose
corepack enable                          # provides pnpm
```

Open a **new** terminal afterwards, then check: `node -v` (22.x), `pnpm -v` (10.x),
`psql --version`. If `psql`/`pg_dump` are not found, add
`C:\Program Files\PostgreSQL\16\bin` to your PATH.

## 2. Get the code

```powershell
cd $HOME\code
git clone https://github.com/<you>/Standalone-AI.git thiran-ai
cd thiran-ai
pnpm install
pnpm build
pnpm e2e          # self-test with a throwaway project; should end with "E2E PASSED (mock)"
```

## 3. Database

```powershell
# Replace CHANGE_ME with a long random password (here and in .env).
psql -U postgres -c "CREATE ROLE thiran LOGIN PASSWORD 'CHANGE_ME';"
psql -U postgres -c "CREATE DATABASE thiran OWNER thiran;"
```

## 4. Configure `.env` (in the repository root)

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
DATABASE_URL=postgresql://thiran:CHANGE_ME@127.0.0.1:5432/thiran
WORKSPACE_ROOTS=C:\Users\<you>\code
ANTHROPIC_API_KEY=<from console.anthropic.com>
# For iPhone access later (see IPHONE-ACCESS.md):
# COOKIE_SECURE=true
# TRUST_PROXY=true
# ALLOWED_HOSTS=127.0.0.1,localhost,::1,<machine>.<tailnet>.ts.net
```

Only folders **inside** `WORKSPACE_ROOTS` can be opened as projects. Do not set it to `C:\` or
your whole user folder; use the folder that holds your code.

## 5. First run

```powershell
pnpm backup         # harmless on an empty DB; checks pg_dump works
pnpm db:migrate     # lists the SQL migrations, asks, applies
pnpm set-password   # owner password, at least 12 characters
pnpm start          # builds, then serves UI + API on http://127.0.0.1:4000
```

Open http://127.0.0.1:4000 in a browser on the PC and sign in.

## 6. Project commands on Windows

In a project's **Settings**, commands are argument lists without a shell, e.g. `pnpm test`,
`npm run build`, `python -m pytest`. On Windows, `.cmd` tools (npm, pnpm, npx) are started
through `cmd.exe`; for safety, arguments containing `& | < > ^ % !` are refused.

## 7. Start automatically when you sign in (optional)

Task Scheduler → _Create Task…_:

- **General:** "Run only when user is logged on".
- **Triggers:** _At log on_ (your user).
- **Actions:** Program `C:\Program Files\nodejs\node.exe`,
  arguments `apps\server\dist\index.js`, _Start in_ `C:\Users\<you>\code\thiran-ai`.
- **Settings:** "If the task fails, restart every 1 minute".

Run `pnpm build` again after every `git pull`, then restart the task.

## 8. Updating

```powershell
git pull
pnpm install
pnpm backup
pnpm db:migrate
pnpm build
# restart the server / scheduled task
```
