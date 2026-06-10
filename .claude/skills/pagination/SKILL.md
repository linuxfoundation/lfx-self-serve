---
name: pagination
description: Use when a Self Serve backend endpoint returns lists, when you need cursor pagination (`page_token` / `page_size`) against the query service, or when fetching all pages of a resource via the `fetchAllQueryResources` helper. Trigger phrases include "paginated endpoint", "page_token", "page_size", "infinite scroll backend", "list endpoint", "fetch all pages".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Self Serve Pagination Skill

You are building or modifying a Self Serve backend endpoint that returns a list of resources. All list endpoints use cursor pagination through the query service.

## When to use

- A new endpoint returns a list (a `GET /api/<resource>` that wraps the query service).
- An existing list endpoint needs filtering, sorting, search (typeahead), or tag matching.
- The frontend needs every page of a resource (admin export, full-list aggregation) — use `fetchAllQueryResources`.
- A list endpoint accidentally uses `limit` instead of `page_size` (canonical bug).

## Workflow

1. **Re-read** `docs/architecture/backend/pagination.md` (the reference linked below). It documents `QueryServiceResponse<T>`, `PaginatedResponse<T>`, the parameter set, and `fetchAllQueryResources`.
2. **Use `page_size`, NOT `limit`.** Query-service convention. Exception: the meetings API upstream uses `limit` — verify against the upstream contract via `gh api` before assuming.
3. **Use `page_token` for cursor pagination.** Conditional spread: `...(pageToken ? { page_token: pageToken } : {})`.
4. **Wrap responses in `PaginatedResponse<T>`** — `{ data: T[], page_token?: string }`.
5. **Use the `filters` array format** — `field:value`, auto-prefixed with `data.` by the query service. See the doc.
6. **For all-pages fetches**, use `fetchAllQueryResources` (in `helpers/`). Never hand-roll a `while (page_token)` loop.
7. **Run the upstream-contract check** before shipping — proxy endpoints must align with the upstream schema. Surface "manual validation required" if the upstream cannot be reached.

## Reference

- [`docs/architecture/backend/pagination.md`](../../../docs/architecture/backend/pagination.md) — the canonical pagination architecture doc. Treat this as the source of truth; do not maintain a separate copy under this skill.

## Scope boundaries

- This skill does NOT cover frontend infinite-scroll UI (see `.claude/skills/self-serve-dev/references/frontend-code-generation.md` Section 4).
- It does NOT cover query-service implementation itself — that work routes to `lfx-v2-query-service`.
