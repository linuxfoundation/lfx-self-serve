---
name: nats
description: Use when publishing or subscribing to NATS from the Self Serve Express BFF — touching `nats.service.ts`, sending NATS requests, consuming subjects, or troubleshooting NATS connectivity. Trigger phrases include "NATS publish", "NATS subscribe", "NATS request", "nats.service", "project RPC", "inter-service messaging".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Self Serve NATS Skill

You are publishing, subscribing, or making NATS request/reply calls from the Self Serve Express BFF.

## When to use

- A backend endpoint needs to look up a resource via NATS request/reply (e.g., project RPC for ID resolution).
- A backend service consumes a NATS subject (e.g., listening for indexer or persona updates).
- A new server-side code path needs to publish to NATS.
- Investigating "no responder" / timeout / connection errors in `nats.service.ts`.

## Workflow

1. **Re-read** `docs/architecture/backend/nats-integration.md` (the reference linked below). It documents the singleton connection, request/reply timeout defaults, project resolution, and the subject conventions Self Serve consumes.
2. **Do not bypass `nats.service.ts`** — it is a protected file. Use the existing helper methods; add new methods through code-owner review.
3. **Use the right subject vocabulary** — subjects are owned by their producing service (per `/lfx-skills:lfx`). Do not invent new subjects from Self Serve; coordinate with the owning service repo first.
4. **Set explicit timeouts** on request/reply calls. Failures must surface as `MicroserviceError` (or equivalent) and route through `next(error)` — never `res.status(500).json()`.
5. **Log via the `logger` service** (not `serverLogger`). Use `logger.debug` for subject + reply tracing, `logger.error` for failed requests.
6. **Mock mode** — for local dev without the full platform stack, follow `docs/architecture/backend/nats-integration.md` and the mock-mode setup in `/setup`. Do not introduce ad-hoc mocks inside production code paths.

## Reference

- [`docs/architecture/backend/nats-integration.md`](../../../docs/architecture/backend/nats-integration.md) — the canonical NATS architecture doc. Treat this as the source of truth; do not maintain a separate copy under this skill.

## Scope boundaries

- This skill does NOT cover the platform NATS deployment (routes to `lfx-v2-helm`).
- It does NOT cover indexer or FGA-sync subject contracts (routes to `lfx-v2-indexer-service` and `lfx-v2-fga-sync` via `/lfx-skills:lfx`).
- It does NOT cover the upstream auth or persona NATS contracts (route to `lfx-v2-auth-service` / `lfx-v2-persona-service`).
