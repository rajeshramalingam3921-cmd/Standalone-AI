# ADR 0005 — Controlled AI agent workflow

**Status:** Accepted (Phase 6b)

## Decision

- **Self-hosted loop on the Messages API**, not a hosted agent service: the files live on the
  owner's machine and every tool call must pass the local sandbox from ADR 0004.
- **Two owner gates.** The agent first plans with read-only tools and submits a plan; only an
  approved plan can be executed. Execution can only _stage_ full file contents; the result is
  an ordinary change set that the owner applies or rejects.
- **Verification decides the outcome.** After apply, the owner-configured checks run. Only
  "all passed" marks a task completed; no checks configured → needs attention ("not verified").
- **Report from facts.** The Tamil report is assembled by the server from the plan, diff stats
  and check results; the model's own summary is quoted and labelled unverified.
- **Bounded.** Attempts/plans per task, turns/tokens/time per run, one job per task (the status
  change is atomic, so double taps cannot start two runs), no automatic retries.

## Consequences

- A failing attempt costs one owner tap to re-plan, and the next plan sees the failed output.
- A "Claude Code review" step (second model reviewing the diff) is not built; the owner's diff
  review plus checks fill that role for now.
