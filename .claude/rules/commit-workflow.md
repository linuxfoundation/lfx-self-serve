---
description: Commit conventions, branch naming, PR format, PR size guidelines, and JIRA tracking workflow
globs: '*'
---

# Commit & PR Workflow

## Commit Conventions

- Follow Angular commit conventions: `type(scope): description`
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert` — `chore` is **not** accepted (commitlint uses `@commitlint/config-angular`; use the closest specific type instead: `build` for deps/tooling, `ci` for pipelines, `refactor` for cleanup, `docs` for doc-only changes)
- Scope should be lowercase and describe the affected area (e.g., `auth`, `ui`, `api`, `docs`) following Angular scope conventions
- Use present tense, imperative mood: "add feature" not "added feature"
- Examples:
  - `feat(auth): add OAuth2 integration`
  - `fix(ui): resolve mobile button alignment`

## Branch Naming

- Branch names follow commit types followed by the JIRA ticket number
- Format: `feat/LFXV2-123` or `ci/LFXV2-456`

## PR Titles

- PR titles must follow conventional commit format: `type(scope): description`
- The scope follows the Angular config for conventional commits
- Do not include the JIRA ticket in the title
- Everything should be in lowercase

## PR Size & Focus

- **Target under 1000 lines of diff** — one feature, one bug fix, or one refactor per PR
- **Don't bundle unrelated changes** — keeps reviews focused and rollbacks clean
- PR sizing should be planned upfront during development — see the `/develop` skill's "Scope for PR Size" section for detailed guidance on splitting work

## External References

When a PR depends on or relates to work in other repos (e.g., upstream microservice changes), include links in the PR description so reviewers have full context:

- **Upstream API changes** — link to the PR or commit in the microservice repo that adds/modifies the endpoint this PR consumes
- **Related PRs in other repos** — link any PRs that were part of the same feature effort (e.g., a committee-service PR that this frontend PR builds on)
- **Deployed dependencies** — if the PR requires an upstream change to be deployed first, call that out explicitly so reviewers and mergers know the ordering

## JIRA Tracking

Before starting any work or commits:

1. **Check if there is a JIRA ticket** — always track work. Do not use discarded or resolved tickets.
2. **Create JIRA ticket if needed** for untracked work
3. **Include JIRA ticket in commit message** (e.g., `LFXV2-XXX`)
4. **Link PR to JIRA ticket** when creating pull requests
