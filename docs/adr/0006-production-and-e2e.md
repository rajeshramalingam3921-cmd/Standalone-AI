# ADR 0006 — Production serving and end-to-end testing

**Status:** Accepted (Phase 8)

## Decision

- **One process** serves the built web UI and the API on loopback. Remote access is delegated
  to a private-network HTTPS proxy on the same machine (e.g. Tailscale Serve), trusted via
  `TRUST_PROXY` for loopback peers only. No public exposure path is supported.
- **Web app, not native.** Home-Screen install via manifest/icons; a native wrapper only if
  needed later.
- **Black-box e2e** (`scripts/e2e.mjs`) runs the built artifact as a separate process and talks
  HTTP only, plus the real CLI. It runs in CI with the mock provider, and on demand against
  the real Claude API (`--live --yes`) as the acceptance test for the agent.
- The e2e never reads `.env` (`THIRAN_NO_ENV_FILE=1`) and uses a temp folder, so it is safe to
  run on the owner's machine.
