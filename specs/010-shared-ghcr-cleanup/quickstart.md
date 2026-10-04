# Quickstart: Validate the Shared Cleanup Migration

Runnable validation for [spec.md](./spec.md) (FR-013, SC-001, SC-004). Contract details: [contracts/shared-workflow-call.md](./contracts/shared-workflow-call.md). Rationale: [research.md](./research.md).

## Prerequisites

- `gh` authenticated with access to `linuxfoundation/lfx-self-serve` (can run workflows and read run logs).
- The migrated workflow is pushed on branch `ci/lfx-self-serve-ops-250`.
- `ghcr-image-cleanup.yaml` already exists on `main` (it does), so `workflow_dispatch --ref <branch>` runs the branch version.

## 1. Static checks (local)

```bash
# Parse the YAML and confirm there are no run: blocks left in the caller
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ghcr-image-cleanup.yaml')); print(list(d['jobs']))"
grep -cE '^\s+run:' .github/workflows/ghcr-image-cleanup.yaml     # expect 0 (a bare "run:" also matches dry-run:)
grep -E "uses: .*@[0-9a-f]{40}" .github/workflows/ghcr-image-cleanup.yaml  # full-SHA pin present
wc -l .github/workflows/ghcr-image-cleanup.yaml                    # expect < 75 (SC-002)
command -v actionlint && actionlint .github/workflows/ghcr-image-cleanup.yaml
yarn prettier --check docs/runbooks/feature-branch-deployment.md docs/architecture/deployment.md
```

Expected: one job (`cleanup`), zero `run:`, SHA-pinned `uses:`, actionlint clean (if installed), Prettier clean.

## 2. Baseline dry-run of the OLD workflow (`main`)

```bash
gh workflow run ghcr-image-cleanup.yaml --repo linuxfoundation/lfx-self-serve --ref main -f dry-run=true
```

Note the run ID (`gh run list --workflow ghcr-image-cleanup.yaml --limit 2`). Start step 3 immediately after so both runs see the same age window.

## 3. Dry-run of the NEW workflow (branch)

```bash
gh workflow run ghcr-image-cleanup.yaml --repo linuxfoundation/lfx-self-serve \
  --ref ci/lfx-self-serve-ops-250 -f dry-run=true
```

Expected: run succeeds; jobs `cleanup / Build active preview tag filters` and `cleanup / Cleanup Stale Container Images` appear; summary shows `Dry run: true`, `Cut-off: 30d`, `Deleted: 0`, `Failed: 0`.

## 4. Compare candidate sets

```bash
for id in <OLD_RUN_ID> <NEW_RUN_ID>; do
  gh run view "$id" --repo linuxfoundation/lfx-self-serve --log \
    | sed $'s/\033\\[[0-9;]*[mK]//g' \
    | grep -o 'dry-run: Would have deleted.*package_version=[0-9]*' \
    | grep -o 'package_version=[0-9]*' | sort -u > "/tmp/ghcr-$id.ids"
done
diff /tmp/ghcr-<OLD_RUN_ID>.ids /tmp/ghcr-<NEW_RUN_ID>.ids && echo IDENTICAL
```

Expected: identical (SC-001). Any difference must be explained by a version crossing the 30-day boundary between runs, or by the extra `!main` protection (a `main`-tagged version present only in the old list). Confirm that no id in either list carries a `development`, `latest`, `x.y.z`, `x.y`, or open-PR `ui-pr-N` tag:

```bash
gh api --paginate "orgs/linuxfoundation/packages/container/lfx-self-serve/versions" \
  --jq '.[] | select(.id as $i | ["<ids from the list>"] | index($i|tostring)) | .metadata.container.tags'
```

## 5. Manual-input behavior

| Run            | Command                                      | Expected                                                           |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Defaults       | `gh workflow run … --ref <branch>` (no `-f`) | `Dry run: true`, `Deleted: 0` (SC-004)                             |
| Custom cut-off | `-f dry-run=true -f cut-off=14d`             | Summary `Cut-off: 14d`; candidate set is a superset of the 30d set |

Do not run `-f dry-run=false` from the branch for validation; the first real delete should be the scheduled run (or a deliberate manual one after merge by a maintainer).

## 6. Failure-path spot checks (read-only reasoning, no execution)

- Remove `pull-requests: read` from the caller in a scratch branch and dispatch: the workflow must fail validation at startup (nested permission exceeds caller), not silently skip preview protection. Optional.

## 7. After merge

1. Confirm the first scheduled run (Sunday 00:00 UTC) succeeds: `gh run list --workflow ghcr-image-cleanup.yaml --event schedule --limit 1`.
2. Check the step summary `Deleted:` is plausible vs the pre-migration weekly trend (SC-003).
3. Rollback if needed: `git revert` the migration commit (restores the local workflow in one step).
