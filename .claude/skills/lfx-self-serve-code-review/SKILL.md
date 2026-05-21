---
name: lfx-self-serve-code-review
description: "Audits the latest commit on the local branch in two sequential passes: (1) general code review on the raw diff via the subagent's native disposition, run BEFORE any repo docs are loaded so it stays untainted by repo-specific framing; (2) convention audit — load `.claude/rules/`, the four `docs/reviews/` checklists, architecture docs, and walk them with cross-check discipline (every finding quotes a loaded source) plus upstream API contracts. Pass the keyword `branch` to switch to full-branch mode (audits the branch's diff against main — used for the pre-PR full-branch sweep and by `/lfx-review-pr`). Renders a markdown review with General review / Upstream API / Repo conventions sections. Skill body launches a code-reviewer subagent in the background."
allowed-tools: Agent
---

Launch a subagent in the background (`subagent_type: code-reviewer`, `model: "opus"`, `run_in_background: true`) with the **entire content below** as the Agent `prompt` parameter. Append the caller's runtime args (`branch`, `extra`) at the end so the subagent sees both the playbook and its inputs.

The explicit `model: "opus"` pins the review to Opus (currently 4.7) for the depth this audit needs — defensive against the `code-reviewer` agent definition's load-order ambiguity (the `feature-dev` variant declares `sonnet`).

**Launcher discipline — non-negotiable:** pass the playbook **verbatim**. The playbook contains its own routing logic (Step 3.1 picks which checklists / architecture docs to load based on changed paths). Trimming it strips routing → the subagent can't quote rules that weren't loaded → Step 3.2 cross-check collapses → severity calibration and the report template drift.

---

# LFX Self-Serve Code Reviewer

You audit the latest commit on the LFX Self-Serve branch. The audit has two layers, run sequentially — general review first on the raw diff, then convention audit after the docs are loaded:

1. **General code review** (Step 2) — apply your standard review disposition to the diff. Run this BEFORE loading any repo docs so it stays untainted by repo-specific framing. Findings here do NOT need a source citation; your native concrete-failure-mode standard is the bar.
2. **Convention audit** (Step 3) — load this repo's documented rule surface (`.claude/rules/`, the four `docs/reviews/` checklists, architecture docs) in 3.1, then walk it in 3.2; plus upstream API contracts (Step 4). **Cross-check discipline:** every finding here MUST quote a loaded source — drop unsourced claims to avoid inventing repo conventions.

Empirical-pattern matches against past PR review comments belong to `/lfx-self-serve-learnings-review`, not here.

## Inputs

Parse the caller's prompt for:

- **`branch`** — OPTIONAL keyword. If present, switch to full-branch mode: audit the branch's diff against main (`origin/main...HEAD`) instead of just the latest commit. Used by the pre-PR full-branch sweep and `/lfx-review-pr`.
- **`extra: <free text>`** — optional priority hint.

## Step 1 — Compute the diff

Default mode: `git show --stat -p HEAD` — audits only the latest commit (not staged / unstaged work). Use the stat block as the canonical changed-file list; abort if empty.

Full-branch mode (`branch` passed): `git fetch origin && git diff --stat origin/main...HEAD && git diff origin/main...HEAD` — the branch's diff against main, i.e., everything HEAD adds vs `origin/main`.

For per-file reads: `git show "HEAD:<path>"`. If the diff is too big for context, save to `/tmp/code-review-diff.patch` and Read changed files individually.

Commit-level data is not your concern — signatures are checked by `/lfx-self-serve-pr-readiness` pre-PR; prior review comments are verified by `/lfx-review-pr` post-PR.

## Step 2 — General review

Apply your standard code-review disposition to the diff from Step 1. **Run this BEFORE loading any reference docs** — this layer is intentionally untainted by repo-specific framing. Treat it as a regular code review of an unfamiliar diff.

Findings here go in the **General review** section of the Step 5 report. The cross-check discipline in Step 3.2 does NOT apply; your native concrete-failure-mode standard is the bar. Apply the report's ≥80 confidence floor and Critical / Important grouping (see Severity calibration below).

## Step 3 — Convention audit

Now layer the LFX-specific conventions on top: load the docs, then walk the audit using them. Step 3.1 sets up the source-of-truth surface; Step 3.2 audits against it with cross-check discipline.

### 3.1 — Load reference documents

Always pull current contents — never rely on memory of these files from prior runs.

**Always read (in parallel):**

- `CLAUDE.md` at the repo root
- `~/.claude/CLAUDE.md` if it exists
- Every file matching `.claude/rules/*.md` — Glob dynamically; never hand-maintain a list

**⚠ Mandatory: the four `docs/reviews/` checklists.** These are the **primary audit surface** — each item exists because it broke a real PR on this repo. Skipping a relevant checklist invalidates the audit. If you cannot Read a required checklist, mark the report as **INCOMPLETE**.

| Touched paths                         | Required checklist                         |
| ------------------------------------- | ------------------------------------------ |
| `apps/lfx-one/src/app/**`             | `docs/reviews/frontend-checklist.md`       |
| `apps/lfx-one/src/server/**`          | `docs/reviews/backend-checklist.md`        |
| `packages/shared/**` or Snowflake SQL | `docs/reviews/shared-and-sql-checklist.md` |
| `docs/**`                             | `docs/reviews/docs-checklist.md`           |

You audit **by these checklists**, not against your general framework knowledge. Locate a specific checklist item, rule file entry, or architecture-doc paragraph for every Repo-conventions finding (see 3.2).

**Architecture docs — load conditionally by changed-file paths:**

| Touched paths                                  | Load                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/lfx-one/src/app/**`                      | `docs/architecture/frontend/angular-patterns.md`, `component-architecture.md`, `styling-system.md`                    |
| Drawer component or `DialogService.open` usage | `docs/architecture/frontend/drawer-pattern.md`                                                                        |
| `apps/lfx-one/src/server/**`                   | `docs/architecture/backend/README.md`, `error-handling-architecture.md`, `logging-monitoring.md`, `server-helpers.md` |
| `middleware/auth*`                             | `docs/architecture/backend/authentication.md`                                                                         |
| `auth-helper`, persona helpers                 | `docs/architecture/backend/impersonation.md`                                                                          |
| `/public/**` routes, public meetings           | `docs/architecture/backend/public-meetings.md`                                                                        |
| Pagination helpers, list endpoints             | `docs/architecture/backend/pagination.md`                                                                             |
| `ai.service.ts`, AI proxy calls                | `docs/architecture/backend/ai-service.md`                                                                             |
| `nats.service.ts`, project NATS RPCs           | `docs/architecture/backend/nats-integration.md`                                                                       |
| `snowflake.service.ts`, direct SQL             | `docs/architecture/backend/snowflake-integration.md`                                                                  |
| SSR / `server.ts` / render pipeline            | `docs/architecture/backend/ssr-server.md`                                                                             |
| `packages/shared/**`                           | `docs/architecture/shared/package-architecture.md`                                                                    |
| `*.spec.ts` or `e2e/**`                        | `docs/architecture/testing/e2e-testing.md`, `docs/architecture/testing/testing-best-practices.md`                     |

If `.claude/skills/develop/references/` exists, also Read the relevant reference files (`backend-endpoint.md` for server changes, `frontend-component.md` for components, etc.).

### 3.2 — Walk the audit

For each changed file:

1. **Read the full file at the current revision** — don't audit from diff alone; context matters.
2. **Categorize** — frontend component / frontend service / SSR / backend service / controller / route / shared / SQL / docs / mixed.
3. **Walk every applicable item** in the relevant `docs/reviews/` checklist + every applicable rule in `.claude/rules/` + the architecture docs loaded in 3.1.
4. **Cross-check before emitting:** for each candidate finding, locate the exact rule, checklist item, or architecture-doc paragraph it violates. Quote that source in the finding's `_Source:_` citation. **If you cannot quote the source, drop the finding** — hallucinated rules are worse than missed ones. These findings go in the **Repo conventions** section of the Step 5 report.
5. **Account for the full checklist surface:** if you cannot account for having considered every applicable checklist item, mark the report **INCOMPLETE** in Step 5 rather than ship a partial report.

## Step 4 — Upstream API / data-layer contract validation (backend only)

**Skip this entirely if no files under `apps/lfx-one/src/server/` were changed.**

The LFX One backend is a thin proxy to external Go microservices. New or modified proxy endpoints must align with the upstream API contract.

Required for:

- Any new file in `services/`, `controllers/`, or `routes/`
- Any modified service that calls `MicroserviceProxyService.proxyRequest()`
- Any new API path or changed request/response shape

For modifications to existing endpoints (not new ones), a lighter check is acceptable — verify the endpoint still exists rather than a full schema comparison.

```bash
gh api repos/linuxfoundation/<repo-name>/contents/gen/http/openapi3.yaml --jq '.content' | base64 -d
gh api repos/linuxfoundation/<repo-name>/contents/design --jq '.[].name'
gh api repos/linuxfoundation/<repo-name>/contents/design/<file>.go --jq '.content' | base64 -d
```

Upstream repo map:

| Domain        | Repo                          |
| ------------- | ----------------------------- |
| Queries       | `lfx-v2-query-service`        |
| Projects      | `lfx-v2-project-service`      |
| Meetings      | `lfx-v2-meeting-service`      |
| Mailing Lists | `lfx-v2-mailing-list-service` |
| Committees    | `lfx-v2-committee-service`    |
| Voting        | `lfx-v2-voting-service`       |
| Surveys       | `lfx-v2-survey-service`       |

Validate:

- Endpoint paths and HTTP methods match upstream
- Request body / query params match upstream schema (no extra fields, no missing required)
- Response shape matches upstream
- Query Service conventions: `page_size` (NOT `limit`), `page_token` for cursor pagination, `filters` format `field:value`
- No fabricated endpoints — if upstream doesn't expose it, the proxy shouldn't pretend it exists

**Snowflake direct SQL:** every `?` placeholder must have a corresponding value in the binds array, in the correct order. Bind mismatch is always Critical.

**On `gh api` failure** (404, auth, network): surface in Step 5's "Upstream API / data-layer validation" section as "Upstream API contract for `<service>` could not be verified — manual validation required." Treat as Important severity. Don't silently skip.

## Step 5 — Render the report

Header: `<commit-sha> — <subject>` (default) or `origin/main...HEAD (<branch-name>, N commits)` (full-branch mode), plus files changed and additions / deletions.

Three sections, in order. Each findings section groups under `### Critical (N)` (conf 90-100) and `### Important (N)` (conf 80-89), with `### No findings` if none clear the ≥80 floor.

1. **General review** (Step 2): `- **<file>:<line>** (conf <0-100>) — <issue>. _Fix:_ <suggestion>.`
2. **Upstream API / data-layer validation** (Step 4): verified paths, SQL bind checks, "manual validation required" flags, or "Skipped — no backend changes".
3. **Repo conventions** (Step 3.2): `- **<file>:<line>** (conf <0-100>) — <issue>. _Source:_ <quoted rule citation>. _Fix:_ <suggestion>.`

If a required checklist or architecture doc couldn't be loaded, lead with `INCOMPLETE — couldn't load <file>`. If `extra` was applied, note it.

## Severity calibration

Both layers share the same buckets and ≥80 floor. Examples illustrative, not exhaustive — general-review findings inherit the buckets via your native calibration.

- **Critical** (90-100) — runtime bugs, security, SQL bind mismatches, upstream contract violations, bypassed user authorization, M2M misuse, raw `new Error()` / manual `res.status().json()`.
- **Important** (80-89) — documented style / structure violations (logger usage, license headers, PrimeNG wrappers, `@if`/`@for`, `inject()` DI, `page_size` over `limit`), unverified upstream contracts.
- **Nit** (below 80) — preferences, minor improvements, file naming. Suppressed by the ≥80 floor, except `category: upstream-api` deterministic flags.

## Known false positives — DO NOT emit

- Missing `ChangeDetectionStrategy.OnPush` — the app uses stable zoneless change detection.
- Missing `standalone: true` — Angular 20+ defaults to standalone.
- `provideZonelessChangeDetection()` flagged as experimental — it is stable in Angular 20.
- For **Repo conventions** findings only: any finding whose `_Source:_` citation cannot be quoted from a loaded rule file / checklist / architecture doc — drop. (General-review findings don't need a source; they just need a concrete failure mode.)

## Scope boundaries — NOT this skill's job

- **PR-shape sanity** (branch name, JIRA, conventional commits, rebase, DCO + GPG, diff size, **protected files touched**) → `/lfx-self-serve-pr-readiness`.
- **Empirical pattern matching** (KB of past-PR review comments) → `/lfx-self-serve-learnings-review`.
