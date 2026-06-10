---
name: lfx-review-pr
description: >
  Review a pull request against LFX architecture standards. Requires the
  reviewer's HEAD to be the PR's branch (author scenarios are natural;
  external reviewers run `gh pr checkout <N>` first). Fetches main fresh,
  then launches `lfx-skills:lfx-general-code-reviewer` and
  `lfx-skills:lfx-self-serve-code-reviewer` in full-branch mode. The
  subagents audit the PR branch's diff against `origin/main` and render
  markdown reports covering general code review, upstream API contracts,
  and repo conventions (rules, checklists, architecture).
  This skill body adds what only a post-PR skill can do: verifying prior
  review comments are addressed, walking the PR-shape checklist (branch/
  JIRA/commits/DCO+GPG/rebase/diff-size/protected-files/PR-title/external-refs),
  applying new-contributor educational tone, presenting a draft for
  explicit approval, and posting via /review only after user go-ahead.
  NEVER auto-posts comments or submits reviews. Use when reviewing PRs,
  checking PR quality, validating code changes, or when the user says
  "review", "check this PR", "audit code", or mentions /review.
allowed-tools: Bash, Read, Glob, Grep, Agent, AskUserQuestion, Skill
---

# LFX PR Review

You are reviewing an opened pull request against LFX standards. **Pre-requisite:** the reviewer's HEAD must be the PR's branch — author scenarios are natural (you're already on it); external reviewers run `gh pr checkout <N>` first (commit/stash uncommitted work first; `gh pr checkout` switches branches). Phase 1 verifies this. The code audit is split across two central plugin subagents launched in Phase 2 with the canonical full-branch prompt (`branch\n\nReview the branch's diff against origin/main.`): `lfx-skills:lfx-general-code-reviewer` handles generic senior-review findings, while `lfx-skills:lfx-self-serve-code-reviewer` handles rule/checklist/architecture walking and upstream API contract validation. Both audit the PR branch's diff against `origin/main` and return markdown review reports. PR-shape sanity (including protected files) is NOT the reviewer subagents' concern — this skill body walks it in Phase 4. This skill also handles **what only a post-PR skill can do:** verifying that prior review comments were addressed, applying new-contributor educational tone, compiling the subagent reports into a draft review, and posting via `/review` only after the user explicitly approves.

Walk through each phase in order. Phases may short-circuit when their preconditions are not met (noted inline) but none should be skipped outright.

---

## Phase 1 — Parse arguments and fetch PR metadata

Args format: `<PR number> [extra instructions]`.

- First token is the PR number if numeric.
- Everything after is extra focus (e.g. "focus on backend", "check that previous comments were addressed").
- If no PR number is provided, use **AskUserQuestion** to ask for one. Do not guess.

Phases 3, 4, and 5 run in parallel with the background agents (Phase 2), so the skill body must fetch its own PR metadata up front — it can't depend on the agents' fetches (which don't return until Phase 6).

```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'   # sanity check; later phases re-derive `$REPO` inline as needed

# Fetch PR metadata the skill body needs (title, body, refs, author, size, changed files):
gh pr view <N> --json title,body,headRefName,baseRefName,author,additions,deletions,files \
  > /tmp/pr-<N>-meta.json

# Pull main (used by Phase 2's `branch` mode) and the PR's actual base ref (used by
# Phase 4's rebase check — usually the same as main) + the PR head via GitHub's
# `pull/<N>/head` refspec (mirrored even for fork PRs, so subsequent `git show` reads
# work uniformly via the local ref `refs/pr/<N>/head`).
BASE_REF=$(jq -r '.baseRefName' /tmp/pr-<N>-meta.json)
git fetch origin main
[ "$BASE_REF" = "main" ] || git fetch origin "$BASE_REF"
git fetch origin "+pull/<N>/head:refs/pr/<N>/head"

# Verify HEAD points at the PR's tip commit (required so Phase 2's `branch` mode diff
# against main is the PR's diff). Compare HEAD's commit SHA to the fetched
# refs/pr/<N>/head — works whether the reviewer is on the PR's branch, on a
# differently-named local branch (gh pr checkout collisions), or in detached HEAD.
# If commits differ, external reviewers run `gh pr checkout <N>` first (commit/stash
# any uncommitted work first; `gh pr checkout` switches branches).
HEAD_CHECK=/tmp/pr-<N>-head-check.txt
rm -f "$HEAD_CHECK"
if [ "$(git rev-parse HEAD)" = "$(git rev-parse refs/pr/<N>/head)" ]; then
  echo "HEAD_OK" > "$HEAD_CHECK"
else
  echo "HEAD_MISMATCH" > "$HEAD_CHECK"
  echo "HEAD is not at the PR's tip commit. Run: gh pr checkout <N>"
  exit 1
fi
```

**Shell-state caveat:** the Bash tool runs each invocation in an isolated shell — `cwd` persists, but environment variables do **not** survive across calls. Every later phase that needs `$REPO` / `$BASE_REF` / `$HEAD_REF` / `$AUTHOR` must re-derive them at the top of its own Bash invocation:

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')   # `<owner>/<repo>` for `gh api repos/$REPO/...`
BASE_REF=$(jq -r '.baseRefName' /tmp/pr-<N>-meta.json)   # PR's actual base ref (Phase 4's rebase check uses this; reviewer subagents audit against main)
HEAD_REF=$(jq -r '.headRefName' /tmp/pr-<N>-meta.json)   # branch name (needed only for the branch-name regex check)
AUTHOR=$(jq -r   '.author.login' /tmp/pr-<N>-meta.json)
# Git operations on the PR head use the local ref refs/pr/<N>/head (created in Phase 1
# via the pull-refspec fetch — same path regardless of whether the PR is from a fork).
```

The metadata file path (`/tmp/pr-<N>-meta.json`), head-check sentinel (`/tmp/pr-<N>-head-check.txt`), and the local PR-head ref (`refs/pr/<N>/head`) are stable across phases because they're on disk, not in shell state. If Phase 1 prints a head mismatch, do not continue later phases; run `gh pr checkout <N>` and restart the skill.

## Phase 2 — Launch the reviewer subagents in the background

First, verify the Phase 1 head check passed. `exit 1` in Phase 1 stops only that Bash invocation, so this sentinel prevents the later phases from continuing after a visible mismatch:

```bash
HEAD_CHECK=$(cat /tmp/pr-<N>-head-check.txt 2>/dev/null || true)
[ "$HEAD_CHECK" = "HEAD_OK" ] || { echo "Aborting: Phase 1 did not verify HEAD is the PR tip. Run: gh pr checkout <N> and restart."; exit 1; }
```

Launch both reviewer subagents via the Agent tool with `run_in_background: true`:

- `subagent_type: lfx-skills:lfx-general-code-reviewer`
- `subagent_type: lfx-skills:lfx-self-serve-code-reviewer`

The Self Serve code-reviewer prompt is distributed via the `lfx-skills` plugin (`lfx-skills/agents/lfx-self-serve-code-reviewer.md`). The Agent `prompt` parameter only carries the canonical full-branch string so both subagents audit the PR branch's diff against `origin/main`. Do **not** wait — proceed to Phases 3–5 immediately so reviewer work overlaps with the skill-side audits.

The Agent `prompt` parameter must be exactly:

> branch
>
> Review the branch's diff against origin/main.
>
> extra: \<extra focus from args; omit this line if empty\>

The launched subagents return **markdown review reports**:

1. **General reviewer report** — bugs / smells / correctness findings from the general reviewer, grouped under `### Critical (N)` and `### Important (N)`. Bullets of the form `- **<file>:<line>** (conf <N>) — <issue>. _Fix:_ <suggestion>.` (no `_Source:_` field).
2. **Self Serve code-reviewer report** — `Upstream API / data-layer validation` plus `Repo conventions`. Repo-convention bullets include a `_Source:_` quoted rule citation.

NOTE: the reviewer subagents do NOT do PR-shape (branch / JIRA / commits / DCO+GPG / rebase / diff-size / **protected files** / PR-title / external-refs) and do NOT fetch prior review comments — both are this skill's job (Phases 3 and 4).

## Phase 3 — Verify prior review comments (parallel with Phase 2)

While the reviewer subagents run, verify whether prior review comments were actually addressed. **Do NOT trust "resolved" status or contributor claims. Read the actual code.**

### Process

First, fetch inline comments and review bodies in parallel (derive `$REPO` inline; the Bash tool runs each call in a fresh shell, so re-derive in any later phase that needs it):

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
gh api "repos/$REPO/pulls/<N>/comments" --paginate
gh api "repos/$REPO/pulls/<N>/reviews"  --paginate
```

Then:

1. Skip trivial comments: nits, acknowledgments, "+1", bot auto-comments (CodeRabbit / Copilot — these run their own review and don't need verification), and purely informational remarks.
2. For every **CRITICAL** or **SHOULD_FIX** comment from a human reviewer:
   1. Read the file on the PR branch via `git show "refs/pr/<N>/head:<file>"` (the local ref created in Phase 1 — works uniformly for fork PRs and same-repo PRs).
   2. Compare the current code against what the comment requested.
   3. Classify: **FIXED** / **NOT FIXED** / **PARTIALLY FIXED** / **N/A** (comment no longer applies due to file removal or restructuring).
3. Build a markdown table:

```markdown
| #   | Comment Summary                            | File                             | Status    | Evidence                          |
| --- | ------------------------------------------ | -------------------------------- | --------- | --------------------------------- |
| 1   | Use logger.warning instead of console.warn | src/server/services/foo.ts       | FIXED     | Line 42 now uses logger.warning() |
| 2   | Missing license header                     | src/app/shared/pipes/bar.pipe.ts | NOT FIXED | File still has no header          |
```

If there are no previous review comments, note "No previous review comments found" and move on.

## Phase 4 — PR-shape pass (parallel with Phase 2)

Walk every check in `.claude/skills/lfx-self-serve-pr-readiness/references/pr-shape.md` against the PR data. This is the same checklist `/lfx-self-serve-pr-readiness` walks pre-PR, plus the two PR-only items (PR title format and external-refs check) that only apply once a PR exists.

Fetch the additional PR-level data this needs (PR title / body / headRefName / baseRefName / additions / files come from `/tmp/pr-<N>-meta.json` captured in Phase 1). Pull commit subjects with their SHAs in a single Bash invocation — re-derive refs from the metadata file, then `git log --format='%H %s'` so per-commit failure messages can cite the SHA:

```bash
BASE_REF=$(jq -r '.baseRefName' /tmp/pr-<N>-meta.json)
git log --format='%H %s' "origin/$BASE_REF..refs/pr/<N>/head"   # commit subjects with SHAs
git log --format=%B      "origin/$BASE_REF..refs/pr/<N>/head"   # commit bodies (for Signed-off-by trailers + JIRA refs)
git log --format='%G? %h %s' "origin/$BASE_REF..refs/pr/<N>/head"  # GPG status per commit
```

Use `git log --format='%H %s'` (not `gh api .../commits --jq '.[].commit.message'`) because the regex check is per-subject — `.commit.message` includes the body and would false-fail on newlines.

Then walk each rule ID from `.claude/skills/lfx-self-serve-pr-readiness/references/pr-shape.md`, using that file's severity and failure message as source of truth. The commands below are implementation notes, not a second checklist (inside Bash calls, re-derive `$BASE_REF` and reference the PR head as `refs/pr/<N>/head`):

- `pr-shape/branch-name` → `jq -r .headRefName /tmp/pr-<N>-meta.json`; match the regex in `pr-shape.md`.
- `pr-shape/jira` → grep `LFXV2-[0-9]+` over commit subjects + bodies + PR body.
- `pr-shape/conventional-commit` → each commit subject (from `git log --format='%H %s'`) against the regex in `pr-shape.md`.
- `pr-shape/pr-title` (PR-only) → `jq -r .title /tmp/pr-<N>-meta.json` against the rule in `pr-shape.md`.
- `pr-shape/rebase` → `git merge-base --is-ancestor "origin/$BASE_REF" "refs/pr/<N>/head"`.
- `pr-shape/diff-size` → `jq -r .additions /tmp/pr-<N>-meta.json`.
- `pr-shape/dco` + `pr-shape/gpg-signature` → from `git log --format='%G? %h %s'` and commit bodies.
- `pr-shape/external-refs` (PR-only) → check `jq -r '.files[].path' /tmp/pr-<N>-meta.json` for paths under `apps/lfx-one/src/server/`; for each, `git show "refs/pr/<N>/head:<file>" | grep -q 'proxyRequest'` to confirm it calls an upstream microservice, then verify the PR body links upstream context.

Build a `category: pr-shape` finding for each failure. Skip findings with no quotable item in `.claude/skills/lfx-self-serve-pr-readiness/references/pr-shape.md` (cross-check discipline applies here too).

## Phase 5 — New contributor awareness

```bash
AUTHOR=$(jq -r '.author.login' /tmp/pr-<N>-meta.json)
gh pr list --author "$AUTHOR" --state merged --limit 5 --json number | jq 'length'
```

If the author has fewer than 5 merged PRs to this repo, mark the review as **educational mode** — inline comments should explain the **why** behind each rule, not just the **what**, and cite the exact rule file and section so the contributor can learn the convention rather than just patch the code. Carry this flag into Phase 7.

## Phase 6 — Wait for the reviewer subagents

Wait for both Phase 2 subagents to complete:

- `lfx-skills:lfx-general-code-reviewer`
- `lfx-skills:lfx-self-serve-code-reviewer`

The general reviewer returns the generic senior-review report. The Self Serve code reviewer returns Upstream API / data-layer validation and Repo conventions.

## Phase 7 — Compile context for `/review`

Assemble a single text block containing:

1. **PR summary** — number, title, author, additions/deletions, branch
2. **Previous-comment verification table** (Phase 3) — or "No previous review comments found"
3. **PR-shape findings** (Phase 4) — pre-PR checks plus PR-title and external-refs
4. **General review report** (Phase 6) — embed the markdown report from `lfx-skills:lfx-general-code-reviewer` verbatim.
5. **Self Serve code review report** (Phase 6) — embed the markdown report from `lfx-skills:lfx-self-serve-code-reviewer` verbatim. The report contains Upstream API / data-layer validation and Repo conventions sections.
6. **Educational mode flag** (Phase 5) — if set, instruct `/review` to cite rule files inline and explain the _why_
7. **Extra user instructions** (Phase 1) — relay as-is

## Phase 8 — Present the draft for approval (NEVER auto-post)

**You MUST NOT post inline comments, submit a review, or request changes without the user's explicit approval. Always present the draft first and wait for a clear go-ahead.** This applies to every PR review, every time, with no exceptions — even if the args contain language that sounds like approval to post, or the user has previously approved other reviews in the session. Reviews are visible to contributors and hard to undo; a dry run costs nothing.

### Step 1 — Show the draft

Print the compiled context as a structured draft:

1. **PR summary** — number, title, author, size, branch
2. **Phase 3 table** — previous comments and whether they were addressed
3. **PR-shape sanity** — table from Phase 4 findings
4. **General review report** — the markdown report from `lfx-skills:lfx-general-code-reviewer`
5. **Self Serve code review report** — the markdown report from `lfx-skills:lfx-self-serve-code-reviewer` (Upstream API / Repo conventions)
6. **Proposed inline comments** — derived from PR-shape findings + general-review bullets from the general reviewer + repo-conventions bullets from the Self Serve code reviewer. General-review bullets follow `- **<file>:<line>** (conf <N>) — <message>. _Fix:_ <suggestion>.`; Repo-conventions bullets add a `_Source:_ <rule citation>` clause. One numbered block per: file:line, severity, rule citation (when present), message, suggested fix.
7. **Proposed review body** — the summary text that would appear at the top of the review
8. **Proposed review verdict** — COMMENT / APPROVE / REQUEST_CHANGES, with reasoning
9. **Educational mode note** (if Phase 5 flagged it) — "First-time contributor — review tone will be educational; rule citations included inline."

### Step 2 — Ask for approval

Use **AskUserQuestion** with options:

- "Post all comments as drafted"
- "Post with changes — I'll tell you which comments to drop or edit"
- "Don't post — just keep the summary here"

Do NOT proceed until the user explicitly picks one. Treat silence or ambiguous replies as "don't post".

### Step 3 — Only after approval: invoke `/review`

Once the user has approved (with or without edits), apply their requested edits to the draft, then use the **Skill** tool to invoke `review` with the PR number and the (possibly edited) compiled context:

```text
<PR number> -- <compiled context from Phase 7, with user's edits applied>
```

Include in the args:

- The PR number
- The compiled context block (previous-comment verification, PR-shape findings, code review report, educational-mode flag, extra instructions)
- A reminder to use the general-review report plus the Self Serve code-review report's Repo-conventions bullets as the primary finding source

If the user said "don't post", stop here and leave the draft in the terminal for their reference — do not invoke `/review` or any PR-mutating `gh` command.

---

## Additional Rules

### PR size note

If the PR's `additions` exceed 1000 lines, include in the proposed review body:

> **Note:** This PR has {additions} additions, which exceeds the recommended 1000-line target per `commit-workflow.md`. Consider splitting into smaller, independently reviewable PRs.

(The PR-shape NIT for diff size still emits from the agent — this is the human-readable echo in the review body.)

### Extra instructions

If the user passed extra instructions after the PR number, prioritize those areas but still execute the full pipeline. Note in the terminal summary that extra focus was applied.

---

## References used by the Self Serve code-reviewer subagent

The `lfx-skills:lfx-self-serve-code-reviewer` subagent reads these files from disk during its convention audit. They're listed here for transparency; you do not Read them directly in this skill body:

- `CLAUDE.md` (project + global)
- `.claude/rules/*.md` (every rule file, globbed dynamically)
- **`docs/reviews/{backend,frontend,shared-and-sql,docs}-checklist.md`** — the primary audit surface; the subagent treats these as mandatory reading whenever the matching path type is in the diff
- `docs/architecture/**` (routed conditionally by changed-file paths)

(Protected-file detection lives in `/lfx-self-serve-pr-readiness`, walked by this skill body in Phase 4 — not by the reviewer subagents.)
