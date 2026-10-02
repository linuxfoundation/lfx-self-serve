# Implementation Plan: Adopt Shared Container Image Cleanup

**Branch**: `ci/lfx-self-serve-ops-250` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-shared-ghcr-cleanup/spec.md`

## Summary

Replace the ~220-line local `.github/workflows/ghcr-image-cleanup.yaml` (tag-filter loop, `docker run` of the retention container, log-parsing summary) with a thin caller that keeps this repo's schedule, `workflow_dispatch` inputs and permissions and delegates to the reusable workflow `linuxfoundation/lfx-public-workflows/.github/workflows/ghcr-image-cleanup.yaml`, pinned by full commit SHA. The shared workflow runs the same digest-pinned `snok/container-retention-policy` v3.1.0 image, so retention behavior is preserved; the only inputs that need deliberate values are the protected-tag list (the shared default omits our `!*.*` two-segment release tags) and preview protection (opt-in). Update the two docs that mention registry retention so they point at the caller workflow and the shared workflow's docs. Validate with a manual dry-run on the branch compared against a dry-run of the current workflow on `main`. See [research.md](./research.md) for the decisions and evidence.

## Technical Context

**Language/Version**: GitHub Actions workflow YAML (caller) and Markdown (docs). No application code. The shared workflow's shell/awk logic is owned upstream.

**Primary Dependencies**: `linuxfoundation/lfx-public-workflows` reusable workflow `ghcr-image-cleanup.yaml` (PR #17, merged 2026-09-24), pinned to merge commit `476427e9afb0814cd8534eccc10b0d5ad5e4b9f8`. Transitively the container `ghcr.io/snok/container-retention-policy@sha256:884037f1…b4112` (v3.1.0), identical digest to the one currently pinned locally.

**Storage**: N/A. The state operated on is GHCR package versions of `ghcr.io/linuxfoundation/lfx-self-serve`.

**Testing**: No unit-testable code. Verification is (a) static: `actionlint`/YAML parse and the repo's license-header check; (b) behavioral: manual `workflow_dispatch` dry-runs of the branch and of `main`'s current workflow, comparing candidate sets (FR-013, SC-001, SC-004). See [quickstart.md](./quickstart.md).

**Target Platform**: GitHub-hosted runners (`ubuntu-latest`) via the shared workflow.

**Project Type**: CI configuration / repository docs change in an existing monorepo.

**Performance Goals**: N/A. Weekly run; runtime comparable to today's.

**Constraints**:

- Reference MUST be a full commit SHA that contains the workflow (v0.1.0 does not, see research R1).
- Caller job MUST grant `contents: read`, `packages: write`, `pull-requests: read` and MUST NOT use `secrets: inherit`.
- Manual runs MUST default to dry-run; scheduled runs MUST delete.
- Protected tags MUST remain `development`, `latest`, `*.*.*`, `*.*`, plus per-PR previews for open `deploy-preview` PRs.
- Reusable-workflow jobs cannot request more permission than the caller job grants.

**Scale/Scope**: 1 workflow file rewritten, 2 doc files edited. One package (`lfx-self-serve`).

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template (placeholders such as `[PRINCIPLE_1_NAME]`), so it defines no gates. The repository's documented conventions from `CLAUDE.md` / `.github/copilot-instructions.md` are used as the gate instead:

| Gate                                                                                                   | Status                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| License header + SPDX line on new/changed files                                                        | Pass (kept on workflow; checked by existing `license-header-check.yml`)                                                    |
| Third-party workflow pinned by full SHA, not a moving ref                                              | Pass (`476427e…` with a `# main` annotation, matching the existing helm-chart-oci-publisher pin in `docker-build-tag.yml`) |
| Least-privilege `permissions` on the job; no inherited secrets                                         | Pass                                                                                                                       |
| Docs updated with behavior change (`docs/reviews/docs-checklist.md`); markdown formatted with Prettier | Pass (planned; run `yarn format:check` on the two docs)                                                                    |
| No untrusted input interpolated into `run:` blocks                                                     | Pass (no `run:` blocks remain in the caller; inputs go through `with:`)                                                    |

Re-check after Phase 1 design: no change, no violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-shared-ghcr-cleanup/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── shared-workflow-call.md   # Phase 1 output: caller <-> shared workflow contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
.github/workflows/
└── ghcr-image-cleanup.yaml        # REWRITE: thin caller (schedule + dispatch + `uses:` job)

docs/
├── runbooks/feature-branch-deployment.md   # EDIT: Step 5 retention sentence (line ~127)
└── architecture/deployment.md              # EDIT: "Container Registry" section: add retention paragraph (line ~197)
```

**Structure Decision**: Keep the file name and workflow `name:` so existing links, run history, and `workflow_dispatch` muscle memory continue to work (the file already exists on `main`, which is also what lets a dispatch run the branch version). No new files outside `specs/`. `feat-branch-cleanup.yml` and `docker-build-pr.yml` are untouched.

## Complexity Tracking

No constitution violations to justify.
