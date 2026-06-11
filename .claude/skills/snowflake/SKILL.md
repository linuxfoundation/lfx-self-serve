---
name: snowflake
description: Use when writing or modifying Self Serve Snowflake queries, touching `snowflake.service.ts`, or building analytics endpoints that hit the singleton Snowflake pool. Trigger phrases include "Snowflake query", "analytics endpoint", "snowflake.service", "SQL bind", "warehouse", "snowflake pool", "direct SQL".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Self Serve Snowflake Skill

You are writing or modifying SQL that runs against Snowflake through Self Serve's singleton connection pool. SQL bind alignment is the most common Critical bug in this area.

## When to use

- Adding a new analytics endpoint (Snowflake-backed) under `apps/lfx-one/src/server/`.
- Modifying a query that touches `snowflake.service.ts` directly.
- Adding a new SQL file or modifying an existing one that uses `?` placeholders.
- Investigating dropped rows, wrong counts, or "snowflake disconnected" errors.

## Workflow

1. **Re-read** `docs/architecture/backend/snowflake-integration.md` (the reference linked below). It documents the singleton pool, query deduplication, warehouse selection, and result-set handling.
2. **Bind discipline** — every `?` placeholder in the SQL must have a corresponding value in the binds array, in the correct order. Bind mismatch is **always Critical** (the reviewer will flag it). Walk left-to-right through the SQL and count `?`; the binds array length must equal that count.
3. **Do not bypass the singleton pool.** `snowflake.service.ts` is a protected file. New consumers go through it; new query methods extend it under code-owner review.
4. **Parameterize, never interpolate.** No string concatenation of user input into SQL.
5. **For project- or persona-scoped queries**, filter by the right Snowflake column up front; do not over-fetch and filter in JS.
6. **Log via the `logger` service** (not `serverLogger`). Use `logger.debug` for query tracing, `logger.warning` for empty results when a result was expected.
7. **For known-false-positive patterns** (e.g., empty result sets that are valid), check `docs/reviews/knowledge-base/data-and-snowflake.md`.

## Reference

- [`docs/architecture/backend/snowflake-integration.md`](../../../docs/architecture/backend/snowflake-integration.md) — the canonical Snowflake architecture doc. Treat this as the source of truth; do not maintain a separate copy under this skill.

## Scope boundaries

- This skill does NOT cover Snowflake access provisioning (routes to `/lfx-skills:lfx-snowflake-access` for users, Terraform repo for service accounts).
- It does NOT cover BI MCP semantic-layer work (routes to `lfx-mcp` or `lfx-lens` via `/lfx-skills:lfx`).
