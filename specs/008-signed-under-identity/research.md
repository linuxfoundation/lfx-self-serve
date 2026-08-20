# Phase 0 Research: Show identity each CLA was signed under

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-20

## Decision 1 — Pass the producer fields through; do not re-derive

**Decision**: `toMyClaAgreement` copies `signedVia` and `signedAs`. It does not reconstruct identity from the session, from GitHub usernames on the row, or from emails.

**Rationale**: [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151) already derives the pair in `signedIdentity(sig)` with fixed precedence (GitHub username else GitHub ID, then GitLab username else GitLab ID, then email else LF username for `gerrit`). A second derivation in Self Serve would diverge the first time a record carries more than one identity key. The BFF's job is the same as for `status`: forward the producer's token.

**Rejected**: Inferring GitHub from a session-linked account. That answers "who is logged in", not "who signed this row".

## Decision 2 — Three copy shapes; Gerrit has no suffix

**Decision**:

| Producer `signedVia` | Line |
|---|---|
| `github` | `Signed as {signedAs} (GitHub)` |
| `gitlab` | `Signed as {signedAs} (GitLab)` |
| `gerrit` | `Signed as {signedAs}` |

**Rationale**: Issue AC lists all three cases. v17 email rows have no platform suffix; GitHub rows do. The issue's "(Gerrit / LF SSO)" names the case, not copy. GitLab has no v17 example; the issue supplies `(GitLab)`.

**Rejected**: Printing `(Gerrit)` or `(LF SSO)` on email rows — contradicts the committed prototype.

## Decision 3 — Omit the line when there is no identity string

**Decision**: No second line when both fields are omitted, or when `signedAs` is missing / empty / whitespace-only after trim. Identity present + unknown or missing `signedVia` → `Signed as {identity}` with no suffix. Unknown `signedVia` tokens are not copied onto the view model.

**Rationale**: The producer omits both fields when the signature record has no identity. `Signed as  (GitHub)` is worse than a date-only cell. Guessing Gerrit from an `@` is a false platform.

**Rejected**: Always rendering the `.signedas` slot empty (layout reservation). Unlike the status note, there is no follow-up ticket that will fill it later for every row.

## Decision 4 — GitLab display is unconditional

**Decision**: If `signedVia` is `gitlab`, print `(GitLab)`. Do not wait on Self Serve GitLab linking (#1249). Do not hide because of #1418.

**Rationale**: The issue says so in those words. Historical signer identity is a stored fact, not a sign-entry path.

## Decision 5 — Precompute on ClaRow

**Decision**: A pure helper in `cla-view.utils.ts` produces the line. `ClaRow` carries `signedAsLine?: string`. The template `@if`s it under the date.

**Rationale**: The table already precomputes status so the template calls nothing (`docs/reviews/frontend-checklist.md`). A per-cell format function would re-run on every change-detection pass.

## Decision 6 — Same Signed `<td>`; land on feat/GH-1256

**Decision**: Edit `profile-clas.component.html`'s Signed cell only. Push to `feat/GH-1256` / #1440.

**Rationale**: That file is the collision with the status-column work. A `feat/GH-1573-*` branch would split the same template.

## Producer characteristics (not decisions)

1. `gerrit` doubles as LF SSO / email. There is no separate `email` via token.
2. Both fields omitted when the record has no identity — that is a valid payload, not an error.
3. `flaggedAt` is response time. Do not bind it to this line or to a status pill.
