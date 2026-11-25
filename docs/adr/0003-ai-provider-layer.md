# ADR 0003 — AI provider layer and streaming chat

**Status:** Accepted (Phase 5)

## Decision

- Routes talk to an `AiProvider` interface, never to an SDK. Providers map their errors to a
  fixed set of codes (`rate_limited`, `overloaded`, `timeout`, …) that the UI explains in Tamil.
- First provider: Claude through the official `@anthropic-ai/sdk`, streaming, default model
  `claude-opus-5-5`, effort `high` (configurable), automatic prompt caching, and the API's
  server-side safety fallback (`fallbacks: "default"`) so a policy decline can be answered by
  the API's designated fallback model; the UI shows which model actually answered.
- An offline mock provider (`AI_PROVIDER=mock`) for development and tests, always labelled in
  the UI as not real AI.
- Replies stream over Server-Sent Events from a POST (JSON body keeps the CSRF protection).
  Closing the connection aborts the upstream request; the partial reply is stored as
  `stopped`.
- The chat has no tools: it cannot read files or run commands, and its system prompt tells it
  to say so. Tool use arrives with the controlled agent workflow in Phase 6.

## Consequences

- The busy lock and rate limits are per process (single-instance personal server).
- Real-API behaviour is covered by tests against a local fake of the Messages API; a live call
  still needs to be checked once a key is configured.
