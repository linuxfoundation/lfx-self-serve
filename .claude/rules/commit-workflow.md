---
description: Commit conventions, branch naming, PR format, PR size guidelines, sign-off + GPG signing, and ticket tracking workflow (GitHub Issues)
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

- Branch names follow commit types followed by the GitHub Issue number
- Format: `feat/issue-123` or `ci/issue-456` (the bare issue number from `linuxfoundation/lfx-self-serve`, no repo prefix)
- GitHub Issue in another repo: `feat/lfx-mentorship-123` — the repo name followed by the issue number, so the branch says which tracker to look in

## PR Titles

- PR titles must follow conventional commit format: `type(scope): description`
- The scope follows the Angular config for conventional commits
- Do not include the GitHub Issue reference in the title
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

## Ticket Tracking (GitHub Issues)

Before starting any work or commits:

1. **Check if there is a tracking issue** — always track work in a GitHub Issue on `linuxfoundation/lfx-self-serve`, or a GitHub Issue in the sibling product repo that owns the feature. Do not use closed or stale issues.
   - Work on another product's feature that lands in this repo stays tracked in that product's repo — e.g. Mentorship work is tracked on [`linuxfoundation/lfx-mentorship`](https://github.com/linuxfoundation/lfx-mentorship/issues). Reference that issue rather than duplicating it here.
2. **Create an issue if needed** for untracked work — file a GitHub Issue. Do not create Jira tickets; the team uses GitHub Issues exclusively.
3. **Include the issue reference in the commit message** — `#XXX` (bare issue number, e.g. `#1331`) or the fully-qualified `org/repo#XXX` path (e.g. `linuxfoundation/lfx-mentorship#123`) — prefer the fully-qualified path when the issue isn't in this repo. Both `#XXX` and `org/repo#XXX` auto-link to the issue on GitHub; `GH-XXX` does not.
4. **Link the PR to the issue** — `Closes #XXX` / `Refs #XXX` (or the fully-qualified `org/repo#XXX` form for an issue in another repo) in the PR body. Prefer `Refs` over a closing keyword for a ticket in another repo, since a closing keyword closes that repo's issue on merge.
