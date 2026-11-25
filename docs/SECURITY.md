# Security model

Implemented now (Phase 2) is marked ✅; planned items name their phase.

| Area              | Rule                                                                                                                                                                                                                                                                                                     | Status      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Network exposure  | Server binds to loopback; non-loopback needs explicit opt-in. No public endpoint.                                                                                                                                                                                                                        | ✅          |
| Errors            | 5xx responses never include stack traces or internal messages.                                                                                                                                                                                                                                           | ✅          |
| Logs              | Authorization, cookies, API keys, passwords, tokens are redacted.                                                                                                                                                                                                                                        | ✅          |
| Config            | Validated at startup; error messages never echo values.                                                                                                                                                                                                                                                  | ✅          |
| HTTP headers      | nosniff, frame DENY, no-referrer, no-store, restrictive CSP on API.                                                                                                                                                                                                                                      | ✅          |
| Secrets           | Only via environment / OS secret store. `.env` git-ignored. Never sent to the browser.                                                                                                                                                                                                                   | ✅ (policy) |
| Authentication    | Single-owner login (session cookie, httpOnly, SameSite=strict) + rate limiting.                                                                                                                                                                                                                          | Phase 4     |
| Project isolation | Every file path resolved inside the project root; symlink/traversal escapes rejected.                                                                                                                                                                                                                    | Phase 6     |
| Command execution | argv arrays only (no shell strings), per-project allow-list, timeouts, approval for risky.                                                                                                                                                                                                               | Phase 6     |
| Destructive ops   | Delete, reset, migrations, deploys, credential changes require explicit approval.                                                                                                                                                                                                                        | Phase 6     |
| AI output         | Model output, repo content and uploads are untrusted input; never auto-executed.                                                                                                                                                                                                                         | Phase 5–6   |
| Audit             | Append-only log of sign-ins (incl. failures), project/command changes, task actions, change proposals/applies/rejects/reverts/conflicts, command runs, agent steps, backups, imports, password changes. Identifiers and outcomes only — no contents or secrets. PostgreSQL trigger blocks UPDATE/DELETE. | ✅          |
| Database          | Migrations only via `pnpm db:migrate` after a backup prompt; the app's DB user needs no superuser rights.                                                                                                                                                                                                | ✅          |

## Reaching the server from an iPhone

1. Keep `HOST=127.0.0.1`. Put an HTTPS reverse proxy that only listens on your private
   network (e.g. a VPN/tailnet "serve" feature) in front of port 5173/4000.
2. Add that private host name to `ALLOWED_HOSTS`.
3. Set `NODE_ENV=production` (or `COOKIE_SECURE=true`) so the cookie is HTTPS-only.
4. Never forward the port on your router or publish it to the internet.

Known limits: rate limits are per process and reset on restart; there is no second factor yet.

Known limits (Phase 6a): Windows command execution goes through `cmd.exe` for `.cmd`/`.bat`
tools and rejects arguments containing `& | < > ^ % !` — this path is **not yet tested on
Windows**. Path checks and writes are not atomic with each other (a local process racing to
swap in a symlink between check and write is out of scope for this single-user tool).

## Supply chain and secrets (Phase 7)

- `pnpm check` starts with a secret scan of all tracked files (API keys, tokens, private keys,
  database URLs with passwords, `.env`/key files). CI runs it on every push.
- `pnpm audit:deps` fails on moderate or worse known vulnerabilities; CI runs it too.
- Backups are written owner-only (0600) and the backup folder is git-ignored.

## Production mode (Phase 8)

- Web UI CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` (inline
  _styles_ only, for React style attributes), `frame-ancestors 'none'`, `object-src 'none'`.
- `TRUST_PROXY=true` trusts `X-Forwarded-*` **only from 127.0.0.1/::1** (a local proxy such as
  Tailscale Serve); forwarded headers from any other peer are ignored.
- The end-to-end test runs with `THIRAN_NO_ENV_FILE=1`, so it can never touch real data.
