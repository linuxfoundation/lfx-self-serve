---
type: Runbook
title: Commit Workflow
description: DCO sign-off, GPG signing, Angular conventional commits, and pre-commit hook sequence.
resource: .claude/rules/commit-workflow.md
tags: [git, dco, gpg]
---

## Overview

This runbook covers the required workflow for staging, signing, and committing code changes in the LFX One repository. All commits must follow Angular conventional commit format and include both DCO sign-off and GPG signatures. Pre-commit hooks enforce license headers, formatting, and linting.

## Prerequisites

Configure GPG signing once (one-time setup):

```bash
# Find your GPG key ID
gpg --list-keys

# Configure Git to use your key
git config --global user.signingkey <KEY_ID>
git config --global commit.gpgsign true
```

Register your public GPG key with GitHub via [github.com/settings/keys](https://github.com/settings/keys) so commits show as **Verified** after push.

## Conventional Commit Format

All commit messages must follow Angular conventions:

```text
<type>(<scope>): <description>

<body>

Refs: LFXV2-123  # if applicable
```

### Commit Types (Required)

Valid types (commitlint enforces):

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation-only changes
- `style` — code style (formatting, semicolons, no behavior change)
- `refactor` — code reorganization without feature/fix
- `perf` — performance improvement
- `test` — test-only changes
- `build` — tooling, dependencies, build system
- `ci` — CI/CD pipelines
- `revert` — revert a prior commit

**NOT allowed:** `chore` (use the specific type instead: `build` for deps, `ci` for pipelines, `refactor` for cleanup)

### Scope (Lowercase)

Describes the area affected, following Angular conventions. Examples: `auth`, `ui`, `api`, `docs`, `okf`.

### Description

- Present tense, imperative mood: "add feature" not "added feature"
- Lowercase (first letter)
- No period at the end
- ≤72 characters (guideline); hard limit is 100 characters

### Examples

```text
feat(meetings): add calendar sync integration
fix(auth): resolve token expiration on page reload
docs(okf): update knowledge graph index
refactor(ui): simplify button component state
```

## Commit Signing (Both Required)

Every commit requires **both** DCO sign-off and GPG signature:

```bash
git commit --signoff -S -m "type(scope): description"
```

### DCO Sign-Off (`--signoff`)

- Adds `Signed-off-by: Your Name <your@email.com>` trailer
- Required by repo DCO policy (Probot check in CI)
- Certifies you wrote or have the right to contribute the code
- Validated by `commitlint`

### GPG Signature (`-S`)

- Adds cryptographic signature to the commit
- Required by repo policy
- If `commit.gpgsign = true` is set globally, `-S` is optional but explicit is better

## Pre-Commit Hook Sequence

When you run `git commit`, pre-commit hooks execute in order:

1. **License header check** — `./check-headers.sh` validates MIT headers on all source files
2. **Lint-staged** — runs prettier + ESLint on staged files only
3. **Repository-wide checks** (if any staged changes touch these):
   - `yarn format:check` — Prettier formatting across the repo
   - `yarn lint:check` — ESLint linting across the repo
   - `yarn check-types` — TypeScript type-checking across the repo

If any hook fails, the commit is aborted. Fix the reported issue (usually auto-fixable by running `yarn format` and `yarn lint`) and retry the commit. No `--no-verify` or `--no-gpg-sign` overrides — these are mandatory checks.

## License Headers

Every source file (TypeScript, Angular components, server files) must include the MIT license header:

```typescript
/**
 * Copyright The Linux Foundation and each contributor to LFX.
 * SPDX-License-Identifier: MIT
 */
```

If a file is missing the header, `check-headers.sh` will fail the commit. Run it manually to check:

```bash
./check-headers.sh
```

## Steps to Commit

1. **Stage changes** (specific files, not `git add .`):

   ```bash
   git add apps/lfx-one/src/app/my-component.ts
   git add packages/shared/src/interfaces/my-interface.ts
   ```

2. **Check status** to verify what's staged:

   ```bash
   git status
   ```

3. **Run linting and formatting** (optional; pre-commit will catch issues):

   ```bash
   yarn lint
   yarn format
   ```

4. **Commit with sign-off and signature**:

   ```bash
   git commit --signoff -S -m "feat(component): add new feature

   Description of the change and why it was made.

   Refs: LFXV2-123"
   ```

5. **Verify signature** after commit:

   ```bash
   git log --format='%G? %h %s' -1
   ```

   Expected codes:
   - `G` — good signature ✔
   - `U` — good signature, signing key not in local trust db (still OK)
   - `N`, `B`, `E` — investigate; signature is invalid or missing

6. **After push**, verify the GitHub **Verified** badge appears next to your commit

## Undoing and Fixing Commits

### Amend Last Commit (Same Signature)

If you need to adjust the last commit before pushing:

```bash
# Make changes
git add .
git commit --amend --signoff -S
```

### Revert Commits (Creating New Commit)

If changes are already pushed or you want to preserve history:

```bash
git revert <commit-hash>
```

### Skip a Failing Hook (Last Resort)

Only if absolutely necessary (should be rare):

```bash
git commit --no-verify
```

**Never do this in normal workflow.** Fix the underlying issue instead.

## Related Concepts

- [Post-Commit Review](../runbooks/post-commit-review.md) — launching reviewer trio after each commit
- [Local Dev Setup](../runbooks/local-dev-setup.md) — workspace initialization

## Citations

- **Source:** `.claude/rules/commit-workflow.md`, Commit Conventions section
- **Source:** `.claude/rules/commit-workflow.md`, Commit Signing section
- **Source:** `CLAUDE.md`, Git Workflow section (includes license headers policy)
