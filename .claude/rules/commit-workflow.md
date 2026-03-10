---
description: Commit conventions, branch naming, PR format, and JIRA tracking workflow
globs: '*'
---

# Commit & PR Workflow

## Commit Conventions

- Follow Angular commit conventions: `type(scope): description`
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
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

## JIRA Tracking

Before starting any work or commits:

1. **Check if there is a JIRA ticket** — always track work. Do not use discarded or resolved tickets.
2. **Create JIRA ticket if needed** for untracked work
3. **Include JIRA ticket in commit message** (e.g., `LFXV2-XXX`)
4. **Link PR to JIRA ticket** when creating pull requests
