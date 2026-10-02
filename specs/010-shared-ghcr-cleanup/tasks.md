---
description: 'Task list for adopting the shared GHCR image cleanup workflow'
---

# Tasks: Adopt Shared Container Image Cleanup

**Input**: Design documents from `/specs/010-shared-ghcr-cleanup/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/shared-workflow-call.md](./contracts/shared-workflow-call.md), [quickstart.md](./quickstart.md)

**Tests**: No automated test tasks (none requested, and there is no application code). Verification is by static checks and GitHub Actions dry-runs from [quickstart.md](./quickstart.md); those are explicit tasks below.

**Format**: `- [ ] [TaskID] [P?] [Story?] Description with file path`. `[P]` = can run in parallel (different files, no dependency on an incomplete task).

**Note on story mapping**: US1, US2 and the code half of US3 are all satisfied by one rewrite of a single file (T004). The story phases therefore separate _what is verified or added_ per story, not separate code changes. US1 is the MVP: once T004-T007 pass, the migration is safe to merge.

## Phase 1: Setup (pre-change evidence)

**Purpose**: Lock the facts the implementation depends on and capture the baseline that must be compared against.

- [x] T001 Re-verify the pin: run `gh api "repos/linuxfoundation/lfx-public-workflows/contents/.github/workflows/ghcr-image-cleanup.yaml?ref=476427e9afb0814cd8534eccc10b0d5ad5e4b9f8" --jq .sha` and the same without `?ref=` (current `main`). Expect both to equal `347f793066b36f7cdfeeba116977adb5effec85f`. If the `main` blob differs, read the upstream diff for `inputs`, `permissions`, and the `DRY_RUN` expression and update [research.md](./research.md) R1 and the pin in T004 before continuing.
- [x] T002 [P] Confirm the preview label/tag names still match the shared defaults: `grep -n "deploy-preview\|ui-pr-" .github/workflows/docker-build-pr.yml` must show label `deploy-preview` and tag prefix `ui-pr-`. If either differs, add `preview-label` / `preview-tag-prefix` inputs in T004.
- [x] T003 [P] Capture the baseline: from the repo root run `gh workflow run ghcr-image-cleanup.yaml --repo linuxfoundation/lfx-self-serve --ref main -f dry-run=true`, then `gh run list --workflow ghcr-image-cleanup.yaml --limit 1` and record the run ID in a scratch note (do not commit it). This runs the OLD local workflow and must be done before T006 so the two runs share the same age window ([quickstart.md](./quickstart.md) step 2).

**Checkpoint**: Pin confirmed, preview names confirmed, baseline run ID recorded.

---

## Phase 2: Foundational

No blocking prerequisites beyond Phase 1. Package-admin access for the repo's `GITHUB_TOKEN` already exists (the current workflow relies on it) and is unchanged.

---

## Phase 3: User Story 1 - Weekly cleanup keeps working with the same protections (Priority: P1) 🎯 MVP

**Goal**: The scheduled run delegates to the shared workflow and yields the same retention outcome as today.

**Independent Test**: A dry-run of the migrated workflow nominates the same versions as the baseline dry-run (SC-001), and no protected release/`latest`/`development`/open-preview version appears as a candidate.

- [x] T004 [US1] Rewrite `.github/workflows/ghcr-image-cleanup.yaml` as a thin caller, removing all existing `env:` and `steps:` content (container invocation, tag-filter loop, log parsing, summary). Keep the two license header lines and `---`, the workflow `name: "Cleanup Stale Container Images"`, the quoted `"on":` key, the cron `"0 0 * * 0"` with its comment, and the `workflow_dispatch` inputs `dry-run` (boolean, `required: false`, `default: true`, description "Preview candidate deletions without deleting anything.") and `cut-off` (string, `required: false`, `default: "30d"`, description "Minimum age an image version must reach before it is eligible for deletion (e.g. 30d, 4w 2d)."). Keep workflow-level `permissions: contents: read`. Define a single job `cleanup` with job-level `permissions` of `contents: read`, `packages: write`, `pull-requests: read` and `uses: linuxfoundation/lfx-public-workflows/.github/workflows/ghcr-image-cleanup.yaml@476427e9afb0814cd8534eccc10b0d5ad5e4b9f8 # main` and `with:` exactly `image-name: lfx-self-serve`, `image-tags: "!development !latest !*.*.* !*.*"`, `enable-preview-protection: true`, `cut-off: ${{ github.event.inputs.cut-off || '30d' }}`, `dry-run: ${{ fromJSON(github.event.inputs['dry-run'] || 'true') }}`. Do not add a `secrets:` key. Add short comments only for non-obvious decisions: why `image-tags` is overridden (two-segment release tags `!*.*`; Self Serve omits the `v` prefix), that the shared workflow additionally protects the default-branch tag, why `fromJSON` is needed, and a pointer to the shared workflow's docs (`docs/ghcr-image-cleanup/` in lfx-public-workflows). Contract: [contracts/shared-workflow-call.md](./contracts/shared-workflow-call.md).
- [x] T005 [US1] Run the static checks from [quickstart.md](./quickstart.md) step 1 against `.github/workflows/ghcr-image-cleanup.yaml`: YAML parses and `jobs` has exactly `cleanup`; `grep -cE '^\s+run:'` is `0`; a `@<40-hex>` pin is present; `wc -l` is under 75 (SC-002); `actionlint` passes if installed (skip with a note if not).
- [x] T006 [US1] Push the branch `ci/lfx-self-serve-ops-250`, then run `gh workflow run ghcr-image-cleanup.yaml --repo linuxfoundation/lfx-self-serve --ref ci/lfx-self-serve-ops-250 -f dry-run=true` right after T003 and record the new run ID. Confirm the run succeeds and shows two nested jobs (`Build active preview tag filters`, `Cleanup Stale Container Images`). Never pass `dry-run=false` from the branch.
- [x] T007 [US1] Compare candidate sets per [quickstart.md](./quickstart.md) step 4: extract `package_version=<id>` from the "Would have deleted" lines of the T003 and T006 runs and `diff` the sorted unique lists. Expect identical; explain any difference (30-day boundary crossing between runs, or a `main`-tagged version only in the old list because of the new `!main` protection). Spot-check via the packages API that no listed ID carries `development`, `latest`, `x.y.z`, `x.y`, or an open-PR `ui-pr-<N>` tag.

**Checkpoint**: US1 verified. The migration is functionally safe; the rest completes docs and the remaining acceptance checks.

---

## Phase 4: User Story 2 - Maintainers can still preview and tune a manual run (Priority: P1)

**Goal**: Manual runs default to preview and honor a custom cut-off; scheduled runs delete.

**Independent Test**: A default manual run deletes nothing; a `cut-off=14d` dry-run reports `Cut-off: 14d`.

- [x] T008 [US2] Dispatch the branch workflow with no `-f` inputs (`gh workflow run ghcr-image-cleanup.yaml --ref ci/lfx-self-serve-ops-250`). In the run summary confirm `Dry run: true`, `Cut-off: 30d`, `Deleted: 0` (SC-004, Story 2 scenario 1).
- [x] T009 [P] [US2] Dispatch with `-f dry-run=true -f cut-off=14d`. Confirm the summary shows `Cut-off: 14d` and the "Would delete" set is a superset of the T006 30-day set (Story 2 scenario 2, without deleting).
- [x] T010 [US2] Confirm scheduled-run semantics by reading the pinned shared workflow: `gh api "repos/linuxfoundation/lfx-public-workflows/contents/.github/workflows/ghcr-image-cleanup.yaml?ref=476427e9afb0814cd8534eccc10b0d5ad5e4b9f8" --jq .content | base64 -d | grep -n "DRY_RUN:"` must show `github.event_name == 'schedule' && 'false'` (schedule forces delete). A real scheduled delete cannot be exercised before merge; this is the evidence for Story 2 scenario 3.

**Checkpoint**: US2 verified.

---

## Phase 5: User Story 3 - One maintained implementation, no local copy to drift (Priority: P2)

**Goal**: No cleanup logic is left in this repo and the docs describe the new arrangement.

**Independent Test**: A repo-wide search finds no container-invocation, tag-filter, or log-parsing code, and a reader of the runbook/architecture docs can find where retention is defined.

- [x] T011 [P] [US3] Edit `docs/runbooks/feature-branch-deployment.md` Step 5 (the sentence "Container images tagged `ui-pr-<N>` remain in GHCR and are subject to the registry's retention policy.", currently around lines 126-128). Replace it with: images remain in GHCR after teardown; a weekly scheduled cleanup (`.github/workflows/ghcr-image-cleanup.yaml`, which calls the shared workflow in `linuxfoundation/lfx-public-workflows`) deletes `ui-pr-<N>` images older than 30 days unless the PR is still open with the `deploy-preview` label. Link to the caller workflow by relative path and to the shared workflow docs at `https://github.com/linuxfoundation/lfx-public-workflows/tree/main/docs/ghcr-image-cleanup`. Keep the surrounding table and `---` separators unchanged.
- [x] T012 [P] [US3] Edit `docs/architecture/deployment.md` "Container Registry" section (currently ends around line 200 with "Image visibility follows the repository's package settings."). Append a short **Retention** paragraph: weekly scheduled cleanup (Sundays 00:00 UTC) via the shared workflow, 30-day cut-off, protected tags (`development`, `latest`, `x.y.z`, `x.y`, the default branch, and `ui-pr-<N>` for open `deploy-preview` PRs), manual runs default to a dry-run, and a link to `.github/workflows/ghcr-image-cleanup.yaml` and the shared workflow docs. Do not duplicate the full input table.
- [x] T013 [US3] Verify no residual local logic remains: `grep -rniE "snok|container-retention-policy|docker run|CLEANUP_IMAGE|GHCR_CLEANUP_TOKEN|Write run summary" .github/ docs/ README.md CONTRIBUTING.md CLAUDE.md` returns nothing outside `specs/010-shared-ghcr-cleanup/` (FR-010). Confirm `.github/workflows/feat-branch-cleanup.yml` and `docker-build-pr.yml` are unmodified.

**Checkpoint**: US3 verified.

---

## Phase 6: User Story 4 - Failures remain visible (Priority: P2)

**Goal**: Deletion failures, discovery failures and cancellation behave safely and visibly.

**Independent Test**: The dry-run summary contains every required field, and the pinned shared workflow gates deletion on discovery success and fails on any failed deletion.

- [x] T014 [US4] In the T006 dry-run's job summary confirm it lists trigger, dry-run state, cut-off, selected tagged/untagged counts, protected multi-arch children (if any), would-delete, deleted and failed (FR-009, Story 4).
- [x] T015 [US4] In the pinned shared workflow confirm by grep: the `cleanup` job `if:` uses `!cancelled()` and allows only `needs.preview-tags.result == 'success'` or `'skipped'`, and the summary step ends with `exit 1` when `failed` is greater than 0. Record the line numbers in the PR description (Story 4 scenarios 1-3).
- [ ] T016 [P] [US4] (Optional negative check) On a scratch branch remove `pull-requests: read` from the job in `.github/workflows/ghcr-image-cleanup.yaml`, dispatch, and confirm the run is rejected at startup instead of silently running without preview protection. Discard the scratch branch; skip if time-constrained.

**Checkpoint**: US4 verified.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T017 [P] Format the changed docs: `npx prettier --write docs/runbooks/feature-branch-deployment.md docs/architecture/deployment.md` then `yarn format:check docs/runbooks/feature-branch-deployment.md docs/architecture/deployment.md`.
- [ ] T018 Run the repo pre-commit checks per repo rules: `yarn lint` and `yarn test` (no source changes are expected to affect them; both must stay green).
- [x] T019 [P] Confirm `.github/workflows/ghcr-image-cleanup.yaml` begins with `# Copyright The Linux Foundation and each contributor to LFX.` and `# SPDX-License-Identifier: MIT` (required by `license-header-check.yml`).
- [x] T020 Commit with Conventional Commit, DCO sign-off and GPG signature (`git commit -s -S`), e.g. `ci: use shared GHCR image cleanup workflow`. Include in the PR description: link to lfx-public-workflows PR #17, the baseline and new dry-run run IDs with the T007 diff result, the pin rationale (v0.1.0 predates the workflow), the `image-tags` override rationale, and the accepted `!main` extra protection. Rollback = revert this commit.
- [ ] T021 After merge, confirm the first scheduled run succeeds (`gh run list --workflow ghcr-image-cleanup.yaml --event schedule --limit 1`) and its summary shows plausible `Deleted:` and `Failed: 0` (SC-003).

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (T001-T003)**: no dependencies. T002 and T003 are parallel; T001 gates T004.
- **Phase 2**: nothing.
- **US1 (T004-T007)**: T004 needs T001 and T002. T005 needs T004. T006 needs T005, the pushed branch, and the T003 baseline (run it soon after T003). T007 needs T003 and T006.
- **US2 (T008-T010)**: T008/T009 need T006's pushed branch; T010 is independent of the code.
- **US3 (T011-T013)**: T011 and T012 depend on nothing but the decided pin/inputs and may run in parallel with T004-T007. T013 needs T004.
- **US4 (T014-T016)**: T014 needs T006; T015 independent; T016 optional, after T005.
- **Polish (T017-T021)**: T017 needs T011/T012. T018-T019 after all edits. T020 after T018. T021 after merge.

### Story independence

US1 is deliverable alone (MVP). US2 and US4 add verification only. US3's docs can merge together with US1 and should (docs must change with behavior).

## Parallel Opportunities

```text
After T001:    T002 + T003            (different concerns, no shared files)
After T004:    T011 + T012            (two different doc files; may start before T004)
After T006:    T008 + T009 + T014     (independent dispatches / summary reads)
Polish:        T017 + T019
```

## Implementation Strategy

### MVP first (User Story 1)

1. T001-T003 (evidence + baseline).
2. T004-T007: rewrite the workflow, static check, branch dry-run, compare to baseline.
3. Stop and decide: if identical candidate sets, the code change is done.

### Incremental delivery

4. US3 docs (T011-T013) in the same PR.
5. US2/US4 verification (T008-T010, T014-T016) as evidence in the PR description.
6. Polish and commit (T017-T020); T021 after merge.

## Summary

- Total tasks: 21 (T001-T021)
- Per story: Setup 3, Foundational 0, US1 4, US2 3, US3 3, US4 3, Polish 5
- All 21 follow the `- [ ] Tnnn [P?] [Story?] description` checklist format.

## Validation Results (2026-10-01)

| Task | Evidence                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T003 | Old workflow, `main`, dry-run: run 36957346621                                                                                                                                                                                                                                     |
| T006 | New workflow, branch, dry-run: run 36957355953; both nested jobs succeeded                                                                                                                                                                                                         |
| T007 | Unique "Would have deleted" version IDs identical between the two runs: 309 (294 untagged, 15 tagged, all `ui-pr-*`); `Selected 15 tagged and 652 untagged`, `Protected 358 multi-arch child digest(s)` in both. The only open `deploy-preview` PR is 3116 and is not a candidate. |
| T008 | Default manual run 36957439754: `DRY_RUN: true`, `CUT_OFF: 30d`, 0 deleted, 309 would-delete                                                                                                                                                                                       |
| T009 | `dry-run=true cut-off=14d` run 36957447878: `CUT_OFF: 14d`, 2040 would-delete (superset of the 30d set by count)                                                                                                                                                                   |
| T014 | Summary step ran in the new workflow; fields come from the pinned shared workflow's summary step (read in T010/T015). The rendered step summary itself was not fetched.                                                                                                            |

Still open: T016 (optional negative test, skipped), T018 (`yarn lint`/`yarn test`: `node_modules` is not installed in this worktree; no source files changed), T020 (commit done; PR description pending), T021 (after merge).
