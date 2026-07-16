# Quickstart / Validation Guide: Marketing Ops UI Access

Runnable scenarios that prove the feature works end-to-end. Implementation details live in `data-model.md`, `contracts/`, and (once generated) `tasks.md`.

## Prerequisites

- Local dev per `/setup` (shared dev environment; auth via Authelia at `auth.k8s.orb.local`).
- OpenFGA tuples for validation (manual — see LFXV2-1760 / `/nats` tuple insertion):
  - A **Marketing Ops** team member (non-ED) with `marketing_ops` (⇒ `marketing_auditor` + `campaign_manager`) reaching one or more projects (ideally granted at ROOT so it cascades).
  - A **Marketing Auditor** (non-ED, non-ops) with `marketing_auditor` on a specific project only.
  - An **ED** of a specific project.
  - A **project writer/owner** with NO marketing grant.
- Note the slugs/UIDs of: one project the marketing users are granted on (P-granted) and one they are not (P-denied).

## Setup

```bash
yarn install
yarn start        # Angular SSR dev server with hot reload
```

Sign in as each test user in turn (or use the dev persona/impersonation toolbar where applicable).

## Type / build gates

```bash
yarn check-types
yarn lint:check
yarn build
```

Expected: all pass (shared union + `Project` field edits compile across app + server + shared).

## Scenario 1 — Marketing Ops (non-ED) can view + manage (US1, US2, SC-001/002/008)

1. Sign in as the Marketing Ops user.
2. Confirm the **"Projects"/foundation lens** is available (validates `isRootMarketingAuditor` → lens gate).
3. Select **P-granted**. Expect the **Marketing** sidebar section with **Marketing Impact** and **Campaigns**.
4. Open **Marketing Impact** → dashboards load, no actions (read-only).
5. Open **Campaigns** → page loads with full view + action affordances.
6. Select **P-denied**. Expect the Marketing section to disappear; navigating directly to `/foundation/marketing-impact?project=<P-denied>` and `/foundation/campaigns?project=<P-denied>` redirects to `/foundation/overview`.

## Scenario 2 — Marketing Auditor: view only, no campaigns (US1, US2, SC-001/002)

1. Sign in as the Marketing Auditor.
2. Select the project they are granted on.
3. Expect **Marketing** section + **Marketing Impact** (read-only). Expect **NO Campaigns** link.
4. Navigate directly to `/foundation/campaigns?project=<slug>` → redirected away (blocked).
5. Confirm the dashboard **Marketing Overview** section is **not** shown.

## Scenario 3 — ED unchanged, no regression (US2, SC-005/007)

1. Sign in as the ED of a project.
2. For their project: Marketing Impact, Campaigns (full), and the Marketing Overview section all render; **Health Metrics** and the rest of the ED dashboard render.
3. For a project they are NOT ED of and hold no marketing grant on: marketing surfaces are hidden/blocked (validates per-project correctness — no global persona fast-path).

## Scenario 4 — Broad project role, no marketing grant (SC-006)

1. Sign in as the project writer/owner without a marketing grant.
2. Select their project. Expect **zero** marketing surfaces (no section, no Marketing Overview) and blocked marketing routes, even though other project areas work.

## Scenario 5 — Health Metrics stays ED-only (SC-005)

1. As each non-ED marketing user, confirm **Health Metrics** is absent from nav and `/foundation/health-metrics` redirects to `/foundation/overview`.

## Scenario 6 — Context switch re-evaluation (SC-009)

1. As the Marketing Auditor, switch between P-granted and P-denied using the project selector.
2. Confirm marketing surfaces appear/disappear per project without a full page reload.

## Automated coverage

- Extend `apps/lfx-one/e2e/persona-navigation.spec.ts` (and/or a new `marketing-access.spec.ts`) with the role→UI matrix in `contracts/ui-visibility.contract.md`.
- Assert on existing test IDs: `sidebar-marketing-impact`, `sidebar-marketing-campaigns`, plus new ones for the Marketing Overview section if needed.

## Known validation caveat

Until backend enforcement (LFXV2-2235) lands, `/api/analytics/*` and `/api/campaigns/*` remain directly callable regardless of UI gating — UI-level checks are what this ticket validates (see spec Out of Scope / research R7).
