# Security model

Implemented now (Phase 2) is marked ✅; planned items name their phase.

| Area              | Rule                                                                                       | Status      |
| ----------------- | ------------------------------------------------------------------------------------------ | ----------- |
| Network exposure  | Server binds to loopback; non-loopback needs explicit opt-in. No public endpoint.          | ✅          |
| Errors            | 5xx responses never include stack traces or internal messages.                             | ✅          |
| Logs              | Authorization, cookies, API keys, passwords, tokens are redacted.                          | ✅          |
| Config            | Validated at startup; error messages never echo values.                                    | ✅          |
| HTTP headers      | nosniff, frame DENY, no-referrer, no-store, restrictive CSP on API.                        | ✅          |
| Secrets           | Only via environment / OS secret store. `.env` git-ignored. Never sent to the browser.     | ✅ (policy) |
| Authentication    | Single-owner login (session cookie, httpOnly, SameSite=strict) + rate limiting.            | Phase 4     |
| Project isolation | Every file path resolved inside the project root; symlink/traversal escapes rejected.      | Phase 6     |
| Command execution | argv arrays only (no shell strings), per-project allow-list, timeouts, approval for risky. | Phase 6     |
| Destructive ops   | Delete, reset, migrations, deploys, credential changes require explicit approval.          | Phase 6     |
| AI output         | Model output, repo content and uploads are untrusted input; never auto-executed.           | Phase 5–6   |
| Audit             | Append-only log of approvals, commands and file changes.                                   | Phase 6–7   |
| Database          | Read-only inspection by default; writes/migrations need approval and a backup.             | Phase 7+    |
