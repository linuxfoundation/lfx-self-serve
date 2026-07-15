# Phase 1 Data Model: Marketing Ops UI Access

This feature adds no new persisted entities. It introduces (a) two new authorization access-types consumed from the upstream OpenFGA model, (b) response-only enrichment fields on the existing `Project` shape, and (c) derived reactive access state in the Angular app. All types live in `@lfx-one/shared`.

## Authorization relations (upstream OpenFGA — source of truth, not defined here)

| Relation            | Meaning                                                  | Resolves to (per project)                                  | Cascades from parent                                                  |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `marketing_auditor` | Read marketing dashboards + marketing nav                | Marketing Ops team, EDs, assigned Marketing Auditors       | Yes                                                                   |
| `campaign_manager`  | Full campaign view + actions; Marketing Overview section | EDs, Marketing Ops (`executive_director or marketing_ops`) | Via `marketing_ops` cascade; no direct `campaign_manager from parent` |
| `marketing_ops`     | Seeds the two above                                      | Marketing Ops team                                         | Yes                                                                   |

The UI checks `marketing_auditor` and `campaign_manager` on `project:<uid>`; it does not check `marketing_ops` directly.

## Shared type changes (`packages/shared`)

### `AccessCheckAccessType` (interfaces/access-check.interface.ts)

```typescript
'writer' | 'viewer' | 'organizer' | 'meeting_coordinator'
  + 'marketing_auditor'
  + 'campaign_manager'
```

- Validation: value must be one of the union members; used to build the `resource:id#access` probe string.
- No change to `AccessCheckResourceType` (`project` already present).

### `Project` (interfaces/project.interface.ts) — response-only additions

| Field              | Type       | Semantics                                                                                                                                                                        |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketingAuditor` | `boolean?` | `true` = user holds `marketing_auditor` on this project; `false` = no grant **or** transient probe failure (fail-closed deny); `undefined` = probe not requested (NOT a denial). |
| `campaignManager`  | `boolean?` | `true` = user holds `campaign_manager` (⇒ ED or Marketing Ops); `false` = no grant **or** transient probe failure (fail-closed deny); `undefined` = probe not requested.         |

- Probe-gated: populated only when the caller requests the marketing probe (see `contracts/project-probe.contract.md`), mirroring `meetingCoordinator`.
- Guards/visibility MUST treat only `=== true` as access; `undefined`/`false` ⇒ no access (fail closed).

### Personas API response — ROOT marketing signal

| Field                    | Type      | Semantics                                                                                                                                                                                             |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRootMarketingAuditor` | `boolean` | `true` when the user holds `marketing_auditor` on the ROOT project (⇒ marketing visibility somewhere in the hierarchy). Drives foundation-lens availability. Parallel to the existing `isRootWriter`. |

(Added to the persona/personas API response interface used by `PersonaService`; exact interface name to be confirmed at task time — it is the same response that currently carries `isRootWriter`.)

## Derived front-end state (no persistence)

### `PersonaService`

| Signal                   | Type              | Source                                                                   |
| ------------------------ | ----------------- | ------------------------------------------------------------------------ |
| `isRootMarketingAuditor` | `Signal<boolean>` | Hydrated from personas API (cookie-seedable like `isRootWriter` for SSR) |

### `ProjectContextService`

| Signal               | Type              | Derivation                                                                                       |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `canViewMarketing`   | `Signal<boolean>` | `getProject(activeContext.slug, false, { marketing: true }) ⇒ project.marketingAuditor === true` |
| `canManageCampaigns` | `Signal<boolean>` | `… ⇒ project.campaignManager === true`                                                           |

- Both recompute when `activeContext()` changes (project switch) — satisfies FR-009.
- Fail closed: null project or `undefined`/`false` flag ⇒ `false`.

## Surface → state → audience (authoritative mapping)

| Surface                                            | Gated by                                               | Audience                               | Access level        |
| -------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- | ------------------- |
| Foundation ("Projects") lens availability          | `hasBoardRole ∨ isRootWriter ∨ isRootMarketingAuditor` | Board/ED + any marketing user          | Navigate            |
| Sidebar Marketing section + Marketing Impact entry | `canViewMarketing`                                     | ED + Marketing Ops + Marketing Auditor | View entry          |
| Marketing Impact route/page                        | `marketingViewGuard` (`project.marketingAuditor`)      | ED + Marketing Ops + Marketing Auditor | Read-only           |
| Sidebar Campaigns entry                            | `canManageCampaigns`                                   | ED + Marketing Ops                     | View entry          |
| Campaigns route/page                               | `campaignAccessGuard` (`project.campaignManager`)      | ED + Marketing Ops                     | Full view + actions |
| Dashboard Marketing Overview section               | `canManageCampaigns`                                   | ED + Marketing Ops                     | Read-only           |
| Health Metrics + rest of ED dashboard              | ED persona (unchanged)                                 | ED                                     | Unchanged           |

## State transitions

Only view-state transitions (no domain lifecycle):

- **Project context change** → re-probe → `canViewMarketing` / `canManageCampaigns` recompute → nav/section visibility and route access update.
- **Probe pending** → signals resolve `false` (fail closed) until the enriched project arrives; data fetch withheld until the governing check is `true`.
- **Probe error** → `false` (guard denies / surfaces hidden).
