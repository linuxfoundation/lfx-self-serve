# Phase 1 Data Model: Show identity each CLA was signed under

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-20

**No persistence changes.** Nothing is stored. No schema, migration, table, or Self Serve cache. The two fields already arrive on each `GET /v4/my-clas` row; this feature maps them onto the existing view model.

---

## Additive fields on `MyClaAgreement`

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `signedVia` | `'github' \| 'gitlab' \| 'gerrit'` | no | producer `signedVia` | Omitted when the producer omitted it, or when the token is not one of the three. |
| `signedAs` | string | no | producer `signedAs` | Trimmed. Empty-after-trim becomes omitted. |

`ClaSignedVia` is the union above. Do not add `email` as a fourth token — the producer uses `gerrit` for that case.

---

## Display-only: signed-as line

Not a stored field. Computed by `signedAsLine(signedVia, signedAs)`:

| Inputs | Output |
|---|---|
| `signedAs` missing / blank | `undefined` (no line) |
| `signedVia: github` + identity | `Signed as {identity} (GitHub)` |
| `signedVia: gitlab` + identity | `Signed as {identity} (GitLab)` |
| `signedVia: gerrit` + identity | `Signed as {identity}` |
| identity, via missing or unrecognised | `Signed as {identity}` |

Carried on `ClaRow.signedAsLine?: string`. The template does not recompute it.

---

## Unchanged

`status`, `statusReason`, `pdfAvailable`, `signedOn`, row actions. `flagged` / `flaggedAt` / `claManager` stay unused.
