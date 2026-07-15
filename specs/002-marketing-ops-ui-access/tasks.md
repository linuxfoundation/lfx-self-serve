# Tasks: Marketing Ops UI Access (FGA-guarded Marketing pages)

**Input**: Design documents from `/specs/002-marketing-ops-ui-access/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: E2E permission/navigation tasks are included because the feature is authorization-critical and `quickstart.md` calls for automated role-matrix coverage extending the existing `e2e/persona-navigation.spec.ts`. They are not strict TDD-first; write before or alongside implementation per developer preference, but they MUST pass before the story is considered done.

**Organization**: Grouped by user story (US1/US2/US3 from spec.md) so each can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 (setup/foundational/polish carry no story label)
- Paths are repo-relative.

## Path Conventions

Web app in a Turborepo monorepo: shared types in `packages/shared/src/`, BFF in `apps/lfx-one/src/server/`, Angular app in `apps/lfx-one/src/app/`, E2E in `apps/lfx-one/e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preconditions for building and validating the feature. No project scaffolding is needed (existing monorepo).

- [ ] T001 Ensure OpenFGA validation fixtures exist per `specs/002-marketing-ops-ui-access/quickstart.md` prerequisites — test users/tuples for: Marketing Ops (non-ED, granted at ROOT), Marketing Auditor (single-project), ED (single-project), and a project writer/owner with no marketing grant (manual tuple insertion / `/nats`; deferred assignment UI is LFXV2-1760). — DEFERRED: requires the shared dev/FGA environment; not creatable from the repo. Needed for T027 manual validation.
- [x] T002 [P] Confirm baseline gates pass before changes: run `yarn check-types` and `yarn lint:check` from repo root.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type + data-flow plumbing that every user story depends on (access-type union, project probe enrichment, front-end access signals).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] Extend `AccessCheckAccessType` with `'marketing_auditor' | 'campaign_manager'` in `packages/shared/src/interfaces/access-check.interface.ts` (per `contracts/access-check.contract.md`).
- [x] T004 [P] Add response-only `marketingAuditor?: boolean` and `campaignManager?: boolean` to `Project` in `packages/shared/src/interfaces/project.interface.ts`, documenting the same `undefined = not probed / not a denial` semantics as `meetingCoordinator` (per `data-model.md`).
- [x] T005 Add probe-gated marketing enrichment to `getProjectById` in `apps/lfx-one/src/server/services/project.service.ts`: when requested, batch-check `marketing_auditor` and `campaign_manager` for the project UID via `AccessCheckService.checkAccess` and map results to the camelCase `marketingAuditor` / `campaignManager` fields (mirror the `meetingCoordinator` block; leave `undefined` when not requested). Depends on T003, T004.
- [x] T006 Read a `?marketing=true` query flag in `getProjectBySlug` (and the `getProjectById` slug path) in `apps/lfx-one/src/server/controllers/project.controller.ts` and thread it into the service call. Depends on T005.
- [x] T007 Add a `marketing?: boolean` option to `ProjectService.getProject` in `apps/lfx-one/src/app/shared/services/project.service.ts`, sending `?marketing=true` and including the flag in the cache key (like the existing `:mc` segment). Depends on T004.
- [x] T008 Add `canViewMarketing` (from `project.marketingAuditor === true`) and `canManageCampaigns` (from `project.campaignManager === true`) computed signals to `ProjectContextService` in `apps/lfx-one/src/app/shared/services/project-context.service.ts`, probing the active context slug via `getProject(slug, false, { marketing: true })` and failing closed. Depends on T007.

**Checkpoint**: Shared plumbing ready — user stories can proceed (US1 and US2 in parallel; US3 after T008).

---

## Phase 3: User Story 1 - Find a project and view its marketing dashboards (Priority: P1) 🎯 MVP

**Goal**: EDs, Marketing Ops, and Marketing Auditors can navigate to any authorized project and view the Marketing navigation section and the Marketing Impact page (read-only); everyone else cannot.

**Independent Test**: As a non-ED Marketing Auditor, confirm the "Projects" lens is available, the Marketing section + Marketing Impact appear for a granted project (read-only), and both are hidden/blocked for a non-granted project.

### Tests for User Story 1

- [x] T009 [P] [US1] E2E covering the US1 matrix (Marketing Ops + Marketing Auditor: section + Marketing Impact read-only on granted project; hidden and route-blocked on non-granted; lens available) in `apps/lfx-one/e2e/marketing-access.spec.ts`.

### Implementation for User Story 1

- [x] T010 [US1] Add `checkRootMarketingAuditor(req)` to `PersonaDetectionService` in `apps/lfx-one/src/server/services/persona-detection.service.ts` — mirror `checkRootWriter` (resolve ROOT uid, `checkSingleAccess` for `marketing_auditor`, fail closed to `false`, request-cache).
- [x] T011 [P] [US1] Add `isRootMarketingAuditor: boolean` to the personas API response interface (the same shape that carries `isRootWriter`) in `packages/shared/src/interfaces/persona-detection.interface.ts`.
- [x] T012 [US1] Include `isRootMarketingAuditor` in the `getPersonas` return in `apps/lfx-one/src/server/services/persona-detection.service.ts` (resolve alongside `isRootWriter`). Depends on T010, T011.
- [x] T013 [US1] Expose an `isRootMarketingAuditor` signal on `PersonaService` in `apps/lfx-one/src/app/shared/services/persona.service.ts`, hydrated from the personas API and cookie-seedable for SSR (parallel to `isRootWriter`). Depends on T011.
- [x] T014 [US1] Update `getAllowedLensIds()` in `apps/lfx-one/src/app/shared/services/lens.service.ts` so `showFoundation = hasBoardRole || isRootWriter || isRootMarketingAuditor`. Depends on T013.
- [x] T015 [P] [US1] Create `marketingViewGuard` (checks `project.marketingAuditor === true` via `getProject(slug, false, { marketing: true })`; slug from `?project=` then active context; NO ED persona fast-path; deny → redirect to `/foundation/overview?project=<slug>`) in `apps/lfx-one/src/app/shared/guards/marketing-view.guard.ts`. Depends on T007, T008.
- [x] T016 [US1] Wire `foundation/marketing-impact` to `[marketingViewGuard, projectQueryParamGuard]` (replace `executiveDirectorGuard`) in `apps/lfx-one/src/app/app.routes.ts`; leave `foundation/health-metrics` on `executiveDirectorGuard`. Depends on T015.
- [x] T017 [US1] Gate the Marketing section header and the Marketing Impact entry on `canViewMarketing()` (replace the `currentPersona() === 'executive-director'` gate; keep Metrics/Health Metrics + Social Listening ED-only) in `apps/lfx-one/src/app/shared/services/sidebar-nav.service.ts`. Depends on T008.
- [x] T018 [US1] Verify the foundation lens-items source (`/api/nav/lens-items?lens=foundation`) returns the marketing-audited project hierarchy for non-board users; if it is persona/board-scoped, extend it to include marketing-audited projects (research R2) in the relevant `apps/lfx-one/src/server/` nav lens-items service/route. — VERIFIED: BFF `NavigationService.getLensItems`/`buildQuery` is not persona/board-scoped; access is gated by the user's bearer token via the upstream query service. No BFF change needed; ROOT-cascaded `marketing_auditor` visibility is an upstream query-service FGA concern.

**Checkpoint**: US1 fully functional — non-ED marketing users can navigate and view Marketing Impact per project; MVP deliverable.

---

## Phase 4: User Story 2 - Manage campaigns for authorized projects (Priority: P1)

**Goal**: EDs and Marketing Ops can open the Campaigns page with full view + actions; Marketing Auditors and everyone else cannot see the link or reach the page.

**Independent Test**: With an ED, a Marketing Ops user, and a Marketing Auditor on one project, confirm the first two see Campaigns with full actions and the auditor sees neither the link nor the page (blocked on direct URL).

### Tests for User Story 2

- [x] T019 [P] [US2] E2E covering the US2 matrix (ED + Marketing Ops: Campaigns link + page with actions; Marketing Auditor: link hidden and route blocked) in `apps/lfx-one/e2e/marketing-access.spec.ts`.

### Implementation for User Story 2

- [x] T020 [P] [US2] Create `campaignAccessGuard` (checks `project.campaignManager === true` via `getProject(slug, false, { marketing: true })`; same slug resolution and denial-redirect as `marketingViewGuard`; NO ED persona fast-path) in `apps/lfx-one/src/app/shared/guards/campaign-access.guard.ts`. Depends on T007, T008.
- [x] T021 [US2] Wire `foundation/campaigns` to `[campaignAccessGuard, projectQueryParamGuard]` (replace `executiveDirectorGuard`) in `apps/lfx-one/src/app/app.routes.ts`. Depends on T020. (Same file as T016 — sequence, do not parallelize.)
- [x] T022 [US2] Gate the Campaigns sidebar entry on `canManageCampaigns()` in `apps/lfx-one/src/app/shared/services/sidebar-nav.service.ts`. Depends on T008. (Same file as T017 — sequence, do not parallelize.)

**Checkpoint**: US1 + US2 both work independently — read access and campaign management are correctly separated.

---

## Phase 5: User Story 3 - View the dashboard Marketing Overview section (Priority: P2)

**Goal**: EDs and Marketing Ops see the dashboard Marketing Overview section (read-only); Marketing Auditors and all others do not.

**Independent Test**: With an ED, Marketing Ops, Marketing Auditor, and a non-marketing user, confirm only ED + Marketing Ops see the Marketing Overview section and it exposes no actions.

### Tests for User Story 3

- [x] T023 [P] [US3] E2E asserting the Marketing Overview section is visible (read-only) only to ED + Marketing Ops and hidden from Marketing Auditors / non-marketing users in `apps/lfx-one/e2e/marketing-access.spec.ts`.

### Implementation for User Story 3

- [x] T024 [US3] Gate the `<lfx-marketing-overview />` section render on `canManageCampaigns()` and surface it in the foundation-lens dashboard for non-ED Marketing Ops (confirm placement across the ED and board-member/foundation dashboard variants per research R5), keeping every other ED-dashboard section and Health Metrics ED-only, in `apps/lfx-one/src/app/modules/dashboards/executive-director/executive-director-dashboard.component.html` / `.ts` (and the board-member/foundation dashboard component if the section must render there). Depends on T008.

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story verification and hardening.

- [x] T025 [P] Extend `apps/lfx-one/e2e/persona-navigation.spec.ts` to assert Health Metrics + the rest of the ED dashboard stay ED-only, and that a project writer/owner with no marketing grant sees zero marketing surfaces.
- [x] T026 Run `yarn check-types`, `yarn lint:check`, and `yarn build` from repo root; fix any issues. — All three pass (member-ordering error from an initial private helper fixed by inlining the marketing probe into `getProjectById`). Remaining lint warning (`org-project-detail.component.ts`) and the fullcalendar SCSS budget warning are pre-existing and unrelated.
- [ ] T027 Execute the six validation scenarios in `specs/002-marketing-ops-ui-access/quickstart.md` against the shared dev environment. — DEFERRED: requires the running shared dev environment + FGA fixtures (T001). E2E specs (`marketing-access.spec.ts`, `persona-navigation.spec.ts`) encode the matrix and run in CI once fixtures exist.
- [x] T028 [P] Document in the PR description the residual risk that `/api/analytics/*` and `/api/campaigns/*` remain directly callable until backend enforcement (LFXV2-2235) lands (spec Out of Scope / research R7). — Risk note drafted (see Completion Report); to be pasted into the PR description at open time.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: after Setup; BLOCKS all user stories. Internal order: T003/T004 → T005 → T006; T004 → T007 → T008.
- **User Stories (Phase 3–5)**: after Foundational (specifically T007 + T008). US1 and US2 are independent of each other; US3 depends only on T008.
- **Polish (Phase 6)**: after the targeted stories are complete.

### User Story Dependencies

- **US1 (P1)**: needs T007, T008. Self-contained (lens + nav + guard + Marketing Impact).
- **US2 (P1)**: needs T007, T008. Independent of US1 (shares only the sidebar file T017/T022 and routes file T016/T021 — sequence those, no logic coupling).
- **US3 (P2)**: needs T008. Independent; reuses the `canManageCampaigns` signal from Foundational.

### Same-file sequencing (avoid conflicts)

- `app.routes.ts`: T016 (US1) then T021 (US2).
- `sidebar-nav.service.ts`: T017 (US1) then T022 (US2).
- `persona-detection.service.ts`: T010 then T012.
- `project.service.ts` (server): T005 then T006 (controller is a separate file).

### Parallel Opportunities

- Foundational: T003 and T004 in parallel (different files).
- US1: T009 (test), T011, and T015 (guard) are `[P]` — different files, no incomplete deps beyond Foundational.
- US2: T019 (test) and T020 (guard) in parallel.
- US3: T023 (test) in parallel with US1/US2 implementation.
- Cross-story: once Foundational is done, a developer can take US1, another US2, another US3.

---

## Parallel Example: Foundational + US1 kickoff

```bash
# Foundational shared types (parallel):
Task: "Extend AccessCheckAccessType in packages/shared/src/interfaces/access-check.interface.ts"
Task: "Add Project.marketingAuditor/campaignManager in packages/shared/src/interfaces/project.interface.ts"

# After T007/T008, US1 parallelizable tasks:
Task: "E2E marketing view matrix in apps/lfx-one/e2e/marketing-access.spec.ts"
Task: "Add isRootMarketingAuditor to personas interface in packages/shared/src/interfaces/persona-detection.interface.ts"
Task: "Create marketingViewGuard in apps/lfx-one/src/app/shared/guards/marketing-view.guard.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (T003–T008).
2. Phase 3 US1 (T009–T018).
3. **STOP and VALIDATE**: non-ED marketing users can navigate + view Marketing Impact per project; Health Metrics stays ED-only.
4. Demo.

### Incremental Delivery

1. Foundation ready → US1 (MVP: view + navigation) → validate/demo.
2. US2 (campaign management) → validate/demo.
3. US3 (Marketing Overview section) → validate/demo.
4. Polish → full E2E matrix + gates + quickstart.

---

## Notes

- No ED persona fast-path in either guard — per-project correctness is the core requirement (research R3).
- Fail closed everywhere: `undefined`/`false`/probe error ⇒ no access.
- Keep the Marketing Impact page and Marketing Overview section read-only; Campaigns is all-or-nothing on `campaign_manager` (no view-only tier).
- Two open items are embedded as tasks: nav lens-items hierarchy for non-board users (T018) and Marketing Overview placement (T024).
- Backend/BFF authorization enforcement of the marketing APIs is out of scope (owned by LFXV2-2235); T028 documents the interim risk.
- Commit after each task or logical group; `git commit --signoff -S`.
