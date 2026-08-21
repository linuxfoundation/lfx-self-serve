# Feature Specification: Show identity each CLA was signed under

**Feature Branch**: `008-signed-under-identity`
**Created**: 2026-08-20
**Status**: Draft
**Input**: [lfx-self-serve#1573](https://github.com/linuxfoundation/lfx-self-serve/issues/1573) — "Show the identity each CLA was signed under (inline per row)". Inside Milestone 2 (M2, due 2026-08-28) of the EasyCLA → LFX Self Serve migration. Parent Story E [#1253](https://github.com/linuxfoundation/lfx-self-serve/issues/1253). Informational replacement for the removed Invalidate action.

Delivery git branch is **`feat/GH-1256`** ([lfx-self-serve#1440](https://github.com/linuxfoundation/lfx-self-serve/pull/1440)), not a new `feat/GH-1573-*`. The spec-kit directory name and the git branch are independent.

## Background _(why this exists)_

A contributor's **My CLAs** page lists every agreement they have signed, with a Signed column that today shows only the date. After the 2026-08-14 legal/stakeholder review, contributors can no longer invalidate an agreement themselves. The legal substitute on that same flow (Mike Dolan) was to **show which account the agreement was signed under**. Heather filed this ticket as that substitute, then on 2026-08-17 added GitLab and the rule that the identity sits **inside the existing Signed cell**, not as a new column.

The producer already sends the data. [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151) (merged to EasyCLA `dev` 2026-08-20) adds two fields on each `GET /v4/my-clas` row: `signedVia` (`github` / `gitlab` / `gerrit`) and `signedAs` (username or email). Both are omitted when the signature record carries no identity. Self Serve receives them and drops them: the page server's upstream type and its mapper do not declare or copy the fields.

Approved visual: prototype v17 (`EasyCLA_MyCLAs_Full_Prototype_Final.html`, Heather 2026-08-14 after legal review). Every row — including Revoked and Invalidated — carries a second line under the signed date, nested in the Signed cell. Email rows read `Signed as jellis@linuxfoundation.org` with no platform suffix. GitHub rows read `Signed as jellis (GitHub)`.

This feature ends when that line is on screen. It does not add actions, dates on status pills, or a producer change.

## Clarifications

### Session 2026-08-20

- Q: New column, or a second line in Signed? → A: **Second line in the existing Signed cell.** Date first, identity underneath. A sixth column was discussed earlier and is overruled by the 2026-08-17 issue update and FR-007. v17 nests the line in that cell.

- Q: Which rows? → A: **Every listed row that has an identity**, including ICLA and ECLA, and including Valid, Needs attention, Revoked, Invalidated, and unknown. Status does not gate the line. v17 shows it on the Invalidated and Revoked examples. The issue body names three states; the prototype and the "replacement for Invalidate" rationale both require the non-valid rows too.

- Q: What does the line say? → A: **`Signed as {identity}`**, plus a platform suffix only for GitHub and GitLab. GitHub → `Signed as {identity} (GitHub)`. GitLab → `Signed as {identity} (GitLab)`. Gerrit / LF SSO / email → `Signed as {identity}` with no suffix. The issue's parenthetical "(Gerrit / LF SSO)" names the case, not copy to print — v17 email rows have no suffix.

- Q: Does GitLab wait on Self Serve GitLab account linking? → A: **No. Display is unconditional.** Showing a historical GitLab signer identity has no dependency on #1249. If the producer says the row was signed via GitLab, the line says `(GitLab)`. #1418 (remove GitLab mention from the page chrome) does not apply to this historical fact.

- Q: What if the producer omitted the fields? → A: **Omit the line.** The date still renders. Omit also when the identity string is missing, empty, or whitespace-only, even if a platform is present — there is nothing to sign as. If an identity is present but the platform is missing or unrecognised, print `Signed as {identity}` with no suffix. Do not guess a platform from the string.

- Q: Does Self Serve reconstruct the identity from the session or from other row fields? → A: **No. Pass the producer's two fields through.** The producer already chose GitHub over GitLab over Gerrit. Re-deriving would disagree the first time a record carries more than one identity key.

- Q: Which branch? → A: **`feat/GH-1256` / [#1440](https://github.com/linuxfoundation/lfx-self-serve/pull/1440).** The Signed cell lives in the same table that branch already owns. No new branch.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Contributor sees who each agreement was signed as (Priority: P1)

A contributor opens **My CLAs** and, on every row that has a signer identity, sees a second line under the signed date naming that identity and — for GitHub and GitLab — the platform. The rest of the row is unchanged.

**Why this priority**: This is the whole of #1573. Without it the legal substitute for the removed Invalidate action is missing, and a contributor with several GitHub accounts cannot tell which one a row belongs to.

**Independent Test**: Load My CLAs for a contributor holding a GitHub-signed ICLA, a GitLab-signed ECLA, and an email-signed ICLA, and confirm three second-lines under the dates matching the copy table, with no sixth column.

**Acceptance Scenarios**:

1. **Given** a row the producer marked as signed via GitHub with identity `jellis`, **When** My CLAs renders, **Then** the Signed cell shows the date and, under it, `Signed as jellis (GitHub)`.
2. **Given** a row the producer marked as signed via GitLab with a username, **When** My CLAs renders, **Then** the Signed cell shows `Signed as {username} (GitLab)` under the date — even if the contributor has not linked GitLab in Self Serve.
3. **Given** a row the producer marked as signed via Gerrit (including LF SSO / email) with identity `jellis@linuxfoundation.org`, **When** My CLAs renders, **Then** the Signed cell shows `Signed as jellis@linuxfoundation.org` under the date, with no platform suffix.
4. **Given** any of those rows, **When** the table header is read, **Then** the columns are still Project, Type, Status, Signed, Actions — no new column.
5. **Given** a Revoked row and an Invalidated row that both carry an identity, **When** they render, **Then** each still shows the identity line under its date. Status does not hide it.

---

### User Story 2 - A row with no stored identity does not invent one (Priority: P2)

A contributor whose signature record has no identity on it still sees the signed date. They do not see a broken `Signed as` line, and they do not see a guessed platform.

**Why this priority**: The producer omits both fields when the record carries no identity. Printing a suffix with an empty name, or guessing Gerrit from an `@`, would be a lie. Independently testable from User Story 1.

**Independent Test**: Load My CLAs including a row whose producer payload omits both fields, and a row with a platform but a blank identity, and confirm neither grows a second line.

**Acceptance Scenarios**:

1. **Given** a row whose producer omitted both identity fields, **When** it renders, **Then** the Signed cell shows the date only.
2. **Given** a row whose identity string is missing, empty, or whitespace-only, **When** it renders, **Then** there is no second line, even if a platform is present.
3. **Given** a row with an identity string but no recognised platform, **When** it renders, **Then** the second line is `Signed as {identity}` with no suffix.

---

### Edge Cases

- **Unknown platform token.** A future producer value that is not `github`, `gitlab`, or `gerrit` is treated as "no recognised platform": identity still prints, suffix does not. Do not guess from the identity string.
- **Whitespace-only identity.** Trim, then apply the omit rule. Do not print `Signed as    (GitHub)`.
- **GitLab and #1418.** Removing GitLab from page chrome / sign-entry does not hide a historical GitLab signer identity on this line.
- **Revoked empty actions cell.** #1256 already suppresses the kebab on Revoked. This feature must not reintroduce one in order to "put identity somewhere".
- **Invalidated kebab.** Whether an Invalidated row keeps download is still open on #1256 (legal has not reviewed that actions question). This feature does not change that cell.
- **No dates on this line.** The signed date above is the date. Status-pill dates (`Revoked · <date>`) are [#1370](https://github.com/linuxfoundation/lfx-self-serve/issues/1370) and out of scope. The producer's `flaggedAt` is response time and must not be bound here.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Each My CLAs row MUST show the signer identity inline in the existing Signed cell, beneath the signed date, when the producer supplied an identity. The table MUST NOT gain a new column.
- **FR-002**: The identity line MUST use these three copy shapes and no others: GitHub → `Signed as {identity} (GitHub)`; GitLab → `Signed as {identity} (GitLab)`; Gerrit / LF SSO / email → `Signed as {identity}` with no platform suffix.
- **FR-003**: GitLab MUST be displayed whenever the producer says the row was signed via GitLab. Display MUST NOT wait on Self Serve GitLab account linking, and MUST NOT be suppressed because other page copy currently omits GitLab.
- **FR-004**: The line MUST render on ICLA and ECLA rows and MUST NOT be gated on status. Valid, Needs attention, Revoked, Invalidated, and unknown rows that have an identity all show it.
- **FR-005**: The line MUST be omitted when the producer omitted both identity fields, and when the identity string is missing, empty, or whitespace-only. The signed date MUST still render.
- **FR-006**: When an identity is present but the platform is missing or not one of GitHub / GitLab / Gerrit, the line MUST be `Signed as {identity}` with no suffix. The page MUST NOT guess a platform from the identity string.
- **FR-007**: The identity shown MUST be the identity the producer sent on that row. The page MUST NOT reconstruct it from the signed-in session or from other fields on the row.
- **FR-008**: The line MUST be informational only — not a link, not a menu item, not an action. It MUST NOT display a second date.
- **FR-009**: Self Serve MUST forward the producer's identity fields through its existing My CLAs response so the page can render them. Unrecognised platform tokens MUST NOT be forwarded as if they were GitHub, GitLab, or Gerrit.
- **FR-010**: Work MUST land on the existing M2 My CLAs feature branch that already owns this table. A separate branch for this ticket is out of scope.

### Key Entities

- **Signed-under identity**: the pair the producer already emits per agreement — a platform (`github`, `gitlab`, or `gerrit`) and an identity string (username or email). Either or both may be absent. `gerrit` is also the LF SSO / email-identified case.
- **Signed cell**: the existing fourth column of My CLAs. Primary line is the signed date. This feature adds an optional second line naming the signed-under identity.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A contributor with GitHub-, GitLab-, and email-signed agreements can tell, from My CLAs alone, which identity each row was signed under, without opening another page.
- **SC-002**: A walkthrough of the page finds no sixth column; the identity sits under the date in Signed.
- **SC-003**: A Revoked row and an Invalidated row that carry an identity still show that identity. A row whose producer omitted both fields shows the date only.
- **SC-004**: A GitLab-signed row shows `(GitLab)` even when the contributor has not linked GitLab in Self Serve.
- **SC-005**: The identity line is not clickable and does not open a menu. Existing row actions are unchanged.

## Assumptions

- The producer on DEV already emits `signedVia` and `signedAs` as specified by [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151). This feature does not change EasyCLA.
- Prototype v17 is the visual source. Where the issue body lists three statuses and the prototype also shows Invalidated, the prototype plus the "every signed row" rationale wins.
- `#1418` (remove GitLab mention) does not apply to historical signer identity.
- `#1370` (revocation date) and the open Invalidated-actions legal question stay on #1256 / those tickets.
- The existing My CLAs feature flag covers this display; no new flag.
