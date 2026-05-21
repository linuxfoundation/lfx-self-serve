# PR-shape checklist

This file is the single source of truth for PR-shape sanity checks. It is consumed by:

- **`/lfx-self-serve-pr-readiness`** (pre-PR) — runs every item in §§1–7 below; skips §§8–9 (PR-only).
- **`/lfx-review-pr`** (post-PR) — runs every item, including §§8–9.

Each item lists its `rule:` ID (used in finding JSON), severity, the check, the failure message, and the suggested fix.

---

## 1. `pr-shape/branch-name` — SHOULD_FIX

**Check:** the current branch matches `<type>/LFXV2-<number>` per `.claude/rules/commit-workflow.md`.

Regex: `^(feat|fix|docs|style|refactor|perf|test|build|ci|revert)/LFXV2-[0-9]+$`

**Failure message:** `Branch name '<branch>' does not match '<type>/LFXV2-<number>'.`

**Suggestion:** `git branch -m <type>/LFXV2-<ticket>` — e.g. `git branch -m feat/LFXV2-1827`.

## 2. `pr-shape/jira` — SHOULD_FIX

**Check:** at least one commit subject, commit body, or PR body contains a `LFXV2-XXX` reference. Extract with `grep -oE 'LFXV2-[0-9]+'`.

**Failure message:** `No LFXV2-XXX reference found in commit messages or PR body. All work must be tracked in JIRA.`

**Suggestion:** Add the ticket reference to a commit message (`git commit --amend`) or to the PR body (post-PR).

## 3. `pr-shape/conventional-commit` — SHOULD_FIX

**Check:** every commit subject matches `^(feat|fix|docs|style|refactor|perf|test|build|ci|revert)(\([a-z0-9-]+\))?: .+$`, lowercase, header ≤72 characters (team style; commitlint hard-fails at >100, per `@commitlint/config-angular` default). `chore` is NOT valid (commitlint uses `@commitlint/config-angular`).

**Failure message** (per offending commit): `Commit '<sha>' subject '<subject>' violates conventional-commit format. Type must be one of feat/fix/docs/style/refactor/perf/test/build/ci/revert (lowercase), optional scope in parens, then ': ', then description. Header should be ≤72 chars (team style); commitlint enforces ≤100. 'chore' is not accepted.`

**Suggestion:** Reword with `git rebase -i <base>` (`reword`) or `git commit --amend` if it's the latest commit.

## 4. `pr-shape/rebase` — SHOULD_FIX

**Check:** the base branch is an ancestor of the head branch.

- Pre-PR: `git merge-base --is-ancestor <base> HEAD` (typically `<base>` = `origin/main`).
- Post-PR: `git merge-base --is-ancestor origin/<baseRefName> refs/pr/<N>/head` — the head ref is fetched via `git fetch origin "+pull/<N>/head:refs/pr/<N>/head"` so the check works uniformly for PRs from forks. (`origin/<headRefName>` is fork-broken; the caller `/lfx-review-pr` already mediates this — see `.claude/skills/lfx-review-pr/SKILL.md` Phase 1.)

Non-zero exit → fail.

**Failure message:** `Branch is not rebased on <base>. Reviewers will see merge conflicts.`

**Suggestion:** `git fetch origin && git rebase origin/<base-branch>`.

## 5. `pr-shape/diff-size` — NIT

**Check:** additions ≤ 1000 lines (per `.claude/rules/commit-workflow.md`).

**Failure message:** `This change has <N> additions, exceeding the 1000-line target. Consider splitting into smaller, independently-reviewable PRs.`

**Suggestion:** Identify natural seams (one feature, one bug fix, one refactor per PR) and split with `git rebase -i` + branch reset.

## 6. `pr-shape/dco` + `pr-shape/gpg-signature` — CRITICAL (both)

**Check (DCO):** every commit body contains a `Signed-off-by: <name> <email>` trailer. Get from `git log --format=%B <base>..HEAD`.

**Check (GPG):** every commit has a `%G?` code of `G` (good) or `U` (good, untrusted key). Codes `N` (no sig), `B` (bad sig), `E` (cannot check) are failures. Get from `git log --format='%G? %h %s' <base>..HEAD`.

**Failure message (DCO):** `Commit '<sha>' is missing the 'Signed-off-by:' trailer required by the project's DCO policy.`

**Failure message (GPG):** `Commit '<sha>' is not GPG-signed (code: <code>). Repo policy requires both --signoff and -S on every commit.`

**Suggestion:**

- Single-commit: `git commit --amend --signoff -S --no-edit`
- Older commits / rebase / cherry-pick recovery: see the `/dco` skill.

Note: `U` is acceptable (good signature with an untrusted key); GitHub's "Verified" badge requires the key be registered on the contributor's GitHub account, which is checked at push time, not here.

## 7. `pr-shape/protected-files-touched` — SHOULD_FIX

**Check:** intersect the diff's changed files against the path list parsed from `.claude/hooks/guard-protected-files.sh` (the hook's authoritative `case` / `if` blocks — never hardcode). If any changed file matches, emit one finding listing every match.

- Pre-PR: `git diff --name-only <base>...HEAD`.
- Post-PR: `jq -r '.files[].path' /tmp/pr-<N>-meta.json`.

**Failure message:** `Protected files touched: <list>. These are part of core infrastructure — surface in the PR description and tag a code owner for explicit review.`

**Suggestion:** Add a "Protected files" section to the PR body listing each touched file and the reason for the change. Tag a code owner on the PR.

---

## PR-only checks (skipped pre-PR)

## 8. `pr-shape/pr-title` — SHOULD_FIX

**Check (post-PR only):** the PR title matches `^(feat|fix|docs|style|refactor|perf|test|build|ci|revert)(\([a-z0-9-]+\))?: .+$`, lowercase, MUST NOT include `LFXV2-XXX`. `chore` is invalid.

**Failure message:** `PR title '<title>' violates conventional-commit format. Title must be lowercase, use a valid type (not 'chore'), and must NOT include the JIRA ticket (which lives in commits and PR body).`

**Suggestion (example):**

- Invalid: `Fix: LFXV2-123 fix login bug`
- Valid: `fix(auth): resolve login redirect on session expiry`

## 9. `pr-shape/external-refs` — SHOULD_FIX

**Check (post-PR only):** if any changed file under `apps/lfx-one/src/server/` calls an upstream microservice via `MicroserviceProxyService.proxyRequest()`, the PR body should link to the corresponding upstream PR or commit (in `lfx-v2-<service>-service`).

**Failure message:** `PR touches upstream proxy endpoints but the PR body has no link to a corresponding upstream PR or commit. Reviewers need the full context for cross-repo changes.`

**Suggestion:** Add an `## External references` section to the PR body with links to the upstream PR / commit / deployed-version reference.
