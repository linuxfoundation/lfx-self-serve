---
description: 'Task list for signed-under identity on My CLAs'
---

# Tasks: Show identity each CLA was signed under

**Input**: Design documents from `/specs/008-signed-under-identity/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. The spec requires the three copy shapes (FR-002), omit-when-blank (FR-005), pass-through (FR-007 / FR-009), every-status including Revoked/Invalidated (FR-004), and GitLab unconditional (FR-003).

**Organization**: Foundational types + helper unblock US1. US2 (omit) is the same helper with different fixtures.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2
- Exact file paths on every code task

## Path Conventions

**One repository**: `linuxfoundation/lfx-self-serve`. Paths below are relative to its root.

**Git branch**: implement on **`feat/GH-1256`** ([lfx-self-serve#1440](https://github.com/linuxfoundation/lfx-self-serve/pull/1440)). **Do not** create `feat/GH-1573-*`. **Do not** commit or push.

---

## Phase 1: Setup

- [x] T001 Confirm checkout is `feat/GH-1256` at `/Users/ahmedlf/lfx-self-serve-feat-GH-1256`. Confirm Signed `<td>` in `apps/lfx-one/src/app/modules/profile/clas/profile-clas.component.html` is date-only, and `toMyClaAgreement` in `apps/lfx-one/src/server/services/cla.service.ts` does not copy `signedVia` / `signedAs`
- [x] T002 [P] Record baseline: `yarn workspace @lfx-one/shared test src/utils/cla-view.utils.spec.ts`; `yarn workspace lfx-one-ui test:server src/server/services/cla.service.spec.ts`; `yarn workspace lfx-one-ui ng test --watch=false --include='**/profile-clas.component.spec.ts'`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work until this phase is complete.

- [x] T003 [P] Add `ClaSignedVia = 'github' | 'gitlab' | 'gerrit'` and optional `signedVia` / `signedAs` on `MyClaAgreement` in `packages/shared/src/interfaces/cla.interface.ts`. Shape: [data-model.md](./data-model.md)
- [x] T004 [P] Add the same optional fields on `EasyClaMyCla` in `apps/lfx-one/src/server/types/cla.types.ts`. `signedVia` typed as the three tokens (unknown tokens are dropped in the mapper, not by the wire type widening)
- [x] T005 Add failing tests in `packages/shared/src/utils/cla-view.utils.spec.ts` for `signedAsLine`: GitHub suffix, GitLab suffix, Gerrit/email no suffix, omit when identity blank, no-suffix when via missing. These MUST fail before T006
- [x] T006 Implement `signedAsLine` in `packages/shared/src/utils/cla-view.utils.ts` per [data-model.md](./data-model.md). T005 MUST pass after this task

**Checkpoint**: Types compile; helper pins copy. Mapper still drops the fields. Template still date-only.

---

## Phase 3: User Story 1 — Contributor sees who each agreement was signed as (Priority: P1) 🎯 MVP

**Goal**: GitHub, GitLab, and email identities render under the date in the existing Signed cell, on every status including Revoked and Invalidated.

**Independent Test**: SC-001 / SC-002 / SC-004.

### Tests for User Story 1

- [x] T007 [P] [US1] Extend `apps/lfx-one/src/server/services/cla.service.spec.ts`: `toMyClaAgreement` copies `signedVia`/`signedAs`; trims `signedAs`; drops unknown `signedVia` while keeping `signedAs`; omits blank `signedAs`. MUST fail before T009
- [x] T008 [P] [US1] Extend `apps/lfx-one/src/app/modules/profile/clas/profile-clas.component.spec.ts`: GitHub line under the date; GitLab line (unconditional); Gerrit/email with no suffix; Revoked and Invalidated still show the line; no sixth column. MUST fail before T010

### Implementation for User Story 1

- [x] T009 [US1] Copy `signedVia` / `signedAs` in `toMyClaAgreement` (`apps/lfx-one/src/server/services/cla.service.ts`) per [contracts/signed-under-identity.md](./contracts/signed-under-identity.md). Unknown via → omit via, keep identity. Trim identity. Do not read the session
- [x] T010 [US1] Precompute `signedAsLine` on `ClaRow` in `apps/lfx-one/src/app/modules/profile/clas/profile-clas.component.ts`. Import `signedAsLine` from `@lfx-one/shared/utils`
- [x] T011 [US1] In `apps/lfx-one/src/app/modules/profile/clas/profile-clas.component.html`, under the signed date in the Signed `<td>`, `@if` the line with muted `text-xs` and `data-testid="agreement-signed-as-{id}"`. Do not add a column. Do not make it a link
- [x] T012 [US1] Run the three test commands from T002. T005, T007, T008 pass. No new failures in the #1256 status cases

**Checkpoint**: A GitHub / GitLab / email row shows the right line. Revoked kebab stays gone.

---

## Phase 4: User Story 2 — A row with no stored identity does not invent one (Priority: P2)

**Goal**: Date-only Signed cell when the producer omitted identity.

- [x] T013 [US2] Extend `apps/lfx-one/src/app/modules/profile/clas/profile-clas.component.spec.ts`: both fields omitted → no `agreement-signed-as-*`; whitespace-only `signedAs` → no line; identity without via → `Signed as {identity}` and no suffix
- [x] T014 [US2] Confirm T006/T009 already satisfy these fixtures; fix mapper/helper if T013 fails. Do not guess a platform from `@`
- [x] T015 [US2] Re-run the three test commands. SC-003 / SC-005 hold: omit works; line is not clickable; Invalidated kebab unchanged

**Checkpoint**: Empty-identity rows are date-only. No invented suffix.

---

## Phase 5: Polish

- [x] T016 Confirm `profile-clas.component.html` Signed cell is still one `<td>` with date then optional line. Confirm `buildRowMenuItems` still returns `[]` for `revoked` and still offers Download PDF on an Invalidated ICLA with `pdfAvailable`
- [x] T017 Do not commit. Do not push. Spec path is `specs/008-signed-under-identity/`
