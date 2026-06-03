<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Persona × Lens Content Matrix

Maps every persona to the sidebar links and key pages it can see in each lens. Use this as the source of truth when adding new nav items, writing persona regression tests, or auditing access gating.

For background on how personas and lenses are resolved, see [Lens & Persona System](./lens-system.md).

## Personas

| Persona              | How acquired                                                    |
| -------------------- | --------------------------------------------------------------- |
| `contributor`        | Lowest-privilege; any authenticated user with no committee role |
| `maintainer`         | Has a project-level maintainer committee membership             |
| `board-member`       | Has a board committee membership on a foundation                |
| `executive-director` | Has an ED committee membership, OR is a root writer (injected)  |

A user can carry multiple personas simultaneously. The **primary** persona is the highest-priority one (`executive-director` > `board-member` > `maintainer` > `contributor`) and drives conditional sidebar sections.

## Lenses and access rules

| Lens         | Who can use it                                                                      |
| ------------ | ----------------------------------------------------------------------------------- |
| `me`         | All authenticated users                                                             |
| `foundation` | Users with `hasBoardRole` (`board-member` or `executive-director`), or root writers |
| `project`    | Users with `hasProjectRole` (`maintainer` or `contributor`), or root writers        |
| `org`        | All lenses users (feature-flagged via `ORG_LENS_ENABLED_FLAG`)                      |

A user can carry both board and project roles and see both the `foundation` and `project` lenses simultaneously.

## Key conditions referenced in the matrix

| Condition                 | Definition                                                                                                                         | Source                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `canWrite()`              | `ProjectContextService.canWrite` — reactive signal; true when the user has write/manage access to the active foundation or project | `project-context.service.ts`   |
| `canSeeNewsletters()`     | `currentPersona() === 'executive-director' \|\| canWrite()`                                                                        | `main-layout.component.ts:535` |
| `foundationHasProjects()` | True when the selected foundation has ≥1 project row in Snowflake; cleared while fetching                                          | `main-layout.component.ts:188` |

---

## Me Lens

**Identical for all personas.** Static items — no runtime persona conditions.

| Section       | Item                      | Route              |
| ------------- | ------------------------- | ------------------ |
| _(top-level)_ | My Dashboard              | `/`                |
| My Engagement | My Meetings               | `/meetings`        |
|               | My Events                 | `/events`          |
|               | My Committees             | `/groups`          |
|               | My Mailing Lists          | `/mailing-lists`   |
|               | My Votes                  | `/votes`           |
|               | My Surveys                | `/surveys`         |
|               | My Documents              | `/documents`       |
| My Growth     | Training & Certifications | `/me/training`     |
|               | Mentorships               | _(external link)_  |
|               | Crowdfunding              | _(external link)_  |
|               | Badges                    | `/badges`          |
| My Account    | Profile                   | `/profile`         |
|               | Settings                  | `/settings`        |
|               | Transactions              | `/me/transactions` |

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

**Feature-flagged** via `ORG_LENS_ENABLED_FLAG`. Falls back to Me Lens items when the flag is off. Identical for all personas when enabled.

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

| Guard                    | Protected routes                                                                        | Access rule                                 |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| `executiveDirectorGuard` | `/foundation/health-metrics`, `/foundation/marketing-impact`                            | `currentPersona() === 'executive-director'` |
| `newsletterAccessGuard`  | `/foundation/newsletters`, `/project/newsletters`, and all nested newsletter routes     | `canSeeNewsletters()` — ED or `canWrite()`  |
| `writerGuard`            | Create/edit routes for meetings, committees, mailing lists, surveys, votes (all lenses) | `canWrite()`                                |

Guards are defined in `apps/lfx-one/src/app/shared/guards/`.

---

## Write-action gating per feature domain

The `writerGuard` protects create and edit routes. Within read-only pages, UI elements (add/edit/delete buttons) are additionally gated by `canWrite()` in the component template.

| Domain                 | Create/edit route guard | In-page UI gating                                    |
| ---------------------- | ----------------------- | ---------------------------------------------------- |
| Meetings               | `writerGuard`           | Yes                                                  |
| Committees             | `writerGuard`           | Yes                                                  |
| Mailing Lists          | `writerGuard`           | Yes                                                  |
| Surveys                | `writerGuard`           | Yes                                                  |
| Votes                  | `writerGuard`           | Yes                                                  |
| Settings / Permissions | —                       | `canWrite()` — view-only banner shown to non-writers |

> Backend write enforcement (whether the upstream microservices independently reject unauthorized writes) is tracked separately in [LFXV2-1662](https://linuxfoundation.atlassian.net/browse/LFXV2-1662).

---

## Session eviction on access loss

`evictOnWriteAccessLoss()` (`apps/lfx-one/src/app/shared/utils/`) subscribes to `canWrite` reactively. If write access is revoked mid-session (e.g., an admin removes the user's permission), the utility redirects to a safe page automatically.

---

## Related documents

- [Lens & Persona System](./lens-system.md) — how lenses and personas are resolved and enforced
- [Angular Patterns](./angular-patterns.md) — zoneless change detection and signals
- [`main-layout.component.ts`](../../../apps/lfx-one/src/app/layouts/main-layout/main-layout.component.ts) — authoritative source for sidebar item definitions
- [`app.routes.ts`](../../../apps/lfx-one/src/app/app.routes.ts) — route guard wiring
