---
name: preflight
description: >
  Pre-PR validation — license headers, format, lint, build, and protected file
  check. Use before submitting any PR, to check if code is ready, validate
  changes, or verify a branch before review.
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# Pre-Submission Preflight Check

You are running a comprehensive validation before the contributor submits a pull request.
Run each check in order, report results clearly, and help fix any issues found.

## Check 0: Working Tree Status

Before running any validation, check the state of the working tree:

```bash
git status
git diff --stat origin/main...HEAD
git log --format="%h %s%n%b" origin/main...HEAD
```

**Evaluate:**

- **Uncommitted changes?** — Ask the contributor: commit now or stash?
- **No commits ahead of main?** — The branch has nothing to validate. Ask if they're on the right branch.
- **Commit messages missing JIRA ticket?** — Flag commits that don't include `LFXV2-` references in subject or body.
- **Commits missing `--signoff`?** — Flag any commits without `Signed-off-by:` lines (visible in the full commit body above).

Resolve any issues before proceeding to the checks below.

## Check 1: License Headers

```bash
./check-headers.sh
```

Every source file (`.ts`, `.html`, `.scss`) must have the license header:

- TypeScript/SCSS: `// Copyright The Linux Foundation and each contributor to LFX.` + `// SPDX-License-Identifier: MIT`
- HTML: `<!-- Copyright The Linux Foundation and each contributor to LFX. -->` + `<!-- SPDX-License-Identifier: MIT -->`

If any files are missing headers, add them.

## Check 2: Formatting

```bash
yarn format
```

This applies Prettier formatting with Tailwind class sorting. It modifies files in place.

> **Why format before lint:** Prettier auto-fixes whitespace, import ordering, and line-length issues that would otherwise appear as lint errors. Running format first eliminates noise from the lint step.

## Check 3: Linting

```bash
yarn lint
```

If there are lint errors, fix them. Common issues:

- Missing imports
- Unused variables
- Component selector prefix (must be `lfx-`)
- Import ordering

### Re-validation

If any fixes were applied in Checks 1-3, re-run lint to confirm the fixes are clean:

```bash
yarn lint
```

If lint still fails, fix and repeat until clean.

## Check 4: Build Verification

```bash
yarn build
```

The build must succeed. If it fails:

- Check for TypeScript errors (missing types, wrong imports)
- Verify shared package exports are correct
- Check for circular dependencies

## Check 5: Protected Files Check

Verify no protected infrastructure files were modified:

```bash
git diff --name-only origin/main...HEAD
```

**Flag any changes to these files** — they should NOT be modified without code owner approval:

- `apps/lfx-one/src/server/server.ts`
- `apps/lfx-one/src/server/server-logger.ts`
- `apps/lfx-one/src/server/middleware/*`
- `apps/lfx-one/src/server/services/logger.service.ts`
- `apps/lfx-one/src/server/services/microservice-proxy.service.ts`
- `apps/lfx-one/src/server/services/nats.service.ts`
- `apps/lfx-one/src/server/services/snowflake.service.ts`
- `apps/lfx-one/src/server/services/supabase.service.ts`
- `apps/lfx-one/src/server/services/ai.service.ts`
- `apps/lfx-one/src/server/services/project.service.ts`
- `apps/lfx-one/src/server/services/etag.service.ts`
- `apps/lfx-one/src/server/helpers/error-serializer.ts`
- `apps/lfx-one/src/app/app.routes.ts`
- `.husky/*`
- `eslint.config.*`
- `.prettierrc*`
- `turbo.json`
- `angular.json`
- `CLAUDE.md`
- `check-headers.sh`
- `package.json` / `*/package.json`
- `yarn.lock`

If protected files appear in the diff, warn the contributor and ask them to revert those changes or get code owner approval.

## Check 6: Commit Verification

Before the final report, verify all changes are properly committed:

```bash
git status
git log --format="%h %s%n%b" origin/main...HEAD
```

- **All changes committed?** — If not, remind the contributor to commit remaining changes.
- **Commit messages follow conventions?** — `type(scope): description` format per `commit-workflow.md`.
- **`--signoff` on all commits?** — Every commit must have `Signed-off-by:` (check in the full body output above).
- **JIRA ticket referenced?** — Commit messages should include `LFXV2-` references.

## Check 7: Change Summary

Generate a summary of all changes for the PR description:

```bash
git diff --stat origin/main...HEAD
```

List:

1. **New files created** — with their purpose
2. **Modified files** — with what changed
3. **Shared package changes** — any new interfaces/enums/constants
4. **Backend changes** — any new controllers/services/routes
5. **Frontend changes** — any new components/services

## Results Report

Present a clear report:

```text
PREFLIGHT RESULTS
─────────────────────────────────
✓ Working tree        — Clean, N commits ahead of main
✓ License headers     — All files have headers
✓ Formatting          — Applied
✓ Linting             — No errors
✓ Build               — Succeeded
✓ Protected files     — None modified
✓ Commits             — Conventions followed, signed off
─────────────────────────────────
READY FOR PR
```

Or if there are issues:

```text
PREFLIGHT RESULTS
─────────────────────────────────
✓ Working tree        — Clean, N commits ahead of main
✓ License headers     — All files have headers
✓ Formatting          — Applied
✗ Linting             — 3 errors (see above)
✗ Build               — Failed (see above)
✓ Protected files     — None modified
✓ Commits             — Conventions followed, signed off
─────────────────────────────────
ISSUES FOUND — Fix before submitting
```

### If All Checks Pass

Suggest creating the PR:

> "All preflight checks passed! Ready to create a PR. Would you like me to create it with `gh pr create`?"
