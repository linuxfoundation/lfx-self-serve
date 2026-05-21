---
description: Guides Claude to suggest the right skill based on user intent
paths:
  - '*'
---

# Available Skills

This project has guided skills for common workflows. **Proactively suggest the relevant one** when a user's request matches.

## Skills

| Skill                              | When to Suggest                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/setup`                           | Getting started, first-time setup, broken environments, install failures, missing env vars, 1Password, how to run the app                                                   |
| `/develop`                         | Add a feature, fix a bug, modify code, create components/services/endpoints/types, refactor, build, implement any code change                                               |
| `/lfx-self-serve-code-review`      | Post-commit code-convention audit (pre-PR only) — invoke after every commit in parallel with `/lfx-self-serve-learnings-review`. Skill body launches a background subagent. |
| `/lfx-self-serve-learnings-review` | Post-commit rubric review (pre-PR only) — invoke after every commit in parallel with `/lfx-self-serve-code-review`. Skill body launches a background subagent.              |
| `/lfx-self-serve-pr-readiness`     | Before opening a PR — PR-shape sanity (branch, JIRA, conventional commits, rebase, DCO + GPG, diff size, protected files touched)                                           |
| `/preflight`                       | Mechanical pre-PR checks — license headers, format, lint, build, protected files, commit signoff                                                                            |
| `/lfx-review-pr`                   | Review an **existing** PR by number — audit a PR's diff, validate against standards, draft inline comments                                                                  |

## Post-commit review skills (launch background subagents)

The two post-commit reviews are **skills with launcher bodies**: each skill body instructs Claude to spawn a background subagent (`run_in_background: true`) with the full review playbook inlined. Code-review uses the built-in `code-reviewer` agent (its rule-surface disposition aligns). Learnings-review uses `general-purpose` (no review disposition, so the KB-only gate is uncontested). Invoke them in parallel via the Skill tool immediately after each commit **while the branch is pre-PR**, while you keep working on the next commit. Every running review is drained and addressed at the PR boundary, not the commit boundary (see the work cycle in `CLAUDE.md`).

**Scope: pre-PR only.** Once the PR is open and you're iterating on CodeRabbit / Copilot feedback, do NOT invoke the pair on iteration commits — the bots auto-trigger on every push and become the live audit surface from that point. Stacking skill-launched reviews on top of bot reviews makes the iteration loop too slow without adding signal.

| Skill                              | When to invoke (pre-PR only)                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/lfx-self-serve-code-review`      | Immediately after every commit — general code review on the diff (native disposition, no source citation) + convention audit against the documented rule surface (`.claude/rules/`, `docs/reviews/` checklists, architecture, upstream API contracts) with cross-check discipline. Audits the latest commit by default; pass `branch` for the pre-PR full-branch sweep on multi-commit branches. |
| `/lfx-self-serve-learnings-review` | Immediately after every commit — empirical-pattern matching against `docs/reviews/knowledge-base/` (patterns sampled from past PR review comments). Audits the latest commit by default; pass `branch` for the pre-PR full-branch sweep on multi-commit branches.                                                                                                                                |

Invoke both in parallel by issuing two Skill tool calls in a single message. Each skill body launches its subagent in the background. **When you execute the launcher instruction at the top of each skill body, pass the entire body verbatim as the Agent `prompt` — do not summarize, condense, or pre-route based on the diff** (the playbook owns its own routing; trimming it breaks the cross-check discipline). Append the args (if any) at the end of the prompt. Keep working on the next commit while they run. When the pair returns, roll every Critical and reasonable Important finding into the next commit. Drain the queue, run the full-branch sweep on multi-commit branches, then open the PR; after the PR is open, switch to the bot-iteration loop and stop invoking the pair.

## Trigger Phrases

**`/setup`** — match any of these intents:

- "How do I set up?", "Getting started", "First time here"
- "yarn install fails", "corepack error", "node version"
- "env vars", "1Password", "app won't start"
- "broken environment", "fresh install", "missing dependencies"

**`/develop`** — match any of these intents:

- "Add a feature", "Create a component", "Build an endpoint"
- "Fix this bug", "Modify the service", "Update the page"
- "Refactor", "Implement", "Change the behavior"
- "New interface", "Add a filter", "Create a form"
- Describes any code change, feature request, or bug fix

**Post-commit review skills** — match any of these intents (commit just landed, or work is wrapping up):

- "Just committed", "Review my last commit", "Review the branch"
- "Self-review", "Code-convention check", "Check this branch"
- "Validate my diff", "Audit my changes"
- "What would CodeRabbit flag?", "What would Copilot say?", "Post-commit review"
- Any "is this ready" question where no PR number is given

Invoke **both** `/lfx-self-serve-code-review` AND `/lfx-self-serve-learnings-review` in parallel via the Skill tool — each skill body launches a background subagent. They are the post-commit pair and the work-cycle gate requires both after every commit **while the branch is pre-PR**, drained clean before any PR opens. Once a PR is open, the bots are the audit surface — do not invoke the pair on iteration commits.

**`/lfx-self-serve-pr-readiness`** — pre-PR, shape focus (run once, before opening the PR). Match any of these intents:

- "PR readiness", "Is this ready to open as a PR?"
- "Check PR shape", "Validate my commits", "Are my commits signed?"
- "Did I forget the JIRA ticket?", "Is my branch named right?"
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

- If the user describes a feature they want to build, suggest `/develop` — it walks them through the full process step-by-step
- If the user asks about setup or getting started, suggest `/setup`
- **After every commit while the branch is pre-PR**, invoke the two post-commit review skills (`/lfx-self-serve-code-review` + `/lfx-self-serve-learnings-review`) in parallel via the Skill tool — each skill body launches a background subagent. Keep working on the next commit while they run. When the pair returns, roll findings into the next commit. **Stop invoking the pair once the PR is open** — CodeRabbit + Copilot auto-trigger on every push and own the audit surface from that point.
- **Before opening a PR**, drain the post-commit review queue (wait for every running review, address findings), then run the **full-branch sweep** on multi-commit branches (both skills with `"branch"`), then `/lfx-self-serve-pr-readiness`, then `/preflight`.
- **After the PR is open**, address bot feedback iteratively: wait for the bots, triage findings, push a `fix(review): ...` commit, repeat until clean. No review skill pair on these commits.
- If you are unsure which workflow applies, ask the user what they're trying to accomplish.
- When a skill references architecture docs in `docs/`, read those docs before generating code — they are the source of truth.
