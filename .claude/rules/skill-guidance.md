---
description: Guides Claude to suggest the right skill based on user intent
paths:
  - '*'
---

# Available Skills & Reviewer Children

This project has guided skills for common workflows, plus one repo-owned Self Serve review skill under `.claude/skills/`. **Proactively suggest the relevant one** when a user's request matches.

## Skills

| Skill                          | When to Suggest                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/setup`                       | Getting started, first-time setup, broken environments, install failures, missing env vars, 1Password, how to run the app                                    |
| `/self-serve-dev`              | Add a feature, fix a bug, modify code, create components/services/endpoints/types, refactor, build, implement any code change                                |
| `/lfx-self-serve-pr-readiness` | Before opening a PR — PR-shape sanity (branch, ticket reference [GitHub Issue], conventional commits, rebase, DCO + GPG, diff size, protected files touched) |
| `/preflight`                   | Mechanical pre-PR checks — license headers, format, lint, build, protected files, commit signoff                                                             |
| `/lfx-review-pr`               | Review an **existing** PR by number — audit a PR's diff, validate against standards, draft inline comments                                                   |

## Reviewer Children (skill-loading subagents)

The local review lifecycle lives in `/lfx-skills:lfx-pre-pr-review`; `CLAUDE.md`'s **Pre-PR review** section points at it and carries this repo's two values (the KB review skill, `/lfx-self-serve-learnings-review`, and the preflight command). Do not restate or improvise that protocol here.

**Guidance requirement:** when a pre-PR review intent matches, follow `CLAUDE.md`'s **Pre-PR review** section exactly. Once a PR is open, follow `CLAUDE.md`'s **Post-PR review** section instead of launching any local reviewer.

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

**Pre-PR reviewer children** — match any of these intents (the branch is complete and no PR exists yet):

- "Review the branch", "Review my changes before the PR"
- "Self-review", "Code-convention check", "Check this branch"
- "Validate my diff", "Audit my changes"
- "What would CodeRabbit flag?", "What would Copilot say?"
- Any "is this ready" question where no PR number is given

Follow `CLAUDE.md`'s **Pre-PR review** section exactly. If the user asks to review a single commit mid-branch, explain that this repo reviews the whole branch once, before the PR.

**`/lfx-self-serve-pr-readiness`** — pre-PR, shape focus (run once, before opening the PR). Match any of these intents:

- "PR readiness", "Is this ready to open as a PR?"
- "Check PR shape", "Validate my commits", "Are my commits signed?"
- "Did I forget the GitHub Issue reference?", "Is my branch named right?"
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
- For pre-PR and post-PR review behavior, follow `CLAUDE.md`'s **Pre-PR review** and **Post-PR review** sections exactly; do not reconstruct the protocol from this routing file.
- If you are unsure which workflow applies, ask the user what they're trying to accomplish.
- When a skill references architecture docs in `docs/`, read those docs before generating code — they are the source of truth.
