---
name: lfx-review-pr
description: >
  Review a pull request against LFX architecture standards — fetches PR diff,
  verifies previous comments are addressed, validates PR metadata (title,
  branch, JIRA, size), validates backend code against upstream API contracts,
  runs a code-standards enforcer against every file in `.claude/rules/` and
  `.claude/hooks/guard-protected-files.sh`, and drafts inline review comments
  with suggested fixes. NEVER auto-posts comments or submits reviews — always
  presents a draft in the terminal for user approval before any comment lands
  on the PR. Use when reviewing PRs, checking PR quality, validating code
  changes, or when the user says "review", "check this PR", "audit code", or
  mentions /review.
allowed-tools: Bash, Read, Glob, Grep, Agent, AskUserQuestion, Skill
---

# LFX PR Review

You are reviewing a pull request against the LFX One architecture standards and project conventions. Walk through each phase in order. Phases may short-circuit when their preconditions are not met (noted inline), but none should be skipped outright.

The review is backed by four living sources of truth — always pull the current contents rather than trusting anything mirrored in this skill:

- `.claude/rules/*.md` — all project rules
- `.claude/hooks/guard-protected-files.sh` — the authoritative protected-files list
- `CLAUDE.md` — project conventions and Development Memories
- `docs/architecture/**` — architecture decisions, loaded contextually

---

## Phase 1: Input & Context Gathering

### Parse arguments

The args string follows this format: `<PR number> [extra instructions]`.

- First token is the PR number if numeric.
- Everything after it is extra instructions (e.g. "focus on backend", "check that previous comments were addressed").
- If no PR number is provided, use **AskUserQuestion** to ask for one. Do not guess.

### Determine repository

```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Store the result as `{owner}/{repo}` for all subsequent `gh api` calls.

### Fetch PR metadata (parallel)

Run all of the following Bash calls in a single turn:

```bash
# PR details (title, body, branch, author, file list, size, state)
gh pr view <N> --json title,body,headRefName,baseRefName,author,files,additions,deletions,state,number

# Full diff
gh pr diff <N>

# Inline review comments (previous reviews)
gh api repos/{owner}/{repo}/pulls/{N}/comments --paginate

# Review summaries (previous reviews)
gh api repos/{owner}/{repo}/pulls/{N}/reviews --paginate

# Commit messages on the PR (used in Phase 4 for JIRA/conventional-commit checks)
gh api repos/{owner}/{repo}/pulls/{N}/commits --paginate --jq '.[].commit.message'

# Fetch both base and head branches so Phase 4's merge-base check uses fresh refs
git fetch origin <baseRefName> <headRefName>
```

If the diff is too large to hold in context, save it to `/tmp/pr-<N>.diff` and read only the changed `.ts`, `.html`, `.scss`, `.md`, `.sql` files with `Read`.

### Load all project rules (dynamic — do not hardcode)

Glob `.claude/rules/*.md` and read every rule file. New rule files added in the future must be picked up automatically; never maintain a hand-kept list here. At time of writing this typically includes:

- `component-organization.md` — signal ordering, class structure, `model()` for two-way binding, interfaces in shared package
- `logging-patterns.md` — logger service API, controller vs service log levels, bare `next(error)` in catch blocks, `err` field for errors
- `development-rules.md` — shared package, user-token vs M2M, code quality (license headers, no nested ternaries, flex+gap over space-y, `data-testid`), testing, documentation maintenance, JIRA
- `commit-workflow.md` — PR title format, branch naming, PR size, external references, JIRA tracking
- `skill-guidance.md` — not directly relevant to review, but read so you don't accidentally contradict it

### Load the protected-files hook

Read `.claude/hooks/guard-protected-files.sh`. Parse its `case` statements and `if` conditions to build the authoritative list of protected paths. This list is used in Phase 6 to flag changes to core infrastructure. **Never mirror it by hand** — parse the hook so the list cannot drift.

### Load architecture docs (contextual routing)

Inspect the changed-file list and load only the relevant architecture docs. Load the chosen set in a single parallel Read call.

**Baseline (always):**

- `CLAUDE.md`

**Frontend changes (files under `apps/lfx-one/src/app/`):**

- `docs/architecture/frontend/angular-patterns.md`
- `docs/architecture/frontend/component-architecture.md`
- `docs/architecture/frontend/styling-system.md`
- If a drawer component or `DialogService.open` usage changed → `docs/architecture/frontend/drawer-pattern.md`

**Backend changes (files under `apps/lfx-one/src/server/`):**

- `docs/architecture/backend/README.md`
- `docs/architecture/backend/error-handling-architecture.md`
- `docs/architecture/backend/logging-monitoring.md`
- `docs/architecture/backend/server-helpers.md`

**Conditional backend docs (load only if the relevant area is touched):**

| Changed area                                   | Doc to load                        |
| ---------------------------------------------- | ---------------------------------- |
| Auth / OIDC / `middleware/auth*`               | `backend/authentication.md`        |
| Impersonation helpers (`auth-helper`, persona) | `backend/impersonation.md`         |
| `/public/**` routes, public meetings           | `backend/public-meetings.md`       |
| Pagination helpers, list endpoints             | `backend/pagination.md`            |
| `ai.service.ts`, AI proxy calls                | `backend/ai-service.md`            |
| `nats.service.ts`, project service NATS RPCs   | `backend/nats-integration.md`      |
| `snowflake.service.ts`, direct SQL             | `backend/snowflake-integration.md` |
| SSR / `server.ts` / render pipeline            | `backend/ssr-server.md`            |

**Shared package changes (files under `packages/shared/`):**

- `docs/architecture/shared/package-architecture.md`

**If any E2E test or `*.spec.ts` file changed:**

- `docs/architecture/testing/e2e-testing.md`
- `docs/architecture/testing/testing-best-practices.md`

These rule files + hook + architecture docs form your review baseline. Every finding must trace back to a documented rule, hook, or architecture decision — if you can't quote the source, drop the finding.

---

## Phase 2: Launch Code Enforcer (background)

Spawn a **code-standards-enforcer** Agent subagent with `run_in_background: true`. Do **not** wait for it to finish — proceed to Phase 3 immediately.

Construct the Agent prompt with the full context below. The enforcer runs in parallel while you do Phase 3–5, so giving it a thorough prompt is essentially free in wall-clock time but high-value in coverage.

> You are a code-standards enforcer for the LFX One codebase. Your job is to read every changed file on the PR branch and flag violations of project conventions.
>
> **Branch:** `origin/<headRefName>`
> **Changed files:** (include the full list from Phase 1)
>
> For each file, read it with `git show origin/<headRefName>:<path>` and check against every rule file under `.claude/rules/`. Do not hardcode which rules apply — glob `.claude/rules/*.md` and load them all. At time of writing, the rules to enforce include:
>
> - `component-organization.md` — 11-section component structure (1 injections → 2 inputs → 3 forms → 4 model signals → 5 simple WritableSignals → 6 computed/toSignal via private init → 7 constructor → 8 public → 9 protected → 10 private initializers → 11 other helpers); `model()` for two-way binding; interfaces in shared package
> - `logging-patterns.md` — use `logger` service (never import `serverLogger` directly); controllers use `startOperation`/`success` and bare `next(error)` in catch blocks; services use DEBUG for tracing, INFO for significant operations, WARN for graceful errors; `err` field for errors; snake_case operation names
> - `development-rules.md` — license headers on every `.ts/.html/.scss`; no nested ternaries; `flex + flex-col + gap-*` over `space-y-*`; `data-testid` on interactive elements; user bearer token over M2M with full restore rule; AI service env vars (`AI_PROXY_URL`, `AI_API_KEY`, `M2M_AUTH_CLIENT_ID`, `M2M_AUTH_CLIENT_SECRET`); testing conventions; documentation maintenance rules
> - `commit-workflow.md` — commit messages use conventional-commit format in lowercase
> - `CLAUDE.md` — Development Memories (Angular/PrimeNG versions, zoneless change detection, selective auth pattern, etc.)
>
> Cross-reference these domain checklists and cite them in your findings:
>
> - Frontend files (`apps/lfx-one/src/app/**`) → `.claude/skills/lfx-review-pr/references/frontend-checklist.md`
> - Backend files (`apps/lfx-one/src/server/**`) → `.claude/skills/lfx-review-pr/references/backend-checklist.md`
> - Shared / SQL files (`packages/shared/**`, Snowflake queries) → `.claude/skills/lfx-review-pr/references/shared-and-sql-checklist.md`
> - `docs/**` files → `.claude/skills/lfx-review-pr/references/docs-checklist.md`
>
> **Protected files:** read `.claude/hooks/guard-protected-files.sh` and parse its `case` / `if` patterns. For every changed file that matches any protected pattern, emit a NIT finding with the hook's warning reason attached: "This file is part of core infrastructure — requires extra review scrutiny."
>
> **Upstream API contract validation (backend only):** for any file under `apps/lfx-one/src/server/` that calls an upstream microservice, validate endpoint paths, HTTP methods, request/response shapes, and query params against the upstream OpenAPI spec:
>
> ```bash
> gh api repos/linuxfoundation/<repo>/contents/gen/http/openapi3.yaml --jq '.content' | base64 -d
> ```
>
> Repo map: `lfx-v2-query-service`, `lfx-v2-project-service`, `lfx-v2-meeting-service`, `lfx-v2-mailing-list-service`, `lfx-v2-committee-service`, `lfx-v2-voting-service`, `lfx-v2-survey-service`. Query Service pagination uses `page_size` (NOT `limit`) and `page_token`.
>
> Return findings as a JSON array:
>
> `[{ "file": "...", "line": N, "severity": "CRITICAL|SHOULD_FIX|NIT", "rule": "<rule-file>:<section>", "message": "...", "suggestion": "..." }]`
>
> **Severity calibration:**
>
> - **CRITICAL** — runtime bugs, security issues, M2M in protected routes, SQL bind mismatches, upstream contract violations that will fail at runtime, `as unknown as` casts, raw `new Error()` / manual `res.status().json()` for errors, bypassed user authorization, missing `getEffectiveEmail(req)`
> - **SHOULD_FIX** — documented style/structure violations (component section order, logger usage, license headers, PrimeNG wrappers, `@if`/`@for` over `*ngIf`/`*ngFor`, `inject()` over constructor DI, `page_size` over `limit`)
> - **NIT** — preferences, minor improvements, file naming, protected-file awareness
>
> **Do NOT flag (known false positives):**
>
> - Missing `ChangeDetectionStrategy.OnPush` — not required; the app uses stable zoneless change detection
> - Missing `standalone: true` — Angular 20+ defaults to standalone
> - `provideZonelessChangeDetection()` as experimental — it is stable in Angular 20
> - Suggesting that the PR add a "Test plan" section — the user's global config explicitly disables this
>
> **Cross-check every finding against the actual rule text before emitting it.** If you cannot quote the rule from one of the loaded rule files, hook, checklist, or architecture doc, drop the finding. Hallucinated rules are worse than missed ones.

---

## Phase 3: Verify Previous Review Comments

Checks whether previously raised review comments were actually addressed in code. **Do NOT trust "resolved" status or contributor claims. Read the actual code.**

### Process

1. Gather all inline comments and review bodies from Phase 1.
2. Skip trivial comments: nits, acknowledgments, "+1", bot auto-comments, and purely informational remarks.
3. For every **CRITICAL** or **SHOULD FIX** comment:
   1. Read the file on the PR branch: `git show origin/<headRefName>:<file>`
   2. Compare the current code against what the comment requested.
   3. Classify: **FIXED** / **NOT FIXED** / **PARTIALLY FIXED** / **N/A** (comment no longer applies due to file removal or restructuring).
4. Build a markdown table:

```markdown
| #   | Comment Summary                            | File                             | Status    | Evidence                          |
| --- | ------------------------------------------ | -------------------------------- | --------- | --------------------------------- |
| 1   | Use logger.warning instead of console.warn | src/server/services/foo.ts       | FIXED     | Line 42 now uses logger.warning() |
| 2   | Missing license header                     | src/app/shared/pipes/bar.pipe.ts | NOT FIXED | File still has no header          |
```

If there are no previous review comments, note "No previous review comments found" and move on.

---

## Phase 4: PR Metadata Validation

Validates PR metadata against `commit-workflow.md` and the project's global conventions. Every check produces a row in the Phase 4 findings table, which is later surfaced in the review body.

### Checks

1. **PR title format** — must match `type(scope): description` (conventional commit), all lowercase, and must NOT include a JIRA ticket number.
   - Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert` — `chore` is **not** accepted by commitlint (`@commitlint/config-angular`); flag it as MUST FIX
   - Example valid: `feat(auth): add oauth2 integration`
   - Example invalid: `Fix: LFXV2-123 fix login bug` (uppercase, JIRA in title)

2. **Branch name format** — must match `<type>/LFXV2-<number>` (e.g. `feat/LFXV2-123`). Non-conforming branches are NIT if the PR is otherwise well-formed.

3. **JIRA ticket reference** — at least one commit message or the PR body should reference a `LFXV2-XXX` ticket. Extract with `grep -oE 'LFXV2-[0-9]+'` over the commit messages fetched in Phase 1 and over the PR body. If none, flag SHOULD FIX.

4. **External repo references** — if the PR touches new or modified upstream proxy calls under `apps/lfx-one/src/server/`, the PR body should link to the corresponding upstream PR / commit in the microservice repo. Flag SHOULD FIX if an upstream endpoint looks new but no external link is given.

5. **No test plans in PR body** — if the PR body contains `## Test plan`, `## Testing`, or `Test plan:` sections, flag as NIT (the project convention is no test plans in PR descriptions).

6. **Branch rebased on main** — check whether the PR branch includes `origin/main`:

   ```bash
   git merge-base --is-ancestor origin/main origin/<headRefName>
   ```

   If the exit code is non-zero, flag SHOULD FIX: the branch needs a rebase.

7. **PR size** — if `additions > 1000`, emit a review-body note per `commit-workflow.md`'s 1000-line target. (Also covered in Additional Rules below.)

Build a findings table like:

```markdown
| Check           | Status | Detail                             |
| --------------- | ------ | ---------------------------------- |
| PR title format | PASS   | `feat(meetings): add rsvp summary` |
| Branch name     | PASS   | `feat/LFXV2-1234`                  |
| JIRA ticket     | PASS   | Found LFXV2-1234 in commits        |
| External refs   | N/A    | No new upstream endpoints          |
| No test plan    | FAIL   | PR body contains `## Test plan`    |
| Branch rebased  | PASS   | origin/main is an ancestor         |
| PR size         | PASS   | 342 additions                      |
```

---

## Phase 5: Upstream API Contract Validation

**Skip this phase entirely if no files under `apps/lfx-one/src/server/` were changed.** (The enforcer in Phase 2 already checks this, but this phase is the explicit human-visible record.)

### Identify upstream calls

For each changed backend service or controller that makes proxy calls, identify the target upstream service:

| Domain        | Repo                        |
| ------------- | --------------------------- |
| Queries       | lfx-v2-query-service        |
| Projects      | lfx-v2-project-service      |
| Meetings      | lfx-v2-meeting-service      |
| Mailing Lists | lfx-v2-mailing-list-service |
| Committees    | lfx-v2-committee-service    |
| Voting        | lfx-v2-voting-service       |
| Surveys       | lfx-v2-survey-service       |

### Fetch and validate

```bash
gh api repos/linuxfoundation/<repo>/contents/gen/http/openapi3.yaml \
  --jq '.content' | base64 -d
```

Check each upstream call against the spec:

1. **Endpoint path** — exists in the OpenAPI spec.
2. **HTTP method** — GET/POST/PUT/DELETE matches.
3. **Request body and query params** — field names and types match the spec schema.
4. **Response shape** — matches the TypeScript interface used in the service/controller.
5. **Query Service pagination** — uses `page_size` (NOT `limit`) and `page_token` for cursor pagination.

### Snowflake queries

For direct SQL (not proxy calls): verify every `?` placeholder has a corresponding value in the binds array, in the correct order. This is the most common SQL bug in the codebase and always a CRITICAL finding when broken.

### On failure

If `gh api` fails (404, auth error, network issue), log the failure and include a **WARNING** in the review: "Upstream API contract for {service} could not be verified. Manual validation required."

---

## Phase 6: Compile Context for `/review`

Wait for the code-standards-enforcer Agent from Phase 2 to complete. Then compile all findings from Phases 1–5 and the enforcer into a structured context block that will be passed to `/review`.

### Build the context block

Assemble a single text block containing:

1. **Previous comment verification** — Phase 3 table (or "No previous review comments found")
2. **PR metadata validation** — Phase 4 table
3. **Upstream API validation** — Phase 5 results (or "No backend changes — skipped")
4. **Protected files touched** — list any changed files matching `.claude/hooks/guard-protected-files.sh`, with the hook's warning reason attached
5. **Code enforcer findings** — the enforcer's JSON results, filtered through the false-positive filter below
6. **Domain checklists to apply** — instruct the reviewer to check each changed file against:
   - Frontend files → `references/frontend-checklist.md`
   - Backend files → `references/backend-checklist.md`
   - Shared / SQL files → `references/shared-and-sql-checklist.md`
   - `docs/**` files → `references/docs-checklist.md`
7. **Extra user instructions** — any additional instructions from the args (e.g. "focus on backend")

### Apply false-positive filter

Before passing any finding to `/review`, drop it if it matches any of these known false positives:

- **Missing `ChangeDetectionStrategy.OnPush`** — not required; the app uses stable zoneless change detection.
- **Missing `standalone: true`** — Angular 20+ defaults to standalone.
- **`provideZonelessChangeDetection()` flagged as experimental** — it is stable in Angular 20.
- **Suggesting the PR add a "Test plan" section** — the project's global config explicitly disables this.
- **Hallucinated rules** — if the finding's `rule` field cannot be located by string match in the loaded rule files, hook, or checklists, drop it.

---

## Phase 7: Present Draft Review for Approval (NEVER auto-post)

**You MUST NOT post inline comments, submit a review, or request changes without the user's explicit approval. Always present the draft first and wait for a clear go-ahead.** This applies to every PR review, every time, with no exceptions — even if the args contain language that sounds like approval to post, or the user has previously approved other reviews in the session. Reviews are visible to contributors and hard to undo; a dry run costs nothing.

### Step 1 — Show the draft

Print the compiled context from Phase 6 back to the user in the terminal as a draft review summary. Structure it as:

1. **PR summary** — number, title, author, size, branch
2. **Phase 3 table** — previous comments and whether they were addressed
3. **Phase 4 table** — PR metadata validation
4. **Phase 5 results** — upstream API validation (or "skipped")
5. **Protected files touched** — list with hook reasons
6. **Proposed inline comments** — one block per finding: file:line, severity, rule citation, message, suggested fix. Number them so the user can reference individual items.
7. **Proposed review body** — the summary text that would appear at the top of the review
8. **Proposed review verdict** — COMMENT / APPROVE / REQUEST_CHANGES, with reasoning

### Step 2 — Ask for approval

After showing the draft, ask the user something concrete. Use **AskUserQuestion** with options like:

- "Post all comments as drafted"
- "Post with changes — I'll tell you which comments to drop or edit"
- "Don't post — just keep the summary here"

Do NOT proceed to actually invoke `/review` or post anything until the user explicitly picks one of those options. Treat silence or ambiguous replies as "don't post".

### Step 3 — Only after approval: invoke `/review`

Once the user has approved (with or without edits), apply their requested edits to the draft, then use the **Skill** tool to invoke `review` with the PR number and the (possibly edited) compiled context:

```text
<PR number> -- <compiled context from Phase 6, with user's edits applied>
```

Include in the args:

- The PR number
- The compiled context block (previous-comment verification, PR metadata, upstream validation, protected-files touched, enforcer findings, checklist references, extra instructions)
- A reminder to use the enforcer findings as the primary finding source
- A note about new contributor status if applicable (see Additional Rules below)

If the user said "don't post", stop here and leave the draft in the terminal for their reference — do not invoke `/review` or any PR-mutating `gh` command.

---

## Additional Rules

### PR size check

If the PR's `additions` exceed 1000 lines, include a note in the review body:

> **Note:** This PR has {additions} additions, which exceeds the recommended 1000-line target per `commit-workflow.md`. Consider splitting into smaller, independently reviewable PRs.

### New contributor awareness

```bash
gh pr list --author <author> --state merged --limit 5 --json number | jq 'length'
```

If the author has fewer than 5 merged PRs to this repo, be more thorough and educational in inline comments — explain the **why** behind each rule, not just the **what**. For first-time contributors especially, cite the exact rule file and section so they can learn the convention rather than just patching the code.

### Extra instructions

If the user passed extra instructions after the PR number (e.g. "focus on backend changes", "check that previous comments were addressed"), prioritize those areas but still execute the full review pipeline. Note in the terminal summary that extra focus was applied.
