---
type: Runbook
title: Post-Commit Review Flow
description: Mandatory reviewer-trio launch after every pre-PR commit, full-branch sweep, and PR-readiness gate.
resource: CLAUDE.md
tags: [review, ci, pr]
---

## Overview

This runbook describes the mandatory post-commit review flow for the LFX One repository. After every commit while a branch is pre-PR (not yet opened as a pull request), three specialized reviewer subagents audit the code in parallel. This ensures quality before the PR boundary and prevents code issues from reaching CodeRabbit + Copilot review.

**Key principle:** Post-commit reviewers run asynchronously — you commit and immediately launch the trio, then keep working on the next commit. You do not wait for reviews to finish.

## The Three Reviewer Subagents

### 1. General Code Reviewer

**What it reviews:** Correctness, security, performance, maintainability, tests, and code truthfulness across any codebase.

**No repo-specific rulebook** — applies universal senior-engineer standards.

**Subagent type:** `lfx-skills:lfx-general-code-reviewer`

### 2. Self Serve Code Reviewer

**What it reviews:** Convention audit against the documented rule surface specific to this repo:

- `.claude/rules/` files (development-rules, commit-workflow, etc.)
- `docs/reviews/` checklists (4 files covering component architecture, API contracts, SSR safety, etc.)
- Architecture docs (`docs/architecture/`)
- Upstream microservice API contracts

**Renders:** Markdown review with sections: Upstream API / data-layer validation, Repo conventions

**Subagent type:** `lfx-skills:lfx-self-serve-code-reviewer`

### 3. Self Serve Learnings Reviewer

**What it reviews:** Empirical-pattern matching against `docs/reviews/knowledge-base/` — patterns extracted from past PR review comments on this repo.

**Renders:** Markdown review with findings gated by KB matches; unsourced findings are dropped.

**Subagent type:** `lfx-skills:lfx-self-serve-learnings-reviewer`

## Post-Commit Mode (After Every Commit, Pre-PR)

### Step 1: Commit Your Work

```bash
git commit --signoff -S -m "type(scope): description"
```

See [Commit Workflow](../runbooks/commit-workflow.md) for detailed commit format.

### Step 2: Immediately Launch All Three Reviewers (In Parallel)

You must launch the trio in a **single message with three Agent tool calls** to ensure they run concurrently:

For each subagent, use these parameters:

- `subagent_type`: the exact subagent name (e.g., `lfx-skills:lfx-general-code-reviewer`)
- `run_in_background: true` — launches asynchronously
- `prompt`: **`target repo: lfx-self-serve\n\nReview the latest commit.`** (canonical string; do NOT deviate)
- `name`: optional but helpful for tracking (e.g., `general-reviewer`)

**Example invocation:**

```text
I just committed feat(meetings): add calendar sync. Launching post-commit reviewers.
```

Then issue three Agent tool calls with `subagent_type`, `run_in_background`, `prompt`, and `name`.

### Step 3: Keep Working

While the reviewers run in the background:

- Start the next commit
- Make additional changes
- Do not wait for any review to finish

Each trio audits exactly one commit, not cumulative. If you commit N+1 before the review for N returns, you'll get separate reports — one trio per commit.

### Step 4: When Reviewers Return (As Notifications)

You'll receive notifications as each review completes. When you read a review report:

1. **Identify the findings** — Critical, Important, and Minor
2. **Address Critical findings** — must fix before opening PR
3. **Address reasonable Important findings** — should fix unless documented as trade-offs
4. **Triage Minor findings** — judgment call; often worth addressing

Roll findings into the **next commit** (separate `fix(review): ...` commit is fine; squashing is optional). Do not squash away review iteration.

## Pre-PR Gate (Before Opening the PR)

When work is "done" (no more code commits planned), follow this sequence:

### 1. Drain the Review Queue

Wait for every running review trio to complete and return. If any returned Critical or reasonable Important findings, add a fix commit and relaunch the trio on the new state. Loop until clean.

### 2. Full-Branch Sweep (Multi-Commit Branches Only)

If your branch has more than one commit, launch the reviewer trio again with the `branch` keyword to audit cumulative drift:

**Prompt for all three subagents (exact):**

```text
target repo: lfx-self-serve

branch

Review the branch's diff against origin/main.
```

This audits the entire branch's diff against `origin/main` to catch cross-commit issues that per-commit reviews might miss. Single-commit branches skip this step (already covered by post-commit reviews).

Wait for the sweep to return; address any findings, then re-run the sweep until clean.

### 3. Run PR-Readiness Gate

```bash
/lfx-self-serve-pr-readiness
```

This checks PR-shape sanity:

- Branch name format (follows type/LFXV2-### pattern)
- JIRA ticket present
- Conventional commits (all commits follow format)
- Rebase status (branch is up-to-date with origin/main)
- DCO + GPG signing (all commits signed)
- Diff size (ideally under 1000 lines)

Address every **CRITICAL** finding. Address or document (with trade-off) every **SHOULD_FIX** finding. Rerun until verdict is `READY` or `READY WITH CHANGES` with explicit trade-offs.

### 4. Run Preflight Check

```bash
/preflight
```

Mechanical pre-PR checks:

- License headers (MIT on all source files)
- Format (Prettier)
- Lint (ESLint)
- Build (TypeScript + Turborepo)
- Protected files (you didn't touch `CLAUDE.md`, `.claude/rules/*`, etc. without code-owner approval)
- Commit signoff status

All must pass before pushing.

### 5. Push and Open PR

```bash
git push origin <branch>
gh pr create --title "..." --body "..."
```

Only after all above gates pass.

## Post-PR Iteration (Do NOT Launch Trio)

Once the PR is open, **stop launching the reviewer trio.** CodeRabbit + Copilot auto-trigger on every push and become the live audit surface. Stacking trio audits on top of bot audits makes iteration too slow without proportional benefit.

Instead, when you push iteration commits:

1. Wait for CodeRabbit + Copilot comments
2. Triage findings (verify each against current code)
3. Roll fixes into a single `fix(review): ...` commit
4. Push and repeat until clean

## Related Concepts

- [Commit Workflow](../runbooks/commit-workflow.md) — signing and format conventions
- [Local Dev Setup](../runbooks/local-dev-setup.md) — development environment

## Citations

- **Source:** `CLAUDE.md`, Work cycle section — post-commit and pre-PR reviews (lines 226–272)
- **Source:** `CLAUDE.md`, Post-commit mode prompt definition (line 242)
- **Source:** `CLAUDE.md`, Full-branch sweep description (lines 254–259)
