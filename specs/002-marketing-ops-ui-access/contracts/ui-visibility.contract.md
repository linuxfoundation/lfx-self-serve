# Contract: UI visibility & navigation (Angular)

Defines the observable UI behavior each role must experience. These are the acceptance anchors for E2E tests.

## Reactive access signals (`ProjectContextService`)

| Signal                 | True when                                    | Drives                                                         |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `canViewMarketing()`   | active project's `marketingAuditor === true` | Marketing sidebar section + Marketing Impact entry             |
| `canManageCampaigns()` | active project's `campaignManager === true`  | Campaigns entry + Campaigns route + Marketing Overview section |

## Lens availability (`LensService.getAllowedLensIds`)

`showFoundation = hasBoardRole || isRootWriter || isRootMarketingAuditor`

- Lens unlock for marketing users is **ROOT-scoped**: `isRootMarketingAuditor` is true only when the user holds `marketing_auditor` on the tenant ROOT project (cascades down). A child-only grant does not unlock the foundation lens.
- A non-ED marketing user with a ROOT grant gains the foundation ("Projects") lens + project selector and can browse/search the hierarchy reachable under that cascade.
- `me` lens unchanged; `project`/`org` unchanged.

## Marketing-only foundation mode (FR-017)

When `isRootMarketingAuditor && !(hasBoardRole || isRootWriter)`:

| Surface                         | Behavior                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation sidebar              | Dashboard + Marketing section only (no Meetings/Events/Groups/Documents/Governance/Newsletters/Metrics/Projects page)                       |
| Non-marketing foundation routes | Blocked by `foundationProductGuard` → redirect `/foundation/overview?project=<slug>`                                                        |
| Board-member dashboard          | Foundation Health, pending actions, meetings, org involvement, staff sidebar hidden; Marketing Overview remains when `canManageCampaigns()` |

Board role and root-writer users keep the full foundation product surface unchanged.

## Sidebar (`SidebarNavService`, foundation lens)

| Section/entry                | Visible when                                | Notes                          |
| ---------------------------- | ------------------------------------------- | ------------------------------ |
| Metrics → Health Metrics     | `currentPersona() === 'executive-director'` | UNCHANGED (ED-only)            |
| Metrics → Social Listening   | ED (as today)                               | UNCHANGED                      |
| Marketing (section)          | `canViewMarketing()`                        | was ED-only                    |
| Marketing → Marketing Impact | `canViewMarketing()`                        | was ED-only                    |
| Marketing → Campaigns        | `canManageCampaigns()`                      | was ED-only; auditors excluded |

## Routes (`app.routes.ts`)

| Path                          | Guard(s) before                                    | Guard(s) after                                                                                    |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `foundation/health-metrics`   | `executiveDirectorGuard`, `projectQueryParamGuard` | UNCHANGED                                                                                         |
| `foundation/marketing-impact` | `executiveDirectorGuard`, `projectQueryParamGuard` | `marketingViewGuard`, `projectQueryParamGuard`                                                    |
| `foundation/campaigns`        | `executiveDirectorGuard`, `projectQueryParamGuard` | `campaignAccessGuard`, `projectQueryParamGuard`                                                   |
| `foundation/meetings` (etc.)  | `projectQueryParamGuard`                           | `foundationProductGuard`, `projectQueryParamGuard` (denies marketing-only only; others unchanged) |

## Dashboard Marketing Overview section

- Rendered when `canManageCampaigns()` is true, in the foundation-lens dashboard, read-only (no actions).
- Hidden for Marketing Auditors and all non-ED/non-Marketing-Ops users.
- All other ED-dashboard sections remain ED-only (unchanged shell logic).

## Role → expected UI matrix (per selected project P)

| Role (on P)                              | Foundation lens      | Marketing section | Marketing Impact | Campaigns                       | Marketing Overview | Health Metrics |
| ---------------------------------------- | -------------------- | ----------------- | ---------------- | ------------------------------- | ------------------ | -------------- |
| ED of P                                  | ✅                   | ✅                | ✅ read          | ✅ full                         | ✅ read            | ✅             |
| Marketing Ops (grant reaches P)          | ✅                   | ✅                | ✅ read          | ✅ full                         | ✅ read            | ❌             |
| Marketing Auditor (grant reaches P)      | ✅                   | ✅                | ✅ read          | ❌ (link hidden, route blocked) | ❌                 | ❌             |
| Project owner/writer, no marketing grant | (per existing rules) | ❌                | ❌ blocked       | ❌ blocked                      | ❌                 | ❌             |
| No marketing grant, non-ED               | per existing         | ❌                | ❌ blocked       | ❌ blocked                      | ❌                 | ❌             |

## Failure/edge behavior

- Probe pending/errored ⇒ surfaces hidden, routes blocked (fail closed).
- Direct URL to a blocked marketing route ⇒ redirect to `/foundation/overview?project=<slug>`.
- Project switch ⇒ all rows re-evaluated for the new project without full reload.
- Project with no marketing data ⇒ permitted user sees an empty/unavailable state, not an error.
- No product-page permissions outside this matrix change.
