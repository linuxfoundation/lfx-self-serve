---
description: Guides Claude to suggest the right skill based on user intent
paths:
  - '*'
---

# Available Skills & Reviewer Children

This project has guided skills for common workflows, plus two repo-owned Self Serve review skills — `lfx-self-serve-code-review` and `lfx-self-serve-learnings-review`, under `.claude/skills/` — that the work cycle has generic background subagents load after every pre-PR commit. **Proactively suggest the relevant one** when a user's request matches.

## Skills

| Skill                          | When to Suggest                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/setup`                       | Getting started, first-time setup, broken environments, install failures, missing env vars, 1Password, how to run the app                                            |
| `/self-serve-dev`              | Add a feature, fix a bug, modify code, create components/services/endpoints/types, refactor, build, implement any code change                                        |
| `/lfx-self-serve-pr-readiness` | Before opening a PR — PR-shape sanity (branch, ticket reference [JIRA or GitHub Issue], conventional commits, rebase, DCO + GPG, diff size, protected files touched) |
| `/preflight`                   | Mechanical pre-PR checks — license headers, format, lint, build, protected files, commit signoff                                                                     |
| `/lfx-review-pr`               | Review an **existing** PR by number — audit a PR's diff, validate against standards, draft inline comments                                                           |

## Reviewer Children (skill-loading subagents)

The two Self Serve post-commit review skills are repo-owned (`.claude/skills/lfx-self-serve-code-review/`, `.claude/skills/lfx-self-serve-learnings-review/`); the general review skill ships in the central `lfx-skills` Claude plugin (`lfx-skills:lfx-general-code-review`). The repo-owned skills are the source of truth for this pre-PR cycle; the central `lfx-skills:lfx-self-serve-*-reviewer` agents they were copied from still exist and are what `/lfx-review-pr` launches — an edit to one copy does not propagate to the other. Launch exactly three generic background subagents in one parallel batch via the Agent tool — all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`, each explicitly loading exactly one of the three skills — immediately after each commit **while the branch is pre-PR**, then keep working. If Claude displays the plugin skill without the `lfx-skills:` namespace, use the displayed name. Every running review is drained and addressed at the PR boundary, not the commit boundary (see the work cycle in `CLAUDE.md`).

**Scope: pre-PR only.** Once the PR is open and you're iterating on CodeRabbit / Copilot feedback, do NOT launch the trio on iteration commits — the bots auto-trigger on every push and become the live audit surface from that point. Stacking subagent reviews on top of bot reviews makes the iteration loop too slow without adding signal.

| Skill the child loads                | When to launch (pre-PR only)                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lfx-skills:lfx-general-code-review` | Immediately after every commit — generic senior-reviewer pass (correctness, security, performance, maintainability, tests, code truthfulness). No repo-specific rulebook. Audits the latest commit by default; pass `branch` for the pre-PR full-branch sweep on multi-commit branches.                    |
| `lfx-self-serve-code-review`         | Immediately after every commit — convention audit against the documented rule surface (`.claude/rules/`, the four `docs/reviews/` checklists, architecture docs) and upstream API contracts. Audits the latest commit by default; pass `branch` for the pre-PR full-branch sweep on multi-commit branches. |
| `lfx-self-serve-learnings-review`    | Immediately after every commit — empirical-pattern matching against `docs/reviews/knowledge-base/` (patterns sampled from past PR review comments). Audits the latest commit by default; pass `branch` for the pre-PR full-branch sweep on multi-commit branches.                                          |

Launch all three children in parallel by issuing the Agent tool calls in a single message. The Agent `prompt` parameter is **always required and must match the canonical prompts in `CLAUDE.md`'s work cycle** — they name the single skill the child loads, the target repo, and the immutable pinned range (`target_sha` = `git rev-parse HEAD`; `base_sha` = `git rev-parse HEAD~1` post-commit, or `git merge-base origin/main HEAD` in full-branch mode; plus the exact diff range) so the launcher behaves identically across workflows and all three children audit the same state:

- **Post-commit mode:** ends with `Review the latest commit.` — no `branch` keyword.
- **Full-branch mode:** includes the `branch` keyword and ends with `Review the branch's diff against origin/main.`

Append `extra: <focus>` on a new line only when there's a priority hint to add. Keep working on the next commit while they run. When the trio returns, roll every Critical and reasonable Important finding into the next commit. Drain the queue, run the full-branch sweep on multi-commit branches, then open the PR; after the PR is open, switch to the bot-iteration loop and stop launching the trio.

## Trigger Phrases

**`/setup`** — match any of these intents:

- "How do I set up?", "Getting started", "First time here"
- "yarn install fails", "corepack error", "node version"
- "env vars", "1Password", "app won't start"
- "broken environment", "fresh install", "missing dependencies"

**`/self-serve-dev`** — match any of these intents:

- "Add a feature", "Create a component", "Build an endpoint"
- "Fix this bug", "Modify the service", "Update the page"
- "Refactor", "Implement", "Change the behavior"
- "New interface", "Add a filter", "Create a form"
- Describes any code change, feature request, or bug fix

**Post-commit reviewer children** — match any of these intents (commit just landed, or work is wrapping up):

- "Just committed", "Review my last commit", "Review the branch"
- "Self-review", "Code-convention check", "Check this branch"
- "Validate my diff", "Audit my changes"
- "What would CodeRabbit flag?", "What would Copilot say?", "Post-commit review"
- Any "is this ready" question where no PR number is given

Launch the trio in parallel via the Agent tool — three generic background children (all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`), each loading exactly one of `lfx-skills:lfx-general-code-review`, `lfx-self-serve-code-review`, and `lfx-self-serve-learnings-review`, with the canonical pinned-range prompts from `CLAUDE.md`'s work cycle. The work-cycle gate requires all three after every commit **while the branch is pre-PR**, drained clean before any PR opens. Once a PR is open, the bots are the audit surface — do not launch the trio on iteration commits.

**`/lfx-self-serve-pr-readiness`** — pre-PR, shape focus (run once, before opening the PR). Match any of these intents:

- "PR readiness", "Is this ready to open as a PR?"
- "Check PR shape", "Validate my commits", "Are my commits signed?"
- "Did I forget the JIRA ticket?", "Did I forget the GitHub Issue reference?", "Is my branch named right?"
- "Diff size OK?", "Is my branch rebased?"

**`/preflight`** — mechanical checks; usually after pr-readiness passes. Match any of these intents:

- "Run checks", "Lint and build", "Pre-PR validation"
- "Format check", "License check"
- "Check my code" when the user wants the mechanical pipeline rather than a standards audit

**`/lfx-review-pr`** — match any of these intents (an existing PR with a number):

- "Review this PR", "Check PR quality", "Audit PR #123"
- "Review #123", "Is PR #123 ready to merge?"
- Any mention of reviewing or auditing a pull request by number

## For Cowork Sessions

Non-developer contributors use these skills as guided workflows. Follow these rules:

- If the user describes a feature they want to build, suggest `/self-serve-dev` — it walks them through the full process step-by-step
- If the user asks about setup or getting started, suggest `/setup`
- **After every commit while the branch is pre-PR**, launch the reviewer trio — three generic background children (all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`), each loading exactly one of `lfx-skills:lfx-general-code-review`, `lfx-self-serve-code-review`, and `lfx-self-serve-learnings-review` — in one parallel batch via the Agent tool. Keep working on the next commit while they run. When the trio returns, roll findings into the next commit. **Stop launching the trio once the PR is open** — CodeRabbit + Copilot auto-trigger on every push and own the audit surface from that point.
- **Before opening a PR**, drain the post-commit review queue (wait for every running review, address findings), then run the **full-branch sweep** on multi-commit branches (all three subagents with `branch` in the prompt), then `/lfx-self-serve-pr-readiness`, then `/preflight`.
- **After the PR is open**, address bot feedback iteratively: wait for the bots, triage findings, push a `fix(review): ...` commit, repeat until clean. No reviewer subagent trio on these commits.
- If you are unsure which workflow applies, ask the user what they're trying to accomplish.
- When a skill references architecture docs in `docs/`, read those docs before generating code — they are the source of truth.
