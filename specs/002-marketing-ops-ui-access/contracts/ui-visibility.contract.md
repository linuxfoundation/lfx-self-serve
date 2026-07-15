# Contract: UI visibility & navigation (Angular)

Defines the observable UI behavior each role must experience. These are the acceptance anchors for E2E tests.

## Reactive access signals (`ProjectContextService`)

| Signal                 | True when                                    | Drives                                                         |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `canViewMarketing()`   | active project's `marketingAuditor === true` | Marketing sidebar section + Marketing Impact entry             |
| `canManageCampaigns()` | active project's `campaignManager === true`  | Campaigns entry + Campaigns route + Marketing Overview section |

## Lens availability (`LensService.getAllowedLensIds`)

`showFoundation = hasBoardRole || isRootWriter || isRootMarketingAuditor`

- A non-ED marketing user gains the foundation ("Projects") lens + project selector.
- `me` lens unchanged; `project`/`org` unchanged.

## Sidebar (`SidebarNavService`, foundation lens)

| Section/entry                | Visible when                                | Notes                          |
| ---------------------------- | ------------------------------------------- | ------------------------------ |
| Metrics → Health Metrics     | `currentPersona() === 'executive-director'` | UNCHANGED (ED-only)            |
| Metrics → Social Listening   | ED (as today)                               | UNCHANGED                      |
| Marketing (section)          | `canViewMarketing()`                        | was ED-only                    |
| Marketing → Marketing Impact | `canViewMarketing()`                        | was ED-only                    |
| Marketing → Campaigns        | `canManageCampaigns()`                      | was ED-only; auditors excluded |

## Routes (`app.routes.ts`)

| Path                          | Guard(s) before                                    | Guard(s) after                                  |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `foundation/health-metrics`   | `executiveDirectorGuard`, `projectQueryParamGuard` | UNCHANGED                                       |
| `foundation/marketing-impact` | `executiveDirectorGuard`, `projectQueryParamGuard` | `marketingViewGuard`, `projectQueryParamGuard`  |
| `foundation/campaigns`        | `executiveDirectorGuard`, `projectQueryParamGuard` | `campaignAccessGuard`, `projectQueryParamGuard` |

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
