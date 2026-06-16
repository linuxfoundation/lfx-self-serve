# OSSPREY Steward Admin Actions — Implementation Plan & Backend Gap Report

> **Status:** Blocked on backend. Frontend work paused until the CDP gaps below are resolved.
> **Design source:** `design/LFX-OSSPREY-Admin-Dashboard.html`
> **Backend branch:** crowd.dev `feat/steward-admin-actions-api` ([PR #4211](https://github.com/linuxfoundation/crowd.dev/pull/4211))
> **Frontend module:** `apps/lfx-one/src/app/modules/ossprey/`

The goal: let admins assign/manage **stewards** on OSSPREY packages (assign, escalate, open for stewardship, change status / spot-check), per the admin-dashboard design. The crowd.dev branch adds the write endpoints; this repo proxies them and builds the UI.

---

## 1. Current state (this repo)

**Data flow:** Angular → `/api/ossprey/*` (lfx-one Express proxy) → CDP `/v1/packages*` (crowd.dev), authenticated with an **M2M token** (PCC Auth0 client credentials, CDP audience). See `apps/lfx-one/src/server/services/cdp.service.ts` (`generateToken`).

**The OSSPREY UI is read-only today:**

- KPI strip, package queue table, 5-tab detail drawer (Overview / Assessment / Security / Provenance / History), filters + sort.
- Bulk-action bar is stubbed out behind `@if (false)` in `ossprey-dashboard.component.html`.
- `OsspreyService` (`apps/lfx-one/src/app/shared/services/ossprey.service.ts`) has only `getPackages` / `getMetrics` / `getPackage` — **no write methods**.
- Server proxy (`apps/lfx-one/src/server/services/ossprey.service.ts`, `routes/ossprey.route.ts`, `controllers/ossprey.controller.ts`) is GET-only.
- Endpoint constants in `packages/shared/src/constants/api.constants.ts` → `CDP_CONFIG.ENDPOINTS` only cover packages list/metrics/detail.

## 2. Backend write endpoints available on the branch

| Method | Path                             | Body                                       | Returns                                                                              |
| ------ | -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `POST` | `/v1/stewardships`               | `{ purl }`                                 | full `StewardshipRecord` **incl. `id`** (status → `open`, origin `opened_for_claim`) |
| `PUT`  | `/v1/stewardships/{id}/steward`  | `{ userId, role: 'lead' \| 'co_steward' }` | `{ stewardship, stewards[] }`                                                        |
| `PUT`  | `/v1/stewardships/{id}/escalate` | `{ resolutionPath, notes? }`               | `{ stewardship }` (status → `escalated`)                                             |
| `PUT`  | `/v1/stewardships/{id}/status`   | `{ status, inactiveReason?, notes? }`      | `{ stewardship }`                                                                    |

**Enums:**

- `role`: `lead`, `co_steward`
- `resolutionPath`: `right_of_first_refusal`, `replace_the_dependency`, `find_vendor_for_lts`, `consortium_adopts_maintainership`, `compensating_controls_monitor`, `namespace_takeover`
- `status` (updatable): `assessing`, `active`, `needs_attention`, `blocked`, `inactive` (`inactiveReason` **required** when `inactive`: `quarterly_cadence_missed`, `stepped_down`, `no_longer_critical`)

All four require OAuth2; the `write:stewardships` scope check is **currently disabled** (CM-1235, pending Auth0 staging tenant config).

---

## 3. 🔴 Backend gaps — for the CDP developer

> **Backend dev responses:**
>
> - **#1 — ✅ DONE & deployed (verified on branch).** `GET /v1/packages/detail` now returns `stewardship: { id, status, stewards, lastActivityAt }` (`getPackage.ts`). The integer `id` is present and drives the mutation endpoints. _(List item / `:batch-stewardship` still return `stewards: null` and no top-level id — fine; the detail endpoint is what the drawer uses.)_
> - **#2 — still the remaining blocker.** Need the **roster of assignable stewards** (`userId`/sub + `name` + `type` + `avatarUrl`). Verified the returned `stewards[]` is `{ id, stewardshipId, userId, role, assignedAt, assignedBy }` — **no display name/avatar** — so the roster is needed both to **populate the picker** AND to **render already-assigned stewards by name** instead of a raw sub. Open data-model question: how an org "entity" maps to a single Auth0 sub.
> - **#3 — ✅ DONE & deployed (verified on branch).** `moveToAssessing` (boolean) is on the `PUT /v1/stewardships/:id/steward` body; the DAL transitions `unassigned`/`open` → `assessing` and logs it. Send `moveToAssessing: true` from the "Assign & move to Assessing" CTA.
> - **#4 — intentionally deferred to last.** Testing the authz path requires staging Auth0 credentials while connected to **prod CDP**, so it's sequenced after the other gaps. Note `assignSteward` records `assignedBy = req.actor.id` (Auth0 actor) — confirm what `req.actor` resolves to when the lfx-one proxy calls with its M2M token. Build the actions first; wire/enforce the per-user authorization gate as the final step.

### Gap #1 (BLOCKER) — stewardship `id` is not exposed on package read responses

The mutation endpoints are keyed by the integer stewardship `id`, but neither `GET /v1/packages` nor `GET /v1/packages/detail` serializes it. `getPackage.ts` loads `pkg.stewardshipId` internally to fetch the summary but **drops it from the response**; the list hardcodes `stewards: null`. The only way to obtain an `id` is `POST /stewardships`, which **mutates** status to `open`.

**Consequence:** for any package that already has a stewardship (assessing / active / needs_attention / escalated / blocked), escalate / assign / status are **not callable** — there is no non-mutating way to discover the `id`.

**Ask:** add `stewardship.id` to the `GET /v1/packages/detail` response (and ideally to each `GET /v1/packages` list item + the `:batch-stewardship` response). This single change unblocks the drawer-driven actions.

### Gap #2 (BLOCKER) — no endpoint to list assignable stewards

`assignSteward` takes a `userId` (Auth0 sub), but nothing on the branch — or anywhere in public v1 — lists/searches candidate stewards with display names/avatars. The design's steward picker (6 curated stewards, mix of org "entities" and "individuals", tagged "Natural steward" vs "Volunteer") has **no real data source**. Repo policy forbids shipping the picker against hardcoded/mock data.

**Recommendation (see §5):** add a purpose-built `GET /v1/stewards` (or `/v1/stewardships/assignable-stewards`) endpoint returning the curated roster.

### Gap #3 — `assignSteward` status transition ✅ RESOLVED

The design CTA is "**Assign & move to Assessing**". **Resolution:** backend is adding a `moveToAssessing` param to the assign endpoint. Frontend passes `moveToAssessing: true` on the assign call — single round-trip, no client-side chaining. (Confirm the param lives on the `PUT /v1/stewardships/{id}/steward` body.)

### Gap #4 — authorization model undefined

These are privileged admin actions, but OSSPREY is gated only by a feature flag + route guard (no ED/admin persona check), and the proxy authenticates with an app-level **M2M token** while `write:stewardships` enforcement is off. Per this repo's auth rules, privileged M2M writes must be preceded by an in-app per-user authorization check.

**Ask:** who is allowed to perform steward admin actions (persona/permission)? Is there an upstream authz signal, or do we gate in lfx-one? This must be decided before write endpoints are wired.

### Gap #5 (minor) — no bulk endpoints

The design's bulk-action bar (assign / escalate / open for N selected) has no batch backend. Bulk stays deferred (UI already stubbed behind `@if (false)`) unless batch endpoints are added.

---

## 4. Frontend implementation plan (once gaps land)

Build strictly in order: **Shared types → Backend proxy → Frontend service → Frontend components.** No frontend against missing contracts; no mock data.

### 4.1 Shared types — `packages/shared/src/interfaces/ossprey.interface.ts`

- Add enums/string-union types: `OsspreyStewardRole` (`lead` | `co_steward`), `OsspreyEscalationPath` (6), `OsspreyInactiveReason` (3).
- Add CDP record interfaces: `CdpStewardshipRecord` (`id`, `packageId`, `status`, `origin`, `version`, `openedAt`, `lastStatusAt`, `inactiveReason`, timestamps), `CdpSteward` (`userId`, `name`, `role`, `assignedAt`, `assignedBy?`), and (per Gap #2) `CdpAssignableSteward` (`userId`, `name`, `type: 'entity' | 'individual'`, `avatarUrl?`, `naturalSteward: boolean`).
- Request bodies: `OsspreyAssignStewardRequest` (`userId`, `role`, `moveToAssessing?`), `OsspreyEscalateRequest`, `OsspreyUpdateStatusRequest`, `OsspreyOpenStewardshipRequest`.
- Extend `OsspreyPackage` with `stewardshipId: number | null` and a typed `stewards` array (replace the current `stewardIds: string[]` placeholder + `getStewardNames` stub in `ossprey-packages-tab.component.ts`).
- Add constants in `packages/shared/src/constants/ossprey.constants.ts`: escalation-path option list (label + description, 6 cards), inactive-reason options, role options.

### 4.2 Backend proxy

- `CDP_CONFIG.ENDPOINTS` (`api.constants.ts`): add `STEWARDSHIPS`, `STEWARDSHIP_STEWARD(id)`, `STEWARDSHIP_ESCALATE(id)`, `STEWARDSHIP_STATUS(id)`, and `STEWARDS_LIST` (Gap #2).
- `server/services/ossprey.service.ts`: add `openStewardship(req, purl)`, `assignSteward(req, id, body)`, `escalateStewardship(req, id, body)`, `updateStewardshipStatus(req, id, body)`, `getAssignableStewards(req)`. Mirror existing fetch + `MicroserviceError` + `logger` patterns; `X-LFX-Request-ID` per call.
- Map the stewardship `id` through `mapPackageDetail` / `mapListItem` once Gap #1 lands.
- `controllers/ossprey.controller.ts`: add handlers with `logger.startOperation`/`success`, `next(error)` in catch (no `logger.error` in controllers).
- `routes/ossprey.route.ts`: `POST /stewardships`, `PUT /stewardships/:id/steward`, `PUT /stewardships/:id/escalate`, `PUT /stewardships/:id/status`, `GET /stewards`. **Apply per-user authorization middleware here (Gap #4)** before proxying.
- Validate path/body params in `helpers/validation.helper.ts` (enum guards like existing `parseOssprey*`).

### 4.3 Frontend service — `apps/lfx-one/src/app/shared/services/ossprey.service.ts`

- Add write methods (`take(1)`, return typed responses): `openStewardship`, `assignSteward`, `escalate`, `updateStatus`, plus `getAssignableStewards` (GET with `catchError`).

### 4.4 Components (`modules/ossprey/components/`)

Per `component-organization.md` (signals, `model()` for dialog visibility, 11-section order, `data-testid`, `flex + gap`, LFX wrapper components — `DialogComponent`, `ButtonComponent`, `SelectComponent`, etc.). DELETE→CREATE only for full replacements; these are additive.

- **`ossprey-assign-steward-modal`** — multi-select steward picker (from `getAssignableStewards`), "Natural steward"/"Volunteer" badge by `type`, optional note textarea, "Assign & move to Assessing" CTA. Emits assignment; container calls assign (+ status per Gap #3).
- **`ossprey-escalate-modal`** — 6 selectable resolution-path cards + optional note, red "Escalate" CTA.
- **`ossprey-status-modal` / spot-check** — status transition; conditional `inactiveReason` select when `inactive`; flag-for-follow-up vs looks-good per design.
- **Open for stewardship** — simple confirm action (no modal needed) on unassigned packages.
- Wire triggers in the **drawer footer** (`ossprey-package-drawer`) per status, and re-enable the **bulk-action bar** in `ossprey-dashboard.component.html` only if Gap #5 lands.
- After a successful mutation, refresh the affected row / drawer (re-fetch package detail) so status + stewards update.

### 4.5 Validation

`yarn format` → `yarn lint` → `yarn build` (build exercises SSR — watch the drawer/modal for browser-only API use per `ssr-safety.md`). Add `data-testid` to all new interactive elements.

### 4.6 Suggested PR sequencing (keep each < ~1000 lines)

1. Shared types + constants.
2. Backend proxy (service/controller/route/validation) + authz gate.
3. Frontend service + assign-steward flow (highest-value path).
4. Escalate + status/spot-check modals.
5. (If unblocked) bulk actions.

---

## 5. Recommendation — steward roster (Gap #2)

**Recommend a purpose-built CDP endpoint, e.g. `GET /v1/stewards` (or `/v1/stewardships/assignable-stewards`)** returning a curated roster:

```jsonc
{
  "stewards": [
    {
      "userId": "auth0|...", // Auth0 sub — what assignSteward expects
      "name": "Apache Security Team",
      "type": "entity", // "entity" | "individual"
      "avatarUrl": "https://...", // optional
      "naturalSteward": true, // entities/foundations/member cos → "Natural steward" badge; individuals → "Volunteer"
    },
  ],
}
```

**Why not a generic member search:** the design's roster is _curated_ — it mixes org "entities" (Apache Security Team, Ericsson OSS Office, Dell Security Eng.) with "individuals", and carries the "Natural steward vs Volunteer" semantic. A raw members/users search is too broad, wouldn't model entities-as-stewards, and wouldn't capture the natural-steward flag. A dedicated roster endpoint keeps the picker honest and matches the design 1:1.

**Open question for the CDP developer:** `assignSteward` takes a single `userId` (Auth0 sub). How is an **organization** ("entity") steward represented as a `userId`? This needs a data-model decision before the picker can assign entities. If entities can't map to a sub, the roster endpoint should clarify how entity assignments are stored.

---

## 6. Quick checklist to unblock frontend

- [x] Gap #1 — `stewardship.id` exposed on `GET /v1/packages/detail`. _(deployed; verified on branch)_
- [ ] Gap #2 — add assignable-stewards roster endpoint (+ entity `userId` model decision). _(remaining blocker — needed for picker AND for displaying assigned stewards by name)_
- [x] Gap #3 — assign→assessing via `moveToAssessing` param on the steward body. _(deployed; verified on branch)_
- [ ] Gap #4 — define who may perform admin actions + how lfx-one enforces it. _(deferred to last — testing needs staging Auth0 creds against prod CDP)_
- [ ] Gap #5 (optional) — batch endpoints for bulk actions.
