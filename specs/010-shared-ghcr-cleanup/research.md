# Research: Adopt Shared Container Image Cleanup

All unknowns from the plan are resolved below. Evidence was read directly from `linuxfoundation/lfx-public-workflows` (`gh api`) on 2026-10-01 and from this repo.

## R1 - Which commit to pin

- **Decision**: `476427e9afb0814cd8534eccc10b0d5ad5e4b9f8` (merge commit of lfx-public-workflows PR #17, 2026-09-24T02:42:04Z), annotated `# main`.
- **Evidence**: The only release tag, `v0.1.0` (`a93335d…`), is _behind_ `476427e` and `contents/.github/workflows/ghcr-image-cleanup.yaml?ref=a93335d…` returns 404, so the tag cannot be used. The workflow blob SHA is identical (`347f7930…`) at `476427e` and at current `main` (`9531d85…`); the three later commits touch only `.cspell.json`, `.yamllint.yml`, other workflows, `helm-chart-oci-publisher`, README/AGENTS/SECURITY docs.
- **Rationale**: The merge commit is the earliest main commit with the reviewed content; the workflow is byte-identical to HEAD, so there is no reason to prefer a later SHA. Existing pin convention in this repo (`docker-build-tag.yml`: `@17e4144… # main`) is followed.
- **Alternatives considered**: `@main` (rejected: moving ref on a workflow that deletes packages; spec FR-002); `@v0.1.0` (rejected: does not contain the workflow); current `main` HEAD `9531d85` (equivalent for this file, but pulls in unrelated upstream churn into the diff reviewers see).
- **Follow-up for implementer**: before committing, re-verify `ghcr-image-cleanup.yaml` blob SHA at the chosen pin still equals the latest `main` blob; if upstream has changed it, re-read the diff and pick the newest reviewed SHA.

## R2 - Protected-tag list (`image-tags`)

- **Decision**: Pass `image-tags: "!development !latest !*.*.* !*.*"` explicitly, identical to the local base filter and to the upstream `usage.md` Self Serve example.
- **Rationale**: Shared default is `!latest !development !v* !*.*.*`. It lacks `!*.*` (Self Serve publishes two-segment release tags without a `v`) and adds `!v*` (harmless, no such tags here). Relying on the default would silently make two-segment release images deletable (spec FR-006, Edge Cases).
- **Additional effect**: The shared workflow always appends the caller's default branch as `!main`. This is added protection, accepted in the spec.
- **Alternatives considered**: Use the default (rejected, loses `!*.*`); add `!v*` as well (rejected, no behavior need and diverges from the upstream Self Serve example).

## R3 - Preview protection

- **Decision**: `enable-preview-protection: true`; leave `preview-label` (`deploy-preview`) and `preview-tag-prefix` (`ui-pr-`) at defaults, which equal the values hard-coded in the current local workflow and in `docker-build-pr.yml`.
- **Evidence**: Upstream builds `!ui-pr-<N>` for every open PR carrying the label in a separate `preview-tags` job (`gh api --paginate`, so no 1000-PR cap as in local `gh pr list --limit 1000`). The `cleanup` job only runs when that job `success`es or is `skipped`, and uses `!cancelled()`, so a discovery failure means no deletion and cancellation does not start a delete (spec Story 4 scenarios 2-3).
- **Verify**: `grep -n "deploy-preview\|ui-pr-" .github/workflows/docker-build-pr.yml` during implementation to confirm label/tag names still match the defaults.

## R4 - Dry-run semantics and the `dry-run` input expression

- **Decision**: In the caller, `dry-run: ${{ fromJSON(github.event.inputs['dry-run'] || 'true') }}` (the upstream documented form), `cut-off: ${{ github.event.inputs.cut-off || '30d' }}`.
- **Evidence**: Shared workflow computes `DRY_RUN: ${{ github.event_name == 'schedule' && 'false' || inputs.dry-run && 'true' || 'false' }}`. `github.event_name` inside a reusable workflow is the caller's event, so schedule => delete; dispatch => honors the boolean. On `schedule`, `github.event.inputs` is null, so the expression falls back to `'true'` -> `fromJSON` -> `true`; that value is ignored by the shared workflow for schedule runs, so the net behavior (schedule deletes, manual defaults to preview) matches today's (FR-005, SC-004). `fromJSON` is needed because `github.event.inputs.*` booleans are strings.
- **Alternatives considered**: `inputs.dry-run` context directly (rejected: it is not populated for `schedule`, risks a type error for a required boolean `with:` value; upstream docs use the `github.event.inputs` form).

## R5 - Permissions

- **Decision**: Job-level on the `uses:` job: `contents: read`, `packages: write`, `pull-requests: read`. Keep workflow-level `permissions: contents: read`.
- **Evidence**: Shared `preview-tags` job requests `pull-requests: read`; shared `cleanup` job requests `packages: write`; shared top-level requests `contents: read`. A called job can only narrow the caller's token, so the caller must grant the union. No `secrets:` block exists upstream; the caller must not use `secrets: inherit`.
- **Package-admin prerequisite**: Deleting versions with `GITHUB_TOKEN` additionally requires this repo to have admin on the `lfx-self-serve` package. The current local workflow already relies on this and the token is still this repo's own `GITHUB_TOKEN`, so nothing changes.

## R6 - Triggers, name, and file location

- **Decision**: Keep `.github/workflows/ghcr-image-cleanup.yaml`, workflow `name: "Cleanup Stale Container Images"`, cron `0 0 * * 0`, and the `dry-run` (default true) and `cut-off` (default `30d`) dispatch inputs. Caller job id `cleanup`.
- **Rationale**: Same file on `main` is what lets a `workflow_dispatch --ref <branch>` run the branch's version for validation; preserving the name preserves run history and links. Reusable workflows cannot define their own schedule, so the triggers must stay local (upstream overview.md).

## R7 - Behavior differences accepted

| Aspect                             | Local today               | Shared                                                | Impact                           |
| ---------------------------------- | ------------------------- | ----------------------------------------------------- | -------------------------------- |
| Default-branch tag                 | not protected             | `!main` always added                                  | Extra protection only            |
| Open-PR enumeration                | `gh pr list --limit 1000` | `gh api --paginate`                                   | Removes cap                      |
| Failed-count counting              | may double-count a line   | per-line guard                                        | More accurate count              |
| `account=user` support / owner env | n/a                       | forwarded                                             | Unused here                      |
| Input validation                   | none                      | rejects wildcard/list/quote/CRLF                      | `lfx-self-serve` passes          |
| Summary text                       | local format              | same section/lines (copy of local)                    | Equivalent facts                 |
| Outputs                            | none                      | `deleted-count`, `would-delete-count`, `failed-count` | Unused (could be surfaced later) |

No regressions identified. Container image digest is the same (`sha256:884037f1…b4112`).

## R8 - Docs to update (support instruction)

- `docs/runbooks/feature-branch-deployment.md` Step 5 (lines 126-128): "…remain in GHCR and are subject to the registry's retention policy." -> state that a weekly scheduled cleanup deletes `ui-pr-<N>` images older than 30 days unless the PR is still open and labeled `deploy-preview`, linking to the caller workflow and the shared workflow docs.
- `docs/architecture/deployment.md` "Container Registry" (lines ~197-200): add a short **Retention** paragraph: weekly shared cleanup, 30-day cut-off, protected tags, manual dry-run, shared workflow reference.
- No other file in the repo mentions `snok`, `container-retention-policy`, or the local cleanup (grep clean), and `CLAUDE.md`/`CONTRIBUTING.md` need no change.

## R9 - Validation approach (cannot be done locally)

- `gh workflow run ghcr-image-cleanup.yaml --ref ci/lfx-self-serve-ops-250 -f dry-run=true` runs the branch version because the file exists on `main`. Baseline: `gh workflow run ghcr-image-cleanup.yaml --ref main -f dry-run=true` (old local version) - both must be started close together so age windows match.
- Compare from run logs: the old workflow's `Delete stale image versions` step vs the shared `cleanup / Delete stale image versions` step, specifically the sets of `dry-run: Would have deleted … package_version=<id>` lines and the summary's "Would delete" counts. Expect set equality (versions aging past 30d between runs excepted).
- Also assert no deletion log lines (`Deleted` followed by a package version) and `Deleted: 0` in the manual-dry-run summary (SC-004).
- Org Actions policy for calling `lfx-public-workflows` is already exercised by `license-header-check.yml` and the helm publisher (both in this repo), so it is allowed; the org policy API itself is not readable with current credentials.
- Static checks: parse the YAML and run `actionlint` if available; license-header check workflow covers the header.

## Open items

None. No `NEEDS CLARIFICATION` remain.
