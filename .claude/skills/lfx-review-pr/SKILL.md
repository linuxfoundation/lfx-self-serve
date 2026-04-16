---
name: lfx-review-pr
description: >
  Review a pull request against LFX architecture standards — fetches PR diff,
  verifies previous comments are addressed, validates backend code against
  upstream API contracts, checks code against frontend/backend/shared
  conventions, and posts inline review comments with suggested fixes. Use when
  reviewing PRs, checking PR quality, validating code changes, or when the user
  says "review", "check this PR", "audit code", or mentions /review.
allowed-tools: Bash, Read, Glob, Grep, Agent, AskUserQuestion
---

# LFX PR Review

You are reviewing a pull request against the LFX One architecture standards and project conventions. Walk through each phase in order. Do not skip phases, but some phases may be short-circuited when their preconditions are not met (noted inline).

## Phase 1: Input & Context Gathering

### Parse arguments

The args string follows this format: `<PR number> [extra instructions]`.

- First token is the PR number if numeric.
- Everything after it is extra instructions (e.g., "focus on backend", "check that previous comments were addressed").
- If no PR number is provided, use **AskUserQuestion** to ask for one. Do not guess.

### Determine repository

```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Store the result as `{owner}/{repo}` for all subsequent `gh api` calls.

### Fetch PR metadata (parallel)

Run all of the following Bash calls in a single turn:

```bash
# PR details
gh pr view <N> --json title,body,headRefName,baseRefName,author,files,additions,deletions,state,number

# Full diff
gh pr diff <N>

# Inline review comments (previous reviews)
gh api repos/{owner}/{repo}/pulls/{N}/comments --paginate

# Review summaries (previous reviews)
gh api repos/{owner}/{repo}/pulls/{N}/reviews --paginate

# Fetch the PR branch
git fetch origin <headRefName>
```

If the diff is too large to hold in context, save it to `/tmp/pr-<N>.diff` and read only the key sections (changed `.ts`, `.html`, `.scss` files) with `Read`.

### Read architecture docs (parallel)

Read all of the following in a single turn:

- `docs/architecture/frontend/angular-patterns.md`
- `docs/architecture/frontend/component-architecture.md`
- `docs/architecture/frontend/styling-system.md`
- `docs/architecture/frontend/drawer-pattern.md`
- `docs/architecture/backend/README.md`
- `docs/architecture/backend/error-handling-architecture.md`
- `docs/architecture/backend/logging-monitoring.md`

And these rules files:

- `.claude/rules/component-organization.md`
- `.claude/rules/logging-patterns.md`

These form your review baseline. Every finding must trace back to a documented rule or architecture decision.

---

## Phase 2: Launch Code Enforcer (background)

Spawn a **code-standards-enforcer** Agent subagent with `run_in_background: true`. Do **not** wait for it to finish — proceed to Phase 3 immediately.

Construct the Agent prompt as follows:

> You are a code-standards enforcer for the LFX One codebase. Your job is to read every changed file on the PR branch and flag violations of project conventions.
>
> **Branch:** `origin/<headRefName>`
> **Changed files:** (include the full list from Phase 1)
>
> For each file, read it with `git show origin/<branch>:<path>` and check against:
>
> - `.claude/rules/component-organization.md` — signal ordering, class structure, model signals
> - `.claude/rules/logging-patterns.md` — logger usage, log levels, controller vs service patterns
> - `.claude/rules/development-rules.md` — license headers, no nested ternaries, flex+gap not space-y, data-testid
> - `CLAUDE.md` — all project conventions
>
> For any backend files under `apps/lfx-one/src/server/` that call upstream microservices, validate against the upstream API contract:
>
> ```bash
> gh api repos/linuxfoundation/<repo>/contents/gen/http/openapi3.yaml --jq '.content' | base64 -d
> ```
>
> Return findings as a JSON array: `[{ "file": "...", "line": N, "severity": "CRITICAL|SHOULD_FIX|NIT", "rule": "...", "message": "...", "suggestion": "..." }]`
>
> **Do NOT flag:**
>
> - Missing `ChangeDetectionStrategy.OnPush` (not required — app uses zoneless change detection)
> - Missing `standalone: true` (Angular 20+ defaults to standalone)

---

## Phase 3: Verify Previous Review Comments

This phase checks whether previously raised review comments were actually addressed in code. **Do NOT trust "resolved" status or contributor claims. Read the actual code.**

### Process

1. Gather all inline comments and review bodies from Phase 1.
2. Skip trivial comments: nits, acknowledgments, "+1", bot auto-comments, and purely informational remarks.
3. For every **CRITICAL** or **SHOULD FIX** comment:
   a. Read the file on the PR branch: `git show origin/<headRefName>:<file>`
   b. Compare the current code against what the comment requested.
   c. Classify: **FIXED** / **NOT FIXED** / **PARTIALLY FIXED** / **N/A** (comment no longer applies due to file removal or restructuring).
4. Build a markdown table:

```markdown
| #   | Comment Summary                            | File                             | Status    | Evidence                          |
| --- | ------------------------------------------ | -------------------------------- | --------- | --------------------------------- |
| 1   | Use logger.warning instead of console.warn | src/server/services/foo.ts       | FIXED     | Line 42 now uses logger.warning() |
| 2   | Missing license header                     | src/app/shared/pipes/bar.pipe.ts | NOT FIXED | File still has no header          |
```

If there are no previous review comments, note "No previous review comments found" and move on.

---

## Phase 4: Upstream API Contract Validation

**Skip this phase entirely if no files under `apps/lfx-one/src/server/` were changed.**

### Identify upstream calls

For each changed backend service or controller that makes proxy calls to upstream microservices, identify which service is being called using this map:

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

1. **Endpoint path** — the path exists in the OpenAPI spec.
2. **HTTP method** — GET/POST/PUT/DELETE matches.
3. **Request body and query params** — field names and types match the spec schema.
4. **Response shape** — matches the TypeScript interface used in the service/controller.
5. **Query Service pagination** — uses `page_size` (NOT `limit`) and `page_token` for cursor pagination.

### Snowflake queries

For Snowflake queries (direct SQL, not proxy calls): verify that every `?` placeholder in the SQL string has a corresponding value in the binds array, in the correct order.

### On failure

If `gh api` fails (404, auth error, network issue), log the failure and include a **WARNING** in the review: "Upstream API contract for {service} could not be verified. Manual validation required."

---

## Phase 5: Compile Context for `/review`

Wait for the code-standards-enforcer Agent from Phase 2 to complete. Then compile all findings from Phases 1–4 and the enforcer into a structured context block that will be passed to `/review`.

### Build the context block

Assemble a single text block containing:

1. **Previous comment verification** — the Phase 3 table (or "No previous review comments found")
2. **Upstream API validation** — Phase 4 results (or "No backend changes — skipped")
3. **Code enforcer findings** — the enforcer's results, filtered through the false positive filter below
4. **Domain checklists to apply** — instruct the reviewer to read and check against:
   - Frontend files → `references/frontend-checklist.md`
   - Backend files → `references/backend-checklist.md`
   - Shared files → `references/shared-and-sql-checklist.md`
5. **Extra user instructions** — any additional instructions from the args (e.g., "focus on backend")

### Apply false positive filter

Before passing any finding to `/review`, verify it is NOT one of these known false positives:

- **Missing `ChangeDetectionStrategy.OnPush`** — not required. The app uses stable zoneless change detection.
- **Missing `standalone: true`** — not required. Angular 20+ defaults to standalone.
- **Suggesting test plans in the PR** — the user's global config explicitly disables this.
- **Code-enforcer hallucinated rules** — cross-check every enforcer finding against the actual documented rules before including it. If you cannot find the rule in the architecture docs or rules files, drop the finding.

---

## Phase 6: Invoke `/review`

Now hand off to the built-in `/review` command. This gives the review Claude's built-in PR review capabilities while ensuring it has the full LFX-specific context from Phases 1–5.

### Invoke the skill

Use the **Skill** tool to invoke `review` (the built-in `/review` command). Pass the PR number and the compiled context block as args:

```text
<PR number> -- <compiled context from Phase 5>
```

The args should include:

- The PR number
- The compiled context block (previous comment verification, upstream validation, enforcer findings, checklist references, extra instructions)
- A reminder to run the code-standards-enforcer agent as part of the review
- A note about new contributor status if applicable (see Additional Rules below)

The `/review` command will handle the actual code review, inline comment posting, and summary output. The context you pass ensures it reviews against LFX-specific standards rather than generic best practices.

---

## Additional Rules

### PR size check

If the PR's `additions` exceed 1000 lines, include a note in the review body:

> **Note:** This PR has {additions} additions, which exceeds the recommended 1000-line target per `commit-workflow.md`. Consider splitting into smaller, independently reviewable PRs.

### New contributor awareness

Check the PR author's merge history:

```bash
gh pr list --author <author> --state merged --limit 5 --json number | jq 'length'
```

If the author has fewer than 5 merged PRs to this repo, be more thorough and educational in inline comments — explain the "why" behind each rule, not just the "what".

### Extra instructions

If the user passed extra instructions after the PR number (e.g., "focus on backend changes", "check that previous comments were addressed"), prioritize those areas but still execute the full review pipeline. Note in the terminal summary that extra focus was applied.
