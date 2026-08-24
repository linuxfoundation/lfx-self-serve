# Tasks: Contact CLA Manager (Request approval / Request Removal)

**Input**: Design documents from `/specs/009-cla-manager-request/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — required by the spec’s independent tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5 from spec.md

## Phase 1: Setup

- [x] T001 Spec Kit artifacts under `specs/009-cla-manager-request/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `checklists/requirements.md`)
- [x] T002 Persist `.specify/feature.json` → `specs/009-cla-manager-request`

---

## Phase 2: Foundational

**Purpose**: Types and visibility predicates every story uses

- [x] T003 [P] Add client DTOs to `packages/shared/src/interfaces/cla.interface.ts` (`ClaManagerRequestMode`, `ClaManagerRequestType`, `ClaManager`, `ClaManagerList`, `ClaManagerRequest`, `ClaManagerRequestResult`)
- [x] T004 [P] Add upstream types to `apps/lfx-one/src/server/types/cla.types.ts`
- [x] T005 [P] Add `canRequestClaApproval` / `canRequestClaRemoval` / `canContactClaManager` in `packages/shared/src/utils/cla-manager-actions.utils.ts` and export from `packages/shared/src/utils/index.ts`
- [x] T006 Tests for T005 in `packages/shared/src/utils/cla-manager-actions.utils.spec.ts`

**Checkpoint**: Gates are unit-testable without Angular

---

## Phase 3: User Story 1 — Request approval (P1) 🎯 MVP

- [x] T007 [US1] `ClaService.getClaManagers` + `createClaManagerRequest` in `apps/lfx-one/src/server/services/cla.service.ts` using `gatewayFetch` + `identityQuery`
- [x] T008 [US1] Tests in `apps/lfx-one/src/server/services/cla.service.spec.ts` (path, identity query, POST body, 404 ≠ empty list)
- [x] T009 [US1] Controller methods in `apps/lfx-one/src/server/controllers/clas.controller.ts` (UUID, requestType enum, non-empty recipients, message max 4096)
- [x] T010 [US1] Tests in `apps/lfx-one/src/server/controllers/clas.controller.spec.ts`
- [x] T011 [US1] Routes in `apps/lfx-one/src/server/routes/clas.route.ts` — GET unguarded, POST `blockDuringImpersonation`
- [x] T012 [US1] `MyClasService.getClaManagers` / `createClaManagerRequest` in `apps/lfx-one/src/app/shared/services/my-clas.service.ts`
- [x] T013 [US1] Modal `contact-cla-manager.component.{ts,html}` — load list, checkboxes, approval/removal POST, copy modes
- [x] T014 [US1] Modal tests in `contact-cla-manager.component.spec.ts` (approval Send posts `approval`)

**Checkpoint**: Approval Send works against mocked BFF

---

## Phase 4: User Story 2 — Request Removal (P1)

- [x] T015 [US2] Modal removal copy + POST `requestType: "removal"` (same component as T013)
- [x] T016 [US2] Modal test: removal Send posts `removal`; ICLA/Revoked not in factory (T019)

---

## Phase 5: User Story 3 — Contact no-op (P2)

- [x] T017 [US3] Contact Send closes without `createClaManagerRequest`; no success-sent toast
- [x] T018 [US3] Modal test asserting zero POSTs on contact Send
- [x] T019 [US3] `buildContactClaManagerMenuItems` in `contact-cla-manager-menu.ts` + `contact-cla-manager-menu.spec.ts` (gates + DialogService.open payload)

---

## Phase 6: User Story 4 — Zero managers (P2)

- [x] T020 [US4] Empty `managers` → support copy, no Send, no auto-POST
- [x] T021 [US4] Modal test for empty list

---

## Phase 7: User Story 5 — Impersonation (P2)

- [x] T022 [US5] `clas.route.spec.ts`: POST requests 403 `IMPERSONATION_READ_ONLY`; GET managers 200 while impersonating

---

## Phase 8: Polish

- [x] T023 Confirm `profile-clas.component.ts` / `.html` / `.spec.ts` are unmodified vs this branch’s HEAD
- [x] T024 Run the test commands in [quickstart.md](./quickstart.md)

## Dependencies

- Phase 2 before 3–7
- US1 modal (T013) before US2–US4 UI assertions
- T011 before T022
- T019 can follow T013 (factory imports the component)

## Parallel opportunities

T003, T004, T005 in parallel. T008 / T010 after T007 / T009. T014 / T016 / T018 / T021 share the modal spec file sequentially.
