# Implementation Plan: Marketing Ops UI Access (FGA-guarded Marketing pages)

**Branch**: `feat/LFXV2-2236-add-marketing-ops-ui-access` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-marketing-ops-ui-access/spec.md`

## Summary

Replace ED-persona-only gating of the Marketing surfaces with **per-project OpenFGA checks**. The Marketing navigation section and **Marketing Impact** page are gated on `marketing_auditor` (ED + Marketing Ops + Marketing Auditor, read-only); the **Campaigns** page and the dashboard **Marketing Overview** section are gated on `campaign_manager` (= ED + Marketing Ops, full view + actions). **Health Metrics** and the rest of the ED dashboard stay ED-only.

Technical approach: extend the existing BFF `AccessCheckService` access-type union with `marketing_auditor` and `campaign_manager`, enrich the project fetch with probe-gated `marketingAuditor` / `campaignManager` booleans (mirroring the existing `meetingCoordinator` pattern), expose reactive per-context access signals to the Angular app, and add FGA-backed route guards + reactive sidebar/nav/dashboard-section visibility. A ROOT-scoped marketing probe (mirroring `isRootWriter`) surfaces the "Projects"/foundation lens and project selector to non-ED marketing users so they can navigate to any authorized project.

## Technical Context

**Language/Version**: TypeScript 5.x; Angular 20 (stable zoneless, SSR); Node.js ≥22; Express.js BFF

**Primary Dependencies**: Angular Router (functional guards), RxJS, PrimeNG (wrapped in LFX components), `@lfx-one/shared` (types/constants), upstream `LFX_V2_SERVICE` `/access-check` (OpenFGA), NATS (persona detection)

**Storage**: N/A — authorization tuples live in the upstream OpenFGA model; no local persistence changes. Access decisions are read-through per request (with existing `shareReplay`/request caches).

**Testing**: Playwright E2E (dual content + structural specs, e.g. `e2e/persona-navigation.spec.ts`); `yarn check-types`, `yarn lint:check`, `yarn build` gates; header/format preflight.

**Target Platform**: Web — Angular SSR (Express) + browser hydration.

**Project Type**: Web application (Angular frontend + Express BFF) in a Turborepo monorepo with a shared package.

**Performance Goals**: No new latency targets. Each guarded navigation adds at most one `/access-check` round-trip per project context, batched (both relations in one call where possible) and de-duplicated via the existing `getProject` `shareReplay` cache. Persona-based fast paths are intentionally NOT used (see Constraints).

**Constraints**:
- **Per-project correctness**: access MUST be evaluated against the selected project's UID — no global persona fast-path (an ED of Project A must not pass for Project B). This differs from `newsletterAccessGuard`, which keeps an ED persona fast-path.
- **Fail closed**: any probe error ⇒ treat as no access (matches `AccessCheckService` fallback + guard denial).
- **SSR-safe**: guards run on server and client; no browser-only APIs without `isPlatformBrowser`; persona/lens state is cookie-seeded.
- **No data before authorization**: marketing data requests only fire after the governing access check passes for the selected project.
- **Repo conventions** (de-facto constitution — see Constitution Check): shared types in `@lfx-one/shared`, MIT headers, no nested ternaries, direct standalone imports, DELETE→CREATE for full component replacements.

**Scale/Scope**: Frontend + BFF change only. ~2 shared type edits, ~2 BFF service/controller edits, ~2 new guards, ~3 reactive access signals, sidebar/nav + lens + one dashboard-section visibility change, route wiring for 2 routes. No new modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution file (`.specify/memory/constitution.md`) is an unpopulated template, so there are no ratified numbered principles to gate against. In its place, this plan is gated against the repository's documented conventions (`CLAUDE.md`, `.claude/rules/`, `docs/architecture/`), which serve as the de-facto constitution:

| Gate | Assessment |
|------|------------|
| Shared types in `@lfx-one/shared` (no local `interface`/module consts in `apps/lfx-one`) | PASS — new access types and `Project` fields go in `packages/shared`. |
| Types in `interfaces/`, runtime values in `constants/` | PASS — union edits are in `.interface.ts`; no new runtime constants required beyond existing. |
| PrimeNG interface referencing / LFX component wrappers | PASS — no new UI primitives; reuse existing sidebar/nav/dashboard components. |
| SSR safety | PASS — guards/services are SSR-safe; no new browser-only APIs. |
| Security: prefer per-project FGA over persona; fail closed | PASS — core design intent. |
| Component replacement rule (DELETE→CREATE) | PASS — changes are non-breaking in-place edits (visibility gates, route data), not full component replacements. |
| MIT license headers on new files | PASS — new guard(s)/service(s) will include headers. |

**Result**: PASS (no violations; Complexity Tracking not required).

## Project Structure

### Documentation (this feature)

```text
specs/002-marketing-ops-ui-access/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── access-check.contract.md
│   ├── project-probe.contract.md
│   └── ui-visibility.contract.md
├── checklists/
│   └── requirements.md  # created by /speckit-specify
└── tasks.md             # created by /speckit-tasks (NOT this command)
```

### Source Code (repository root)

```text
packages/shared/src/interfaces/
├── access-check.interface.ts     # + 'marketing_auditor' | 'campaign_manager' on AccessCheckAccessType
└── project.interface.ts          # + marketingAuditor?, campaignManager? (response-only, probe-gated)

apps/lfx-one/src/server/
├── services/project.service.ts   # getProjectById: probe-gated marketing enrichment (like meetingCoordinator)
├── controllers/project.controller.ts  # read ?marketing=true|?marketing_auditor / ?campaign_manager flags
└── services/persona-detection.service.ts  # + checkRootMarketingAuditor (mirrors checkRootWriter) → drives lens

apps/lfx-one/src/app/shared/
├── guards/
│   ├── marketing-view.guard.ts       # NEW — marketing_auditor on selected project (Marketing Impact + nav)
│   └── campaign-access.guard.ts      # NEW — campaign_manager on selected project (Campaigns)
├── services/
│   ├── project-context.service.ts    # + canViewMarketing / canManageCampaigns reactive signals
│   ├── persona.service.ts            # + isRootMarketingAuditor signal (from personas API)
│   ├── lens.service.ts               # getAllowedLensIds: surface foundation lens for marketing users
│   └── sidebar-nav.service.ts        # Marketing section gated by canViewMarketing; Campaigns by canManageCampaigns
└── ...

apps/lfx-one/src/app/app.routes.ts   # marketing-impact → marketingViewGuard; campaigns → campaignAccessGuard; health-metrics unchanged (executiveDirectorGuard)

apps/lfx-one/src/app/modules/dashboards/
├── executive-director/executive-director-dashboard.component.*   # Marketing Overview section gate → campaign_manager signal
└── (foundation dashboard path for non-ED marketing_ops — see research decision R2)

apps/lfx-one/e2e/                     # extend persona/navigation specs with marketing role matrix
```

**Structure Decision**: Web application in the existing Turborepo monorepo. Changes are confined to `packages/shared` (types), `apps/lfx-one/src/server` (BFF probe enrichment + ROOT marketing signal), and `apps/lfx-one/src/app` (guards, access signals, nav/lens/dashboard visibility, route wiring). No new feature module is introduced — the Marketing pages already exist under `modules/dashboards/`.

## Complexity Tracking

No constitution violations; this section is intentionally empty.
