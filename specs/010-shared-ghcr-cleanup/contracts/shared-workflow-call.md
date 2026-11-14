# Contract: Caller -> Shared GHCR Cleanup Workflow

The only external interface this feature touches is the `workflow_call` contract of `linuxfoundation/lfx-public-workflows/.github/workflows/ghcr-image-cleanup.yaml` at the pinned SHA, and the trigger surface this repo continues to expose to maintainers. Source of truth upstream: `docs/ghcr-image-cleanup/inputs.md` and the workflow file at the pin.

## 1. Reference

```text
uses: linuxfoundation/lfx-public-workflows/.github/workflows/ghcr-image-cleanup.yaml@476427e9afb0814cd8534eccc10b0d5ad5e4b9f8 # main
```

Full 40-char SHA required. No `secrets:` and no `secrets: inherit`.

## 2. Inputs this repo supplies

| Input                                            | Value in this repo                                               | Required by shared workflow                                       |
| ------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `image-name`                                     | `lfx-self-serve`                                                 | yes (single exact package, no whitespace/quote/comma/`!`/`*`/`?`) |
| `image-tags`                                     | `"!development !latest !*.*.* !*.*"`                             | no (overrides default)                                            |
| `enable-preview-protection`                      | `true`                                                           | no                                                                |
| `cut-off`                                        | `${{ github.event.inputs.cut-off \|\| '30d' }}`                  | no                                                                |
| `dry-run`                                        | `${{ fromJSON(github.event.inputs['dry-run'] \|\| 'true') }}`    | no                                                                |
| `account`, `preview-label`, `preview-tag-prefix` | omitted (defaults `linuxfoundation`, `deploy-preview`, `ui-pr-`) | no                                                                |

## 3. Permissions the calling job must grant

```yaml
permissions:
  contents: read
  packages: write
  pull-requests: read # required because enable-preview-protection is true
```

## 4. Outputs available (unused today)

`deleted-count`, `would-delete-count`, `failed-count` (strings). The run fails (non-zero) when `failed-count > 0`. Human-readable summary is written to the job step summary under "Container image cleanup".

## 5. Trigger surface preserved by this repo

| Trigger                                                       | Behavior                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `schedule` `0 0 * * 0`                                        | Deletes eligible versions (dry-run forced off by the shared workflow). |
| `workflow_dispatch` input `dry-run` (boolean, default `true`) | Preview unless explicitly set false.                                   |
| `workflow_dispatch` input `cut-off` (string, default `30d`)   | Minimum age, e.g. `14d`, `4w 2d`.                                      |

## 6. Compatibility obligations

- If upstream changes input names/defaults, bumping the pin is a deliberate edit to the caller; reviewers compare the upstream diff for `inputs`, `permissions`, and `DRY_RUN` expression changes.
- Changing the preview label or `ui-pr-` tag scheme in `docker-build-pr.yml` requires matching `preview-label` / `preview-tag-prefix` here.
