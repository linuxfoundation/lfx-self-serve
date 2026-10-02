# Feature Specification: Adopt Shared Container Image Cleanup

**Feature Branch**: `ci/lfx-self-serve-ops-250`
**Created**: 2026-10-01
**Status**: Draft
**Input**: User description: "We recently added a stand-alone GitHub action for cleaning up old GitHub container registry entries. This is working great. Then, we decided to move this functionality to a common GitHub action in the linuxfoundation/lfx-public-workflows repository as part of lfx-public-workflows#17. Now we're ready to leverage this new common GitHub action. The task is to replace our local container registry cleanup action and support logic/instruction with the common shared GitHub action."

Spec-kit directory name and git branch are independent.

## Background _(why this exists)_

Self Serve publishes a container image to the GitHub Container Registry (`ghcr.io/linuxfoundation/lfx-self-serve`) on every build, including one per deploy-preview pull request. Without pruning, the registry accumulates unbounded stale versions. A weekly scheduled workflow in this repository (`.github/workflows/ghcr-image-cleanup.yaml`, added in #2736) currently prunes them. It works well, but it carries about 220 lines of tag-filter construction, container invocation, log parsing, and summary logic that is owned and maintained here alone.

That logic has since been generalized and merged into the shared, public `linuxfoundation/lfx-public-workflows` repository (PR #17, merged 2026-09-24) as a reusable workflow. The shared version is the same retention behavior packaged for any LFX repository, and its upstream documentation names Self Serve as the reference case for "with deploy-preview protection". It also lists "migrating `lfx-self-serve` … to call this shared workflow" as an explicit follow-on.

This feature is that migration: Self Serve keeps its schedule, manual trigger, and retention outcome, and stops owning the cleanup mechanics.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Weekly cleanup keeps working with the same protections (Priority: P1)

A Self Serve maintainer relies on the weekly cleanup to prune stale images without ever deleting an image that is still needed. After the migration, the scheduled run delegates to the shared workflow and produces the same retention outcome as today.

**Why this priority**: This is the production behavior. A regression here either lets the registry grow again (cleanup silently stops) or, far worse, deletes a release image or a live preview image. Everything else is secondary.

**Independent Test**: Trigger the migrated workflow manually in dry-run mode against the real package and compare the candidate list with a dry-run of the current local workflow run at the same time. The two candidate sets are identical (or differ only by versions the shared workflow additionally protects, see Story 3).

**Acceptance Scenarios**:

1. **Given** the weekly schedule fires, **When** the cleanup runs, **Then** untagged and tagged versions of the `lfx-self-serve` package older than 30 days and carrying no protected tag are deleted, and nothing else is.
2. **Given** a version carries a release tag in either three-segment (`1.2.3`) or two-segment (`1.2`) form, `latest`, or `development`, **When** the cleanup runs, **Then** that version is never deleted regardless of age.
3. **Given** an open pull request carries the `deploy-preview` label and its image is tagged `ui-pr-<N>`, **When** the cleanup runs, **Then** that image is not deleted even if it is older than the cut-off.
4. **Given** a pull request was closed or lost its `deploy-preview` label, **When** its `ui-pr-<N>` image is older than the cut-off, **Then** the image is eligible for deletion.
5. **Given** a multi-arch image whose parent manifest is retained, **When** the cleanup runs, **Then** its child manifests are not deleted.

---

### User Story 2 - Maintainers can still preview and tune a manual run (Priority: P1)

A maintainer who wants to see what a cleanup would remove (or to use a shorter or longer cut-off) can start a run by hand, defaulting to a safe preview, exactly as they can today.

**Why this priority**: Dry-run-by-default for manual runs is the safety valve that lets maintainers trust the scheduled delete. Losing it would make the migration unsafe to ship.

**Independent Test**: Start a manual run with defaults and confirm no version is deleted and the job summary lists would-delete candidates. Start another with dry-run off and a different cut-off and confirm the cut-off is honored.

**Acceptance Scenarios**:

1. **Given** a manual run with default inputs, **When** it completes, **Then** nothing is deleted, the summary shows the number of versions that would be deleted, and the cut-off shown is 30 days.
2. **Given** a manual run with a custom cut-off (e.g. `14d`) and dry-run turned off, **When** it completes, **Then** only versions older than 14 days with no protected tag are deleted.
3. **Given** a scheduled run, **When** it executes, **Then** it deletes (dry-run is not applied) regardless of any manual-input default.

---

### User Story 3 - One maintained implementation, no local copy to drift (Priority: P2)

A Self Serve maintainer, and the maintainers of other LFX repositories using the shared workflow, no longer have to carry or review duplicated cleanup logic. Fixes and hardening land once in the shared repository and are adopted here by bumping a pinned reference.

**Why this priority**: This is the reason for the change, but it delivers value only once Story 1 and 2 are safe.

**Independent Test**: Inspect the repository after the change: the local cleanup workflow contains only triggers, permissions, inputs, and a single call to the shared workflow; no container invocation, tag-filter loop, or log-parsing code remains anywhere in the repository.

**Acceptance Scenarios**:

1. **Given** the migration is merged, **When** a maintainer reads the cleanup workflow, **Then** it consists of the schedule, the manual trigger and its inputs, the permissions needed, and one reference to the shared workflow pinned to a full commit SHA.
2. **Given** the shared workflow gains a fix, **When** a maintainer wants it, **Then** adopting it requires changing only the pinned reference (and reviewing the upstream change), not re-porting logic.
3. **Given** the shared workflow additionally protects the repository's default-branch tag, **When** the cleanup runs, **Then** that extra protection applies without any local configuration.

---

### User Story 4 - Failures remain visible (Priority: P2)

When a deletion fails (permissions, API error), the maintainer finds out from the run result and summary rather than from the registry silently growing.

**Why this priority**: Current behavior fails the run when any deletion fails; losing that makes the automation unobservable.

**Independent Test**: Review a run's job summary: it shows trigger, dry-run state, cut-off, selected/protected counts, deleted or would-delete count, and failed count. A run with failures is marked failed.

**Acceptance Scenarios**:

1. **Given** any version deletion fails, **When** the run finishes, **Then** the run is reported as failed and the failure count appears in the summary.
2. **Given** discovery of open preview pull requests fails, **When** the run proceeds, **Then** no deletion happens (previews are never deleted without their protection filters).
3. **Given** the run is cancelled, **When** cancellation occurs, **Then** no deletion is started afterwards.

---

### Edge Cases

- **Two-segment release tags**: Self Serve publishes release images without a `v` prefix, including two-segment tags. The shared workflow's default protection does not cover two-segment tags, so the protected-tag list MUST be set explicitly to preserve current protection rather than relying on the default.
- **Preview-protection permission**: Reading open pull requests needs an additional read permission on the calling job. Missing it must not silently disable preview protection.
- **Package access**: Package deletion by the repository token requires the package to be linked to (or granted admin for) this repository. This is satisfied today; the migration must not change which token or package it targets.
- **Repository with a non-`development` default branch**: Self Serve's default branch is `main`. The shared workflow adds the default-branch name as a protected tag; a `main`-tagged image (if any) is therefore protected in addition to today's set. This is an additional protection, not a regression.
- **Reference goes stale or is moved**: The shared workflow MUST be referenced by an immutable full commit SHA from a commit that actually contains the workflow; a moving reference such as a branch name is not acceptable for a workflow that can delete packages.
- **Boolean manual input**: Manual trigger inputs arrive as text in some contexts; the dry-run value MUST be interpreted so that an unset or default input results in a preview, never a delete, on non-scheduled triggers.
- **Rollback**: If the shared workflow misbehaves, reverting the single migration change MUST restore the previous local behavior.
- **Weekly run overlaps the migration merge**: A scheduled run that fires between merge and first verification must behave safely; the first post-merge validation is a manual dry-run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST run its weekly (Sundays 00:00 UTC) and manual container image cleanup by calling the shared cleanup workflow from `linuxfoundation/lfx-public-workflows`, not by local cleanup logic.
- **FR-002**: The shared workflow reference MUST be pinned to a full commit SHA of `lfx-public-workflows` whose tree contains the shared cleanup workflow, annotated with a human-readable version or origin comment.
- **FR-003**: The cleanup MUST target exactly the `lfx-self-serve` package under the `linuxfoundation` account, and MUST NOT be able to target any other package.
- **FR-004**: The retention cut-off MUST default to 30 days and MUST remain adjustable via the manual trigger.
- **FR-005**: Scheduled runs MUST delete eligible versions; manual runs MUST default to a dry-run that deletes nothing and MUST allow the maintainer to turn dry-run off explicitly.
- **FR-006**: The protected-tag set MUST include `development`, `latest`, three-segment release tags, and two-segment release tags, preserving today's protection exactly (the shared default is not sufficient and MUST be overridden).
- **FR-007**: Preview-image protection MUST be enabled so that images tagged `ui-pr-<N>` for pull requests that are still open and labeled `deploy-preview` are never deleted, while images for closed or unlabeled pull requests older than the cut-off remain eligible.
- **FR-008**: The calling job MUST declare the minimum permissions required (package write; pull-request read for preview protection) and MUST NOT pass inherited secrets to the shared workflow.
- **FR-009**: The run MUST produce a human-readable summary (trigger, dry-run state, cut-off, selected/protected/would-delete/deleted/failed counts) and MUST fail the run when any deletion fails.
- **FR-010**: The local cleanup mechanics (container invocation, tag-filter construction, log capture and parsing, summary generation, and their explanatory comments) MUST be removed from this repository; the local workflow file MUST retain only triggers, inputs, permissions, and the call.
- **FR-011**: Documentation in this repository that describes registry retention (including the statement that `ui-pr-<N>` images remain in GHCR "subject to the registry's retention policy") MUST accurately describe the new arrangement and point to where the policy is defined (the local caller workflow and the shared workflow's documentation).
- **FR-012**: The workflow file MUST keep the repository's license-header and YAML conventions and pass the repository's existing lint and license-header checks.
- **FR-013**: The migration MUST be validated before the first scheduled run relies on it, by a manual dry-run whose candidate set is compared with the pre-migration behavior.

### Key Entities

- **Container image version**: One entry in the `lfx-self-serve` package, identified by a version ID, carrying zero or more tags and an age. Eligible for deletion only when older than the cut-off and carrying no protected tag.
- **Protected tag pattern**: A tag form that shields any version carrying it (release, `latest`, `development`, default-branch name, per-PR preview of an open labeled PR).
- **Deploy-preview pull request**: An open pull request carrying the `deploy-preview` label; its `ui-pr-<N>` image is live and must be retained.
- **Caller workflow**: The thin repository-owned workflow that owns triggers, inputs, and permissions and delegates to the shared workflow.
- **Shared cleanup workflow**: The reusable workflow in `lfx-public-workflows` that owns selection, deletion, safeguards, and summary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A dry-run of the migrated cleanup against the real registry nominates the same set of versions as a dry-run of the pre-migration cleanup, except for versions the shared workflow additionally protects; zero protected release, `latest`, `development`, or open-preview versions appear as candidates.
- **SC-002**: The repository's cleanup definition shrinks from roughly 220 lines of bespoke logic to a short caller definition (target: under 75 lines including license header and explanatory comments), with zero lines of container-invocation, tag-filter, or log-parsing logic remaining.
- **SC-003**: The first scheduled run after merge completes successfully and the registry's stale-version count does not increase relative to the pre-migration weekly trend.
- **SC-004**: 100% of manual runs started with default inputs delete nothing.
- **SC-005**: A maintainer can find where registry retention is defined and how to adjust it from the repository documentation within one navigation hop from the deployment runbook.
- **SC-006**: Adopting a future fix to the cleanup requires changing a single pinned reference and no re-implementation, as demonstrated by the absence of local cleanup logic.

## Assumptions

- The shared workflow behaves as documented upstream (`docs/ghcr-image-cleanup/` in `lfx-public-workflows`): it runs the same digest-pinned retention tool as the current local workflow, defaults manual runs to dry-run, forces scheduled runs to delete, and exposes inputs for package name, account, cut-off, protected tags, dry-run, and preview protection.
- The latest release tag of `lfx-public-workflows` (`v0.1.0`) pre-dates the shared cleanup workflow, so it cannot be used as the pin. The pin will instead be a full SHA of a `main` commit that contains the workflow (the merge commit of PR #17 or a later commit), annotated as such.
- Other workflows in this repository already pin `lfx-public-workflows` by full SHA (e.g. the Helm chart publisher); the same convention is followed here. The existing license-header workflow's `@main` reference is out of scope.
- Self Serve's repository token continues to have admin access to the `lfx-self-serve` package, as it does today; no new package-access setup is required.
- The repository's default branch is `main`. The additional protection of the default-branch tag by the shared workflow is accepted.
- The scheduled cadence (weekly, Sundays 00:00 UTC), 30-day default cut-off, and the `deploy-preview` label / `ui-pr-` tag scheme are unchanged.
- Minor differences in summary wording between the old local summary and the shared summary are acceptable as long as the same facts are conveyed (FR-009).
- The sibling `feat-branch-cleanup.yml` workflow (branch-deletion image removal, currently disabled) is a different mechanism and is out of scope.
- Migrating other repositories (e.g. `lfx-v2-campaign-service`) is out of scope.
