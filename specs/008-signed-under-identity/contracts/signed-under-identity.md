# Contract: signed-under identity (My CLAs Signed cell)

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Date**: 2026-08-20

Informational display only. No new HTTP route. No write.

## Producer (already shipped)

`GET /v4/my-clas` row (`my-cla`) may include:

| Field | Values | When omitted |
|---|---|---|
| `signedVia` | `github` \| `gitlab` \| `gerrit` | No identity on the signature record |
| `signedAs` | username or email string | Same |

`gerrit` is also LF SSO / email. Both omitted together is the empty-identity case.

Self Serve does not call a new endpoint. The existing list fetch already carries these keys; the mapper currently ignores them.

## BFF mapping (`toMyClaAgreement`)

| Producer | View model |
|---|---|
| `signedVia` in `{github, gitlab, gerrit}` | copy |
| any other `signedVia` | omit `signedVia`; still copy `signedAs` if present |
| `signedAs` non-empty after trim | copy trimmed |
| `signedAs` empty / whitespace / missing | omit |

Do not read session identity. Do not invent a default via.

## Page render (Signed `<td>`)

1. Primary line: signed date, existing `date:'mediumDate':'UTC'` (or em dash when missing). Unchanged.
2. Optional second line: `signedAsLine` from [data-model.md](../data-model.md). `text-xs`, muted, under the date. `data-testid="agreement-signed-as-{id}"`.
3. No sixth column. No link. No date on this line.

Renders on every status, including Revoked (empty actions cell stays empty) and Invalidated (kebab unchanged).

## Out of contract

- `flaggedAt` / pill dates (#1370)
- Invalidated kebab/download legal question (#1256)
- `claManager` / Manage in CCLA Console (#1575)
- Request Removal (#1574)
