# Phase 0 Research: Marketing Ops UI Access

This document resolves the open design decisions for gating the Marketing surfaces on OpenFGA per-project relations. Each decision records what was chosen, why, and the alternatives considered. File references are to the current code on disk.

## R1 — Where and how to evaluate the marketing grants

**Decision**: Reuse the existing BFF `AccessCheckService` + `getProjectById` enrichment pattern. Extend `AccessCheckAccessType` with `marketing_auditor` and `campaign_manager`, and enrich the project fetch with **probe-gated** `marketingAuditor` / `campaignManager` booleans, exactly like the existing `meetingCoordinator` probe.

**Rationale**:

- `AccessCheckService.checkAccess` already builds `resource:id#access` requests against upstream `/access-check` (OpenFGA) and returns a boolean map, with a fail-closed fallback (`apps/lfx-one/src/server/services/access-check.service.ts:26-108`).
- `getProjectById` already attaches `writer` unconditionally and `meetingCoordinator` only when requested (`apps/lfx-one/src/server/services/project.service.ts:306-345`), and the controller reads a `?meeting_coordinator=true` flag (`project.controller.ts:113`). Marketing grants follow the same probe-gated shape so we don't add two access-check round-trips to every project fetch app-wide.
- The Angular app never calls OpenFGA directly; it consumes BFF-enriched booleans (`project.writer`, `committee.writer`, org role-grant sets). Marketing access should follow suit.

**Alternatives considered**:

- _Dedicated `/api/access/marketing` endpoint_: more surface area; the project fetch already resolves slug→uid and is cached (`shareReplay`) in `ProjectService.getProject`. Rejected for now; can be revisited if LFXV2-2235 ships a batched rule-set probe (which we would then consume).
- _Front-end direct FGA calls_: violates the established BFF-mediated pattern and leaks authorization transport into the client. Rejected.

**Note on LFXV2-2235**: The ticket lists a BFF access-probe / RuleSets dependency. The existing `/access-check` already supports the two relations once the union is extended, and both can be checked in one batched call. If 2235 delivers a consolidated probe, swap the transport behind the same enrichment/​signal API without changing the Angular surface.

## R2 — Surfacing the "Projects"/foundation lens to non-ED marketing users

**Problem**: `LensService.getAllowedLensIds()` grants the foundation lens only to `hasBoardRole || isRootWriter` (`apps/lfx-one/src/app/shared/services/lens.service.ts:111-131`). A pure Marketing Ops / Marketing Auditor user (no board/ED persona) therefore cannot see the "Projects"/foundation lens or its project selector, and cannot reach the Marketing pages at all.

**Decision**: Add a ROOT-scoped marketing signal that mirrors `isRootWriter`. On the BFF, add `checkRootMarketingAuditor(req)` to `PersonaDetectionService` (mirrors `checkRootWriter`, `persona-detection.service.ts:117-133`) probing `marketing_auditor` on the ROOT project; return it on the personas API response. In `PersonaService`, expose an `isRootMarketingAuditor` signal (parallel to `isRootWriter`). In `getAllowedLensIds()`, set `showFoundation = hasBoardRole || isRootWriter || isRootMarketingAuditor`.

**Rationale**:

- `marketing_auditor` cascades from ROOT, so a ROOT grant is the correct, cheapest single probe that means "this user has marketing visibility somewhere in the hierarchy" — the exact condition for offering the foundation lens.
- `isRootWriter` already establishes the pattern of a request-scoped ROOT access probe that promotes navigation capability; this is a minimal, well-trodden extension.
- Per-project gating still applies after lens selection — the lens signal only decides whether the user can _navigate_; the guards decide what they can _open_.

**Alternatives considered**:

- _Grant foundation lens to everyone and rely on guards_: over-exposes the lens/selector to users with no marketing access; poor UX and inconsistent with existing lens gating. Rejected.
- _Derive from the personas list only_: marketing_ops is not a persona; encoding it as a persona would blur the persona (presentation) vs. authorization (FGA) separation documented in the frontend permission model. Rejected.

**Consequence for the project selector**: The foundation/project selectors are populated by `NavigationService` from `/api/nav/lens-items`. Marketing users must be able to browse/search all projects they can audit (FR-002/SC-008). Confirm the lens-items source returns the hierarchy for marketing-cascaded users; if it is persona-scoped, extend it to include marketing-audited projects. This is flagged as a task-level verification in `tasks`.

## R3 — Route guards: no ED persona fast-path

**Decision**: Add two functional guards — `marketingViewGuard` (checks `project.marketingAuditor`) and `campaignAccessGuard` (checks `project.campaignManager`) — modeled on `newsletterAccessGuard` (`apps/lfx-one/src/app/shared/guards/newsletter-access.guard.ts`) **but without** the `currentPersona() === 'executive-director'` fast-path. Slug resolution prefers `?project=` then active context; denial redirects to `/foundation/overview` preserving `?project=`.

**Rationale**:

- The ticket requires _per-project_ correctness; a global ED persona fast-path would wrongly admit an ED to a project they don't hold the relation on. Because the OpenFGA relations already include `executive_director` (`marketing_auditor` and `campaign_manager` both resolve ED), the FGA check alone correctly admits EDs for their own projects with no regression (FR-016).
- Reusing `getProject(slug, false, { marketing: true })` gives the guard the enriched booleans and shares the `shareReplay` cache with the page's own fetch, avoiding duplicate round-trips.

**Alternatives considered**:

- _One parameterized guard keyed on `route.data.marketingAccess`_: viable and slightly DRYer, but two tiny explicit guards read more clearly at the route table and match the existing one-guard-per-concern style (`writerGuard`, `newsletterAccessGuard`). Either is acceptable; default to two guards, collapse if review prefers.
- _Keep `executiveDirectorGuard` + add an OR_: keeps the incorrect global persona path. Rejected.

**Health Metrics**: `foundation/health-metrics` keeps `executiveDirectorGuard` unchanged (FR-012).

## R4 — Reactive visibility for nav, sidebar, and the Marketing Overview section

**Decision**: Add reactive per-context access signals on `ProjectContextService` — `canViewMarketing` (marketing_auditor) and `canManageCampaigns` (campaign_manager) — computed from `getProject(activeContext.slug, false, { marketing: true })`, mirroring the existing `canWrite()` (`project-context.service.ts:176-190`). Drive:

- **Sidebar Marketing section + Marketing Impact entry** on `canViewMarketing()` (replacing the `currentPersona() === 'executive-director'` gate in `sidebar-nav.service.ts:329-378`).
- **Campaigns entry** on `canManageCampaigns()`.
- **Dashboard Marketing Overview section** on `canManageCampaigns()` (ED + Marketing Ops), read-only.
- **Metrics/Health Metrics section** stays gated on ED persona (unchanged).

**Rationale**: Matches the existing `initCanSeeNewsletters()` reactive pattern (`sidebar-nav.service.ts:513-515`) and keeps a single source of truth for "can this user see marketing here" that both nav and page components consume. Signals re-evaluate automatically on context switch (FR-009/SC-009).

**Alternatives considered**:

- _Persona-only sidebar gate (status quo)_: fails the core requirement. Rejected.
- _Per-component ad-hoc probes_: duplicates round-trips and drifts logic. Rejected.

## R5 — Presenting the Marketing Overview section to non-ED Marketing Ops

**Problem**: `MarketingOverviewComponent` renders only inside `ExecutiveDirectorDashboardComponent`, which the shell shows only when `foundationDashboardType() === 'executive-director'` (`dashboard.component.html:39-43`, `dashboard.component.ts:54-57`). A non-ED Marketing Ops user resolves to the board-member dashboard and would never see the section.

**Decision**: Gate the Marketing Overview _section_ on the `canManageCampaigns()` signal (ED + Marketing Ops) rather than on the ED dashboard shell, and render it in the foundation dashboard for both dashboard variants when the signal is true (read-only). Keep every other ED-dashboard section and Health Metrics ED-only. Concretely: extract/guard the `<lfx-marketing-overview />` placement so it appears wherever a foundation-lens user with `campaign_manager` lands, independent of persona.

**Rationale**: The binding requirement (FR-007) is the visibility rule (ED + Marketing Ops, read-only, no one else), not the shell it lives in. Gating on the same `campaign_manager` signal that governs Campaigns keeps the audience identical and avoids a persona dependency. The component is already read-only (no mutating actions), satisfying "no actions."

**Alternatives considered**:

- _Give marketing_ops the full ED dashboard_: would expose ED-only sections (pending actions, foundation health, etc.) to non-EDs — violates FR-013/SC-005. Rejected.
- _Defer entirely to design_: acceptable as a planning-deferred item (recorded in spec), but the gate-by-signal approach is low-risk and unblocks implementation; adopt it as the default and confirm placement during `/speckit-tasks`.

## R6 — Shared type shape

**Decision**:

- `AccessCheckAccessType` → `'writer' | 'viewer' | 'organizer' | 'meeting_coordinator' | 'marketing_auditor' | 'campaign_manager'` (`packages/shared/src/interfaces/access-check.interface.ts:45`).
- `Project` → add `marketingAuditor?: boolean` and `campaignManager?: boolean` as response-only, probe-gated fields. When requested they are always boolean and **fail closed** (`false` on no grant or transient upstream failure); `undefined` means only that the probe was not requested (never a transient-failure signal), so guards read `!== true` as no access.

**Rationale**: Keeps all contracts in `@lfx-one/shared` per repo rules; the optional/undefined semantics prevent guards from misreading an un-probed fetch as a denial. Note: `AccessCheckService.addAccessToResource` spreads `{ [accessType]: value }`, so a `campaign_manager` probe yields a `campaign_manager` key — map it to the camelCase `campaignManager` field in `getProjectById` (as done for the writer/meetingCoordinator mapping) rather than relying on the raw snake_case key.

**Alternatives considered**: A separate `MarketingAccess` interface returned by a dedicated endpoint — heavier; rejected in favor of project enrichment (R1).

## R7 — Server-side enforcement boundary

**Decision**: This ticket enforces in the UI (probe-before-call + guard/hide) only; authoritative enforcement of `/api/analytics` and `/api/campaigns` is owned by LFXV2-2235 / backend (spec Assumptions + Out of Scope). Record the residual risk (marketing APIs remain directly callable until backend enforcement lands) in the PR description.

**Rationale**: Matches the ticket scope ("frontend; may consume BFF access probe") and its dependency on LFXV2-2235. Avoids duplicating/forking authorization logic in the BFF ahead of the owning work.

**Alternatives considered**: Add `requireExecutiveDirector`-style middleware to marketing routes now — but that middleware is persona-based and ED-only, which is exactly what we're moving away from; a correct BFF gate needs the FGA relations and belongs with 2235. Rejected for this ticket.

## Open items carried to /speckit-tasks

- Verify `/api/nav/lens-items` (foundation) returns the marketing-audited hierarchy for non-board users; extend if persona-scoped (R2 consequence).
- Confirm final placement of the Marketing Overview section render for the board-member/foundation dashboard variant (R5).
- Decide one-parameterized-guard vs. two-guards at review preference (R3).
