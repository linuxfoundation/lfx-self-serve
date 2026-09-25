---
name: preflight
description: >
  Mechanical pre-PR pipeline for lfx-self-serve: working tree status, license
  headers, fixture-PII and company-address guards, format, lint, type-check,
  E2E collection, unit tests, build, markdown lint, protected-file check,
  commit verification, and PR change summary — the same checks CI runs. It is
  the second half of the `Preflight` value in `CLAUDE.md`'s **Pre-PR review**
  section, run after `/lfx-self-serve-pr-readiness`. Supports `--report-only`
  when no file mutations are wanted. Review protocol and pattern/convention
  auditing are not owned by this skill.
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# Pre-Submission Preflight Check

You are running the mechanical pre-PR pipeline before the contributor submits a pull request. Every check here is shell-driven or hook-driven, no judgment calls. This skill owns only the checks below; where it sits in the pre-PR sequence is defined by `CLAUDE.md`'s **Pre-PR review** section, whose `Preflight` value invokes it after `/lfx-self-serve-pr-readiness`. The checks mirror `.github/workflows/quality-check.yml`, `license-header-check.yml` and `markdown-lint.yml`, so a clean local run predicts a green CI.

Run each check in order, report results clearly, and help fix any issues found.

## Modes

Args format: `[--report-only]`.

- Default mode may apply mechanical fixes (Prettier formatting, ESLint autofix, missing license headers).
- `--report-only` means report without mutating files: run the `:check` variants named below, do not add headers, do not create commits, and do not create a PR.

## Check 0: Working Tree Status

Before running any validation, check the state of the working tree:

```bash
git fetch origin
git status
git diff --stat origin/main...HEAD
git log --format="%h %s%n%b" origin/main...HEAD
```

**Evaluate:**

- **Uncommitted changes?** — Ask the contributor: commit now or stash?
- **No commits ahead of main?** — The branch has nothing to validate. Ask if they're on the right branch.
- **Commit messages missing a ticket reference?** — Flag commits that don't include `#XXX` (GitHub Issue) or the fully-qualified `org/repo#XXX` form (e.g. `linuxfoundation/lfx-self-serve#1331`) in subject or body. See `.claude/rules/commit-workflow.md` § Ticket Tracking.
- **Commits missing `--signoff`?** — Flag any commits without `Signed-off-by:` lines (visible in the full commit body above).

Resolve any issues before proceeding to the checks below.

## Check 1: License Headers

```bash
./check-headers.sh
```

Every source file (`.ts`, `.html`, `.scss`) must have the license header:

- TypeScript/SCSS: `// Copyright The Linux Foundation and each contributor to LFX.` + `// SPDX-License-Identifier: MIT`
- HTML: `<!-- Copyright The Linux Foundation and each contributor to LFX. -->` + `<!-- SPDX-License-Identifier: MIT -->`

If any files are missing headers, add them (report only in `--report-only`).

## Check 2: Fixture PII and Company-Address Guards

The same two guards CI's `quality-check.yml` runs before installing dependencies:

```bash
./check-fixture-emails.sh "$(git merge-base origin/main HEAD)"   # real customer/vendor emails added to fixtures
./check-company-email-guards.sh                                  # Org Lens company-address panel guards
```

Both must exit 0. A failure is a content problem, never something to auto-fix: replace the offending fixture data or restore the guard the script names.

## Check 3: Formatting

Default mode:

```bash
yarn format
```

This applies Prettier formatting with Tailwind class sorting. It modifies files in place.

`--report-only` (and what CI runs):

```bash
yarn format:check
```

> **Why format before lint:** Prettier auto-fixes whitespace, import ordering, and line-length issues that would otherwise appear as lint errors. Running format first eliminates noise from the lint step.

## Check 4: Linting

Default mode:

```bash
yarn lint
```

`--report-only` (and what CI runs):

```bash
yarn lint:check
```

If there are lint errors, fix them. Common issues:

- Missing imports
- Unused variables
- Component selector prefix (must be `lfx-`)
- Import ordering

### Re-validation

If any fixes were applied in Checks 1-4, re-run the check variants to confirm the fixes are clean:

```bash
yarn format:check && yarn lint:check
```

If either still fails, fix and repeat until clean.

## Check 5: Type Checking

```bash
yarn check-types
```

Runs each workspace's `check-types` script (`tsc --noEmit`, spec files included). Type errors here surface before `yarn build` and usually point at a shared-package export or an interface drift.

## Check 6: E2E Collection

```bash
(cd apps/lfx-one && yarn e2e:check-collection)
```

Runs Playwright collection only (`--list`, no browser) so a spec file that fails to load, or collects zero tests, fails here instead of silently reporting "0 failures". Fix the spec, do not skip.

## Check 7: Unit Tests

```bash
yarn test
```

All unit tests must pass. A failure introduced by the branch is fixed in the branch; a flaky pre-existing failure is reported, not silenced.

## Check 8: Build Verification

```bash
yarn build
```

The build must succeed. If it fails:

- Check for TypeScript errors (missing types, wrong imports)
- Verify shared package exports are correct
- Check for circular dependencies

## Check 9: Markdown Lint

CI's `markdown-lint.yml` runs `markdownlint-cli2` over `**/*.md` with the repo's `.markdownlint.json`. Run the same locally on the Markdown files the branch touches:

```bash
git diff --name-only origin/main...HEAD -- '*.md' | xargs -r npx --yes markdownlint-cli2
```

Fix every hit in a touched file. Hits in files the branch does not touch are pre-existing and out of scope for this PR.

## Check 10: Protected Files Check

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

## Check 11: Commit Verification

Before the final report, verify all changes are properly committed:

```bash
git status
git log --format="%h %s%n%b" origin/main...HEAD
```

- **All changes committed?** — If not, remind the contributor to commit remaining changes.
- **Commit messages follow conventions?** — `type(scope): description` format per `commit-workflow.md`.
- **`--signoff` on all commits?** — Every commit must have `Signed-off-by:` (check in the full body output above).
- **Ticket referenced?** — Commit messages should include `#XXX` (GitHub Issue) or the fully-qualified `org/repo#XXX` form (e.g. `linuxfoundation/lfx-self-serve#1331`).

## Check 12: Change Summary

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
✓ PII / guards        — Fixture emails clean, company-address guards intact
✓ Formatting          — Clean
✓ Linting             — No errors
✓ Type check          — No errors
✓ E2E collection      — Consistent
✓ Unit tests          — Passed
✓ Build               — Succeeded
✓ Markdown lint       — No hits in touched files
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
✓ PII / guards        — Fixture emails clean, company-address guards intact
✓ Formatting          — Clean
✗ Linting             — 3 errors (see above)
✓ Type check          — No errors
✓ E2E collection      — Consistent
✗ Unit tests          — 1 failing (see above)
✗ Build               — Failed (see above)
✓ Markdown lint       — No hits in touched files
✓ Protected files     — None modified
✓ Commits             — Conventions followed, signed off
─────────────────────────────────
ISSUES FOUND — Fix before submitting
```

### If All Checks Pass

Suggest creating the PR:

> "All preflight checks passed! Ready to create a PR. Would you like me to create it with `gh pr create`?"
