---
description: Commit conventions, branch naming, PR format, PR size guidelines, sign-off + GPG signing, and ticket tracking workflow (JIRA or GitHub Issues)
paths:
  - '*'
---

# Commit & PR Workflow

## Commit Conventions

- Follow Angular commit conventions: `type(scope): description`
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert` — `chore` is **not** accepted (commitlint uses `@commitlint/config-angular`; use the closest specific type instead: `build` for deps/tooling, `ci` for pipelines, `refactor` for cleanup, `docs` for doc-only changes)
- Scope should be lowercase and describe the affected area (e.g., `auth`, `ui`, `api`, `docs`) following Angular scope conventions
- Use present tense, imperative mood: "add feature" not "added feature"
- **No Claude co-author trailers** — do NOT append `Co-Authored-By: Claude ...` (or any Claude variant) to commit messages. Repo policy treats authorship as human-only; AI-assistance is implicit in the workflow and does not get a Git trailer.
- Examples:
  - `feat(auth): add OAuth2 integration`
  - `fix(ui): resolve mobile button alignment`

## Commit Signing

All commits must be both DCO-signed and GPG-signed:

- **DCO sign-off (`--signoff`)** — required by repo policy; validated by the Probot DCO check in CI. The `Signed-off-by: Name <email>` trailer is appended automatically when you pass `--signoff` (or `-s`).
- **GPG signature (`-S`)** — required by repo policy; commits must have a valid GPG signature attached. Configure a signing key once and Git will pick it up for every commit:

  ```bash
  git config --global user.signingkey <KEY_ID>
  git config --global commit.gpgsign true
  ```

Standard commit command:

```bash
git commit --signoff -S -m "<type>(<scope>): <subject>"
```

If signing fails, fix the underlying issue — do not push unsigned commits. To verify signature status on a branch's commits:

```bash
git log --format='%G? %h %s' origin/main..HEAD
```

Acceptable `%G?` codes: `G` (good signature) or `U` (good signature, signing key isn't in your local trust db — fine for policy purposes). Codes `N` (no signature), `B` (bad signature), or `E` (cannot check — e.g., missing public key locally) need investigation. Note that the authoritative GPG check is GitHub's **Verified** badge on each commit after push — if your signing key isn't registered with GitHub, the local check can pass while GitHub still marks the commit as unverified.

## Branch Naming

- Branch names follow commit types followed by the ticket reference — either a JIRA ticket or a GitHub Issue number
- JIRA format: `feat/LFXV2-123` or `ci/LFXV2-456`
- GitHub Issue format: `feat/issue-123` or `ci/issue-456` (the bare issue number from `linuxfoundation/lfx-self-serve`, no repo prefix)
- Use whichever tracker the work is actually filed in — don't create a JIRA ticket just to satisfy branch naming when a GitHub Issue already tracks the work, and vice versa

## PR Titles

- PR titles must follow conventional commit format: `type(scope): description`
- The scope follows the Angular config for conventional commits
- Do not include the ticket reference (JIRA or GitHub Issue) in the title
- Everything should be in lowercase

## PR Size & Focus

- **Target under 1000 lines of diff** — one feature, one bug fix, or one refactor per PR
- **Don't bundle unrelated changes** — keeps reviews focused and rollbacks clean
- PR sizing should be planned upfront during development — see the `/self-serve-dev` skill's "Scope for PR Size" section for detailed guidance on splitting work

## External References

When a PR depends on or relates to work in other repos (e.g., upstream microservice changes), include links in the PR description so reviewers have full context:

- **Upstream API changes** — link to the PR or commit in the microservice repo that adds/modifies the endpoint this PR consumes
- **Related PRs in other repos** — link any PRs that were part of the same feature effort (e.g., a committee-service PR that this frontend PR builds on)
- **Deployed dependencies** — if the PR requires an upstream change to be deployed first, call that out explicitly so reviewers and mergers know the ordering

## Ticket Tracking (JIRA or GitHub Issues)

Before starting any work or commits:

1. **Check if there is a tracking ticket** — always track work, in either the `LFXV2` JIRA project or a GitHub Issue on `linuxfoundation/lfx-self-serve`. Do not use discarded or resolved tickets/issues.
2. **Create a ticket if needed** for untracked work — JIRA for most work; GitHub Issues for issues filed directly on GitHub (e.g. bug reports, epics tracked on the [Kanban board](https://github.com/orgs/linuxfoundation/projects/17)) where a JIRA ticket doesn't already exist. Don't create both for the same piece of work.
3. **Include the ticket reference in the commit message** — `LFXV2-XXX` for JIRA, or for a GitHub Issue either `#XXX` (bare issue number, e.g. `#1331`) or the fully-qualified `org/repo#XXX` path (e.g. `linuxfoundation/lfx-self-serve#1331`) — prefer the fully-qualified path when the ticket isn't in this repo. Both `#XXX` and `org/repo#XXX` auto-link to the issue on GitHub; `GH-XXX` does not. **Put the closing keyword here, not only in the PR body** — this repo squash-merges (no merge commit, no merge queue) with the squash commit body built from the branch's commit messages, so the commit message is where the keyword needs to be for the squash body to carry it at all. When this commit completes the ticket, use the closing form (`Closes #XXX`); otherwise use `Refs #XXX` (see item 4 for how to choose). **Don't mix `Closes #X` and `Refs #X` for the same issue across commits on one branch** — pick one keyword for the whole branch, based on item 4's test; a squash body with both (as in `9755ca68`, which had `Closes #2381` and `Refs #2381` from different commits) is a candidate cause worth ruling in or out for #2392
4. **Link the PR to the ticket** — JIRA ticket link, or for a GitHub Issue, `Closes #XXX` if this PR fully resolves the issue (nobody needs to look at it again once this merges — the normal case for a defect or scoped task) or `Refs #XXX` if it doesn't (one of several PRs against a multi-part issue, a partial fix, or a change that only touches the same area — say what remains in the PR body, so the open state reads as a decision, not an oversight). Use the fully-qualified `org/repo#XXX` form for a ticket in another repo — GitHub does support cross-repo auto-close with this syntax. **Put the same keyword in the commit message too (item 3), not only here.** Neither placement is confirmed reliable on this repo today: PRs #2387, #2389, and #2391 each had GitHub correctly register the closing reference (`closingIssuesReferences` showed the linked issue) — #2387's squash commit even carried `Closes #2381` in its body — and each still failed to auto-close on merge; #2381 needed a manual close 5 minutes after `9755ca68` landed. The cause is open in #2392; don't assume either keyword placement fixes it on its own. Always confirm after the merge lands that the issue actually closed, and close it by hand if it didn't
