---
description: Ship a PR for lfx-v2-ui — runs quality gates, signs commits (DCO sign-off + GPG), pushes branch, opens PR with LFXV2 linkage.
argument-hint: [optional: any extra instructions — commit subject, target branch, draft mode, extra PR body context]
---

# /lfx-pr — Ship a PR for lfx-v2-ui

You are running in the lfx-v2-ui monorepo. The user is invoking this command to ship the current branch as a PR. Follow these steps in order. Fail fast — stop immediately if any step fails and surface the error.

User-provided argument (if any): $ARGUMENTS

Interpret `$ARGUMENTS` as freeform user instructions. They may include any of: a commit subject (e.g., `feat(auth): add OAuth`), a target branch (e.g., `to feat/lfx-pr-v2`, `move commits to jme/branch-name`), a draft toggle (e.g., `as draft`), additional PR body context, or other adjustments to the default flow. Apply each instruction at the step that owns it (commit subject in Step 2, branch operations in Steps 1/5, draft flag in Step 6). If any directive is ambiguous, ask the user before acting on it.

## Step 1: Pre-flight state checks

Run these in order. If any fail, stop and report:

- git fetch origin main → ensure `origin/main` is current (avoids stale-local-main drift)
- git rev-parse --abbrev-ref HEAD → if "main", stop: "Refusing to PR from main."
- git rev-list --count origin/main..HEAD → if 0, stop: "No commits ahead of origin/main."
- git status --porcelain

If git status --porcelain is non-empty:

- If `$ARGUMENTS` includes (or clearly implies) a commit subject — use it and proceed to Step 2.
- Otherwise, propose a commit subject derived from the staged diff and ask the user to confirm or revise before committing.

If working tree is clean, skip Step 2.

## Step 2: Commit (only if dirty)

Validate subject:

- Format: <type>(<scope>): <subject> — Angular convention
- Allowed types: feat, fix, refactor, perf, test, docs, style, build, ci, revert
- Banned: chore:
- Length: ≤72 chars
- Scope: lowercase, describes the affected area (e.g., auth, ui, api, docs, ci, dx) — see `.claude/rules/commit-workflow.md`
- When in doubt, let `yarn commitlint` (run by commit-msg hook) be the source of truth

If invalid, stop and report. Otherwise:

```bash
git add -A
git commit --signoff -S -m "<subject>"
```

> **Note:** Both `--signoff` (DCO) and `-S` (GPG signing) are required by repo policy — see `.claude/rules/commit-workflow.md` § Commit Signing for the authoritative rule and GPG setup. See also [PR #674](https://github.com/linuxfoundation/lfx-self-serve/pull/674) for the companion docs update context. If either fails, stop — do not push unsigned commits.

## Step 3: Quality gates (fail-fast)

Run sequentially, stop on first failure, surface output:

```bash
yarn check-types
yarn lint:check
yarn format:check
yarn test
yarn build
```

Gates are read-only (`:check` variants) — they do not mutate the working tree. If lint or format reports issues, fix them, return to Step 2 to commit the fixes, then re-run gates. Do not skip `yarn build` (catches SSR breaks).

## Step 4: Self-review

Run these hard policy checks first (fail-fast):

```bash
./check-headers.sh
yarn commitlint --from origin/main --to HEAD
```

Also verify every commit in `origin/main..HEAD` has both a `Signed-off-by:` trailer and a valid GPG signature:

```bash
git log --format='%G? %(trailers:key=Signed-off-by,valueonly,separator=%x20) %h %s' origin/main..HEAD
```

Each line must start with `G` or `U` (good signature; `U` means the signing key isn't in the local trust db, which doesn't fail the policy) **and** have a non-empty `Signed-off-by` value before the SHA. Codes `N` (no signature), `B` (bad), or `E` (cannot check — e.g., missing public key locally) need investigation. The authoritative GPG check is GitHub's **Verified** badge after push — local `%G?` depends on which keys the user has imported, so a local pass can still show as unverified on GitHub if the signing key isn't registered there. If any commit fails either check, stop and report.

Then run advisory review on:

```bash
git diff origin/main...HEAD
```

Read the diff and check against `CLAUDE.md` and `.claude/rules/`:

- Consider: any browser-only APIs (window, document, etc.) — if found outside isPlatformBrowser guards, flag for the user to confirm (SSR risk)
- Consider: hard-coded brand hex values — if found, suggest using lfxColors scales instead (avoids drift when LF brand updates)
- Module scope respected
- No nested ternaries
- No interface Foo {} inside apps/

Advisory findings are non-blocking — surface them to the user, who decides whether to fix before pushing.

## Step 5: Push

```bash
git push -u origin HEAD
```

If rejected, stop. Do not force-push. Suggest `git pull --rebase origin main`.

## Step 6: Open PR

Find LFXV2 ticket:

1. Branch name pattern LFXV2-XXXX
2. Commit messages
3. Ask user if neither

PR body template:

- Summary (generated from diff + commits)
- Linked ticket with JIRA URL
- Changes (grouped by module)
- How to test
- Screenshots placeholder
- Pre-merge checklist (rendered into the PR body):
  - [x] `yarn check-types` clean
  - [x] `yarn lint:check` clean
  - [x] `yarn format:check` clean
  - [x] `yarn test` passing
  - [x] `yarn build` passing (SSR safe)
  - [x] DCO sign-off (`--signoff`) and GPG signed (`-S`) on every commit
  - [x] Self-reviewed against `CLAUDE.md` conventions
  - [ ] CodeRabbit review addressed
  - [ ] Code-owner review (required for files matched by `.claude/hooks/guard-protected-files.sh`)
  - [ ] e2e run if UI flow changed

- Footer: 🤖 Drafted via /lfx-pr — Claude Code

Derive the PR title from the first commit subject. It must be a valid conventional-commit title: `type(scope): description`, all lowercase, no JIRA ticket. If the first commit subject doesn't satisfy that format (e.g., the branch only has merge commits, or the subject violates the rules), ask the user for a valid title before invoking `gh`.

If `$ARGUMENTS` includes a draft directive (e.g., `as draft`, `draft`, `--draft`), append `--draft` to the `gh pr create` invocation.

```bash
gh pr create --base main --title "<conventional-commit title>" --body-file <body> [--draft]
```

If gh unavailable, print branch URL + body (and the draft flag, if requested) for manual open.

## Step 7: Output

✅ PR opened
URL: <URL>
Branch: <branch>
Ticket: LFXV2-XXXX
Commits: <count>
Diff: +<add> / -<del> across <N> files

Next:

- CodeRabbit will auto-review
- Ping code-owner for lfx-preflight protected files
- Watch CI; address comments inline

## Failure handling

Enforce discipline, don't bypass it. Auto-fix OK for lint --fix and prettier. Never auto-fix: types, tests, build, conventions, missing DCO/GPG, force-push.

## When to use

✅ End of focused session, ready for review
✅ After CodeRabbit pre-review
✅ Branch represents one cohesive change
✅ Drafts — opt in via a draft directive in `$ARGUMENTS` (e.g., `as draft`)

❌ Not for save-progress
❌ Not from main, no commits, broken build
