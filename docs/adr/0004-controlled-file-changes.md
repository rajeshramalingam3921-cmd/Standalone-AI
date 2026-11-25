# ADR 0004 — Controlled file changes and commands

**Status:** Accepted (Phase 6a)

## Context

The platform must edit real project files and run real commands, from a phone, without
risking data outside the project, secrets, or silent overwrites — and later let an AI drive it.

## Decision

- **Two-level folder authorization.** The server owner lists `WORKSPACE_ROOTS`; a project's
  folder must resolve (after symlinks) strictly inside one. Empty roots = no file access.
- **Every write is a change set.** Proposals store each file's original content and hash.
  Applying is a separate, explicit owner action (two taps in the UI) and is refused if any file
  changed since the proposal. Revert is allowed only if the files are still exactly as applied.
  This is the single path the AI agent will also use — it will never get a direct write.
- **Commands are owner data, not AI output.** Only `build`/`test`/`lint` argv arrays set in
  Settings can run: no shell, allow-listed environment, timeout with process-tree kill,
  capped output. One file-changing operation or command per project at a time.
- **No deletes, git operations, deploys or DB commands** in this phase.

## Consequences

- The AI agent (6b) only needs read tools plus "propose change set" and "request check";
  everything dangerous stays behind owner approval.
- Rollback uses stored originals rather than git, so it works in non-git folders too.
