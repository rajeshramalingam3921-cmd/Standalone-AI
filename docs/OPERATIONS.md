# Operations: backups, restore, audit, incidents

## Backups

```bash
pnpm backup
```

- **PostgreSQL mode** runs `pg_dump --format=custom` into `BACKUP_DIR` (default
  `apps/server/.thiran-backups/`). Needs the PostgreSQL client tools (`pg_dump`) on `PATH`;
  on Windows they come with the PostgreSQL installer (`C:\Program Files\PostgreSQL\16\bin`).
  The password is passed via `PGPASSWORD`, never on the command line.
- **JSON mode** copies `thiran.json` after validating it (a corrupt file is not backed up).
- Each backup is recorded in the audit log. The System page warns when the newest backup is
  older than 7 days.
- **Copy backups off the machine** (external disk or cloud storage you control). A backup on
  the same disk does not protect against disk failure or theft.
- Backups contain everything in the database, including AI chat history and file contents of
  proposed changes. Treat them as confidential.

Old backups are never deleted automatically; remove them yourself when you no longer need them.

## Restore

### PostgreSQL

Stop the server, then restore into an **empty** database (safest), check it, and point
`DATABASE_URL` at it:

```bash
createdb -U thiran thiran_restored
pg_restore --no-owner -U thiran -d thiran_restored apps/server/.thiran-backups/thiran-YYYYMMDDTHHMMSSZ.dump
# set DATABASE_URL=.../thiran_restored, then:
pnpm db:migrate   # applies anything newer than the backup
```

Restoring over the live database (`pg_restore --clean`) is possible but destroys the current
data; take a fresh backup first.

### JSON mode

```bash
# stop the server first — it refuses otherwise
pnpm restore apps/server/.thiran-backups/thiran-YYYYMMDDTHHMMSSZ.json
```

The current data file is saved first as `thiran-…-pre-restore.json`; the replacement is atomic.

## Project file rollback

Every applied change (yours or the agent's) can be rolled back from **Changes**, as long as
the files were not edited afterwards. This works without git. For anything older, use your
project's own version control.

## Audit log

- Owner actions, agent steps and system checks: sign-in (and failed attempts), project and
  command changes, task actions, change proposals / applies / rejects / reverts / conflicts,
  command runs, backups, imports, password changes.
- Stores identifiers, paths, counts, outcomes — **never** file contents, passwords or tokens.
- PostgreSQL: a database trigger rejects `UPDATE` and `DELETE` on `audit_events`. (A database
  superuser can still drop or truncate tables; protect database credentials accordingly.)
- View it under **System → செயல்பாட்டுப் பதிவு**, or per project from **Settings**.

## Checks before every release

```bash
pnpm check        # secret scan, format, lint, typecheck, tests, build
pnpm audit:deps   # known-vulnerable dependencies
```

Both also run in CI. `pnpm-workspace`/`package.json` contains one `pnpm.overrides` entry that
pins a patched `esbuild` inside the `drizzle-kit` dev tool (advisory GHSA-67mh-4wv8-2f99).

## If something goes wrong

| Situation                                              | Do this                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Password may be known to someone                       | `pnpm set-password` on the server (signs out every session).                    |
| `ANTHROPIC_API_KEY` leaked                             | Revoke it in the Anthropic console, create a new one, update `.env`, restart.   |
| Unexpected file changes                                | Check the audit log (who/what applied), roll back from **Changes**, or use git. |
| Server refuses to start: pending migrations            | Back up, then `pnpm db:migrate`.                                                |
| Server refuses to start: corrupt data file (JSON mode) | Restore the latest backup with `pnpm restore`.                                  |
| Agent run stuck after a crash                          | Restart the server; interrupted runs are marked failed and can be re-planned.   |
