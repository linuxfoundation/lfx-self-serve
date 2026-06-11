---
name: lfx-self-serve-pr-readiness
description: >
  Pre-PR shape check on local lfx-self-serve work. Audits PR-shape
  sanity (branch name, JIRA reference, conventional-commit format,
  rebase status, DCO + GPG signing per commit, total diff size, and
  protected files touched) against the target base branch. Does NOT
  audit code, code audits run post-commit via the central reviewer
  trio (see `.claude/rules/skill-guidance.md` for canonical post-commit
  reviewer-trio launch instructions). Use once before opening a PR,
  after the post-commit review queue has returned clean.
context: fork
allowed-tools: Bash, Read, Glob, Grep
---

# LFX Self-Serve PR Readiness

You are checking whether **local commits are shaped correctly to open as a PR** — branch name, JIRA references in commit messages, conventional-commit format, rebase status, DCO + GPG signing on every commit, total diff size.

This skill does NOT audit code. Code audits run post-commit via the central reviewer trio. See `.claude/rules/skill-guidance.md` for canonical post-commit reviewer-trio launch instructions (the three `subagent_type` names, parallel-launch convention, and `run_in_background: true` flag). By the time you run, every running review in the trio must have returned, the full-branch sweep must have run on multi-commit branches (`branch` arg), and any Critical or reasonable Important findings must already be addressed in a fix commit.

The PR-shape checklist lives in `references/pr-shape.md` and is walked directly in this body.

**Output:** structured shape report with verdict `NOT READY | READY WITH CHANGES | READY`. No git mutations, no PR side-effects.

---

## ⚠ Mandatory: read the PR-shape checklist before any audit work

- **`.claude/skills/lfx-self-serve-pr-readiness/references/pr-shape.md`** — PR-shape sanity checklist with severity per item. Every finding must trace back to an item in this file. If you cannot quote the source, drop the finding.

---

## Phase 1 — Parse arguments

Args format: `[base-branch] [extra instructions]`.

- First token, if it looks like a ref (contains `/`, or is a plain branch name like `main`), is the base branch.
- Default base: `origin/main`.
- Everything else is extra focus (rarely used for shape; mostly for explanatory context).

## Phase 2 — Gather PR-shape inputs

**Normalize `<base>` first:** if it contains no `/` (e.g., bare `main`), prefix with `origin/` so the comparison runs against the freshly-fetched remote ref rather than a possibly-stale local branch.

Run in parallel:

```bash
git fetch origin
git rev-parse --abbrev-ref HEAD                                 # current branch
git diff --shortstat <base>...HEAD                              # additions/deletions (three-dot = merge-base..HEAD)
git diff --name-only <base>...HEAD                              # changed files (drives protected-files check)
git log --format='%H %s' <base>..HEAD                           # commit subjects on the branch
git log --format='%G? %h %s' <base>..HEAD                       # signature status per commit
git log --format=%B <base>..HEAD                                # commit bodies (Signed-off-by trailers)
git merge-base --is-ancestor <base> HEAD; echo $?               # rebase status (0 = ancestor)
```

Also Read `.claude/hooks/guard-protected-files.sh` and parse its `case` / `if` blocks to build the authoritative protected-paths list. Never hardcode the list — the hook is the source of truth.

If there are no commits between base and HEAD, abort: "No commits to audit against `<base>` — make at least one commit on this branch."

## Phase 3 — PR-shape pass

Walk every item in `references/pr-shape.md` against the Phase 2 outputs. Each item produces 0 or 1 finding.

Emit each finding:

```json
{
  "severity": "CRITICAL | SHOULD_FIX | NIT",
  "rule": "pr-shape/<item-id>",
  "message": "...",
  "suggestion": "..."
}
```

Reference Phase 2 outputs:

- Branch name → `git rev-parse --abbrev-ref HEAD`
- JIRA reference → `grep -oE 'LFXV2-[0-9]+'` over commit subjects + bodies
- Conventional commits → check each commit subject against the regex in `pr-shape.md`
- Rebase → `git merge-base --is-ancestor <base> HEAD` exit code (0 = rebased)
- DCO + GPG → `%G?` codes + `Signed-off-by:` trailer presence per commit
- Diff size → `additions` from `git diff --shortstat`
- Protected files touched → intersect `git diff --name-only <base>...HEAD` against the protected-paths list parsed from `.claude/hooks/guard-protected-files.sh`

## Phase 4 — Cross-check discipline

Every finding must quote an item in `references/pr-shape.md`. Drop hallucinated findings.

## Phase 5 — Render the report

```markdown
# LFX Self-Serve PR Readiness

**Branch:** `<current-branch>` → `<base>`
**Commits:** N | **Additions:** +A | **Deletions:** -D
**Verdict:** NOT READY | READY WITH CHANGES | READY

## PR-shape sanity

| Check               | Status     | Detail                                                 |
| ------------------- | ---------- | ------------------------------------------------------ |
| Branch name         | PASS       | feat/LFXV2-1234                                        |
| JIRA ticket         | PASS       | Found LFXV2-1234 in commits                            |
| Conventional commit | PASS       | All 3 commits valid                                    |
| Branch rebased      | PASS       | origin/main is an ancestor                             |
| Diff size           | PASS       | 342 additions                                          |
| DCO + GPG signing   | PASS       | 3/3 commits signed + signed-off                        |
| Protected files     | SHOULD_FIX | 1 file: CLAUDE.md (surface in PR body, tag code owner) |

## Verdict reasoning

<one line per CRITICAL/SHOULD_FIX>
```

### Verdict rules

- **NOT READY** — any CRITICAL finding.
- **READY WITH CHANGES** — zero CRITICAL; SHOULD_FIX findings present. Address or document the trade-off in the PR description.
- **READY** — zero CRITICAL, zero SHOULD_FIX.

---

## References used

- **`.claude/skills/lfx-self-serve-pr-readiness/references/pr-shape.md`**

## Companion skills & subagents

- Post-commit reviewer trio: see `.claude/rules/skill-guidance.md` for canonical post-commit reviewer-trio launch instructions. The queue must be drained and the latest trio returned clean before this check.
- `/preflight` — mechanical checks (license, format, lint, build, protected files). Run after this passes.
- `/lfx-review-pr` — post-PR reviewer. Not part of pre-PR.
