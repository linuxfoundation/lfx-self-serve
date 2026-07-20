<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Persona × Lens Content Matrix

Maps every persona to the sidebar links and key pages it can see in each lens. Use this as the source of truth when adding new nav items, writing persona regression tests, or auditing access gating.

For background on how personas and lenses are resolved, see [Lens & Persona System](./lens-system.md). For where the persona values themselves come from (the upstream detection contract and mapping), see [Persona Detection Pipeline](./persona-detection.md).

## Personas

| Persona              | How acquired                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `contributor`        | Default project-scoped persona; assigned when no other project detection matches, or as a fallback |
| `maintainer`         | Has a `cdp_roles` detection carrying a `maintainer` role for a project                             |
| `board-member`       | Has a `board_member` detection on a foundation                                                     |
| `executive-director` | Has an `executive_director` detection on a foundation, OR is a root writer (injected)              |

A user can carry multiple personas simultaneously. When no explicit selection has been made, `PersonaService` defaults to the highest-priority persona (`executive-director` > `board-member` > `maintainer` > `contributor`). A user can explicitly **pin** a lower-priority persona (e.g., switch from ED to board-member view) — `PersonaService` preserves that choice across refreshes as long as the persona is still in the allowed set (`userSelected` flag). The active `currentPersona()` signal — not a static priority rule — drives which conditional sidebar sections are shown.

## Lenses and access rules

| Lens         | Who can use it                                                                      |
| ------------ | ----------------------------------------------------------------------------------- |
| `me`         | All authenticated users                                                             |
| `foundation` | Users with `hasBoardRole` (`board-member` or `executive-director`), or root writers |
| `project`    | Users with `hasProjectRole` (`maintainer` or `contributor`), or root writers        |
| `org`        | All users (feature-flagged via `ORG_LENS_ENABLED_FLAG`)                             |

A user can carry both board and project roles simultaneously. In the sidebar lens switcher, hybrid users see a single merged **project** lens entry instead of separate `foundation` and `project` buttons — `LensService.displayLenses` filters the `foundation` option for hybrids so the `project` button serves as the unified entry point for both.

## Key conditions referenced in the matrix

| Condition                 | Definition                                                                                                                         | Source                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `canWrite()`              | `ProjectContextService.canWrite` — reactive signal; true when the user has write/manage access to the active foundation or project | `project-context.service.ts` |
| `canSeeNewsletters()`     | `currentPersona() === 'executive-director' \|\| canWrite()`                                                                        | `main-layout.component.ts`   |
| `foundationHasProjects()` | True when the selected foundation has ≥1 project row in Snowflake; cleared while fetching                                          | `main-layout.component.ts`   |

---

## Me Lens

**Identical for all personas.** Static items — no runtime persona conditions.

| Section       | Item                      | Route                   |
| ------------- | ------------------------- | ----------------------- |
| _(top-level)_ | My Dashboard              | `/`                     |
| My Engagement | My Meetings               | `/meetings`             |
|               | My Events                 | `/events`               |
|               | My Committees             | `/groups`               |
|               | My Mailing Lists          | `/mailing-lists`        |
|               | My Votes                  | `/votes`                |
|               | My Surveys                | `/surveys`              |
|               | My Documents              | `/documents`            |
| My Growth     | Training & Certifications | `/me/training`          |
|               | Mentorships               | _(external link)_       |
|               | Crowdfunding              | _(external link)_       |
|               | Badges                    | `/badges`               |
| My Account    | Profile                   | `/profile`              |
|               | Settings                  | `/profile/settings`     |
|               | Transactions              | `/profile/transactions` |

---

## Foundation Lens

Available to `board-member`, `executive-director`, and root writers.

| Sidebar item / section     | Route                          | Visible to                                                             |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Dashboard                  | `/foundation/overview`         | All foundation users                                                   |
| Projects                   | `/foundation/projects`         | All — **only when** `foundationHasProjects()` is true                  |
| Meetings                   | `/foundation/meetings`         | All foundation users                                                   |
| Events                     | `/foundation/events`           | All foundation users                                                   |
| Mailing Lists              | `/foundation/mailing-lists`    | All foundation users                                                   |
| Committees                 | `/foundation/groups`           | All foundation users                                                   |
| Documents                  | `/foundation/documents`        | All foundation users                                                   |
| **Governance** section     |                                |                                                                        |
| → Votes                    | `/foundation/votes`            | All foundation users                                                   |
| → Surveys                  | `/foundation/surveys`          | All foundation users                                                   |
| → Permissions              | `/foundation/settings`         | All foundation users                                                   |
| **Communications** section |                                | `canSeeNewsletters()` — ED **or** `canWrite()`                         |
| → Newsletters              | `/foundation/newsletters`      | `canSeeNewsletters()`                                                  |
| **Metrics** section        |                                | `executive-director` only                                              |
| → Health Metrics           | `/foundation/health-metrics`   | `executive-director`                                                   |
| → Social Listening         | _(PCC external link)_          | `executive-director` — **only when** `selectedFoundationSfid()` is set |
| **Marketing** section      |                                | `executive-director` only                                              |
| → Marketing Impact         | `/foundation/marketing-impact` | `executive-director`                                                   |
| → Campaigns                | `/foundation/campaigns`        | `executive-director`                                                   |

### Foundation lens by persona summary

| Persona              | Sees Governance | Sees Newsletters (Communications) | Sees Metrics | Sees Marketing |
| -------------------- | --------------- | --------------------------------- | ------------ | -------------- |
| `board-member`       | Yes             | Only if `canWrite()`              | No           | No             |
| `executive-director` | Yes             | Yes (always)                      | Yes          | Yes            |

---

## Project Lens

Available to `contributor`, `maintainer`, and root writers.

| Sidebar item / section     | Route                    | Visible to                                     |
| -------------------------- | ------------------------ | ---------------------------------------------- |
| Dashboard                  | `/project/overview`      | All project users                              |
| Meetings                   | `/project/meetings`      | All project users                              |
| Mailing Lists              | `/project/mailing-lists` | All project users                              |
| Committees                 | `/project/groups`        | All project users                              |
| Documents                  | `/project/documents`     | All project users                              |
| **Governance** section     |                          |                                                |
| → Votes                    | `/project/votes`         | All project users                              |
| → Surveys                  | `/project/surveys`       | All project users                              |
| → Permissions              | `/project/settings`      | All project users                              |
| **Communications** section |                          | `canSeeNewsletters()` — ED **or** `canWrite()` |
| → Newsletters              | `/project/newsletters`   | `canSeeNewsletters()`                          |

### Project lens by persona summary

| Persona       | Sees Governance | Sees Newsletters (Communications) |
| ------------- | --------------- | --------------------------------- |
| `contributor` | Yes             | Only if `canWrite()`              |
| `maintainer`  | Yes             | Only if `canWrite()`              |

> **Note:** `canWrite()` is resolved from `ProjectContextService` and reflects the user's write access to the currently-selected project, not their persona level globally. A `contributor` who is a project manager (write access) will see Newsletters.

---

## Org Lens

**Feature-flagged** via `ORG_LENS_ENABLED_FLAG`. When the flag is off, `orgLensEnabledGuard` (CanMatch) blocks all `/org/*` routes in the browser and redirects to `/` — the routes are invisible to the router. On the server during SSR, LaunchDarkly is unavailable, so the guard returns `true` and defers the real enforcement to the browser after hydration. When the flag is enabled, the Org Lens is identical for all personas.

| Section         | Item                     | Route                |
| --------------- | ------------------------ | -------------------- |
| _(top-level)_   | Org Overview             | `/org/overview`      |
| Org Foundations | Memberships              | `/org/memberships`   |
|                 | Projects                 | `/org/projects`      |
|                 | ROI                      | `/org/roi`           |
|                 | Governance               | `/org/governance`    |
| Org Engagement  | People                   | `/org/people`        |
|                 | Code Contributions       | `/org/contributions` |
|                 | Events                   | `/org/events`        |
|                 | Training & Certification | `/org/training`      |
|                 | Meetings                 | `/org/meetings`      |
|                 | Committees               | `/org/groups`        |
| Org Admin       | Profile                  | `/org/profile`       |

---

## Route-level guards

Guards enforce access at the router level — regardless of whether a sidebar link is visible.

| Guard                    | Protected routes                                                                        | Access rule                                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executiveDirectorGuard` | `/foundation/health-metrics`, `/foundation/marketing-impact`, `/foundation/campaigns`   | `currentPersona() === 'executive-director'`                                                                                                                                                                         |
| `newsletterAccessGuard`  | `/newsletters` (lens redirect), `/foundation/newsletters`, `/project/newsletters`       | `canSeeNewsletters()` — ED or `canWrite()`                                                                                                                                                                          |
| `writerGuard`            | Create/edit routes for meetings, committees, mailing lists, surveys, votes (all lenses) | `executive-director` (fast path) or project `writer`; meetings routes also allow `meetingCoordinator` or `committee.writer` when `?committee_uid=` is set — see [Meetings write paths](#meetings-write-paths) below |
| `orgLensEnabledGuard`    | `/org/*` (CanMatch — routes invisible when flag is off)                                 | Browser: `ORG_LENS_ENABLED_FLAG` must be `true`; redirects to `/` otherwise. SSR: always returns `true` — enforcement defers to browser after hydration                                                             |

Guards are defined in `apps/lfx-one/src/app/shared/guards/`.

---

## Write-action gating per feature domain

The `writerGuard` protects create and edit routes. Within read-only pages, UI elements (add/edit/delete buttons) are additionally gated by `canWrite()` (project `writer` on the active context) or feature-specific signals — meetings use `canWriteMeetings` on the dashboard and `committee.writer` on the committee Meetings tab.

| Domain                 | Create/edit route guard | In-page UI gating                                                                          |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| Meetings               | `writerGuard`           | Dashboard CTA: `project.writer` or `meetingCoordinator`; committee tab: `committee.writer` |
| Committees             | `writerGuard`           | `canWrite()`                                                                               |
| Mailing Lists          | `writerGuard`           | `canWrite()`                                                                               |
| Surveys                | `writerGuard`           | `canWrite()`                                                                               |
| Votes                  | `writerGuard`           | `canWrite()`                                                                               |
| Settings / Permissions | —                       | `canWrite()` — view-only banner shown to non-writers                                       |

### Meetings write paths

Meeting create/edit is **manage/write permission**, not persona. A user with only the `contributor` persona can still create meetings when they hold a committee writer role.

| Layer               | Rule                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Route guard**     | `writerGuard` with `data.writeFeature === 'meetings'`: ED fast path; else `project.writer`, `project.meetingCoordinator`, or `committee.writer` when `?committee_uid=` is in the query (from committee Meetings tab).                                                                                              |
| **Dashboard CTA**   | Meetings list (`/meetings`): `canWriteMeetings` — `project.writer` or `meetingCoordinator` on the active project context (no committee-writer path on this surface).                                                                                                                                               |
| **Committee tab**   | Committee Meetings tab: `committee.writer` checked fresh before navigating to `/meetings/create` with `committee_uid` + `project` query params.                                                                                                                                                                    |
| **Meeting service** | `POST /itx/meetings`: OpenFGA `meetings_creator` on `project:{project_uid}` **or** `writer` on `committee:{committees[0].uid}` when the body includes committees ([LFXV2-2395](https://linuxfoundation.atlassian.net/browse/LFXV2-2395)). Update/delete/registrant routes unchanged (`organizer` on `v1_meeting`). |

> Broader backend write enforcement gaps are tracked in [LFXV2-1662](https://linuxfoundation.atlassian.net/browse/LFXV2-1662).

---

## Session eviction on access loss

`evictOnWriteAccessLoss()` (`apps/lfx-one/src/app/shared/utils/`) subscribes to `canWrite` reactively. If write access is revoked mid-session (e.g., an admin removes the user's permission), the utility redirects to a safe page automatically.

---

## Related documents

- [Lens & Persona System](./lens-system.md) — how lenses and personas are resolved and enforced
- [Angular Patterns](./angular-patterns.md) — zoneless change detection and signals
- [`main-layout.component.ts`](../../../apps/lfx-one/src/app/layouts/main-layout/main-layout.component.ts) — authoritative source for sidebar item definitions
- [`app.routes.ts`](../../../apps/lfx-one/src/app/app.routes.ts) — route guard wiring
