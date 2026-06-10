---
name: preflight
description: >
  Mechanical pre-PR pipeline, license headers, format, lint, build, protected
  file check, commit verification, and PR change summary. Run after the
  post-commit reviewer trio has been drained and `/lfx-self-serve-pr-readiness`
  has passed. Pattern/convention auditing is owned by the central reviewer
  trio (see `.claude/rules/skill-guidance.md` for canonical post-commit
  reviewer-trio launch instructions), not by this skill.
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# Pre-Submission Preflight Check

You are running the mechanical pre-PR pipeline before the contributor submits a pull request. Every check here is shell-driven or hook-driven, no judgment calls. Convention and pattern audits live in `docs/reviews/frontend-checklist.md` (sections 1-14) and run via the post-commit reviewer trio (see `.claude/rules/skill-guidance.md` for canonical post-commit reviewer-trio launch instructions).

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

The canonical protected-file list is the `.claude/hooks/guard-protected-files.sh` hook — it owns every protected path and the reason text. Extract the list from the hook rather than maintaining a duplicate:

```bash
# changed files vs main
git diff --name-only origin/main...HEAD > /tmp/preflight-changed.txt

# pipe each changed file through the guard hook (simulates the PreToolUse hook)
while IFS= read -r f; do
  printf '{"file_path":"%s"}' "$f" | bash .claude/hooks/guard-protected-files.sh
done < /tmp/preflight-changed.txt
```

Any warning the hook prints to stderr identifies a protected file in the diff. Flag every match and ask the contributor to revert those changes or get code owner approval.

(The same `/lfx-self-serve-pr-readiness` skill already parses this hook the same way — keep them in sync by editing the hook, not by adding new inline lists.)

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
