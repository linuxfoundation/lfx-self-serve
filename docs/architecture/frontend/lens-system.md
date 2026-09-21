# Lens & Persona System

The LFX One UI adapts to **who the user is** (persona) and **what perspective they're viewing from** (lens). Together, these two concepts drive sidebar navigation, dashboard content, filter visibility, project context, and route-level authorization. This doc covers how the pieces fit together.

## Concepts

| Concept             | Owner                      | Values                                                                    |
| ------------------- | -------------------------- | ------------------------------------------------------------------------- |
| **Lens**            | `LensService`              | `'me' \| 'foundation' \| 'project' \| 'org'`                              |
| **Persona**         | `PersonaService` + backend | `'contributor' \| 'maintainer' \| 'board-member' \| 'executive-director'` |
| **Project context** | `ProjectContextService`    | `ProjectContext \| null` (foundation- or project-scoped)                  |

- A **lens** is a viewing perspective the user actively chooses (persisted in a cookie).
- A **persona** is derived server-side from the user's committee memberships and governs which lenses they're allowed to use.
- A **project context** is the scope inside a lens (e.g. which foundation or project is selected).

## Lens

### `LensService` (`apps/lfx-one/src/app/shared/services/lens.service.ts`)

```typescript
type Lens = 'me' | 'foundation' | 'project' | 'org';

class LensService {
  activeLens: Signal<Lens>; // currently-active lens, clamped to persona-allowed set
  availableLenses: Signal<LensOption[]>; // lenses the current persona can switch to
  setLens(lens: Lens): void; // no-op if the lens isn't allowed for this persona
}
```

Key behaviors:

- `activeLens` is a **computed signal** — it reads the user's selected lens from a 30-day cookie and clamps it to the set allowed by their persona. If the persisted lens is disallowed, it falls back to `DEFAULT_LENS`.
- `setLens()` rejects disallowed lenses silently (no throw), so unprivileged callers can't escalate scope.
- `availableLenses` is driven by role-based access rules (`deriveAllowedLenses` in `packages/shared/src/utils/lens.utils.ts`): root writers see all four lenses; `foundation` is available when `hasBoardRole || isRootWriter || hasWriterFoundation || isLFStaff || hasMarketingGrant || isRootAuditor`; `project` is available when `hasProjectRole || isRootWriter || hasWriterProject`. `hasMarketingGrant` is true when the `marketing-ops-fga-enabled` flag is on and the user holds `marketing_auditor` or `campaign_manager` on any project — this grants foundation-lens access without a board/root role, scoped in practice to the Marketing Impact and Campaigns pages (see the [Route wiring](#route-wiring) guards below). A user can carry multiple grant sources and see the union of their lenses.

### Route wiring

Every top-level route under `MainLayoutComponent` that is lens-aware declares its lens via `data.lens`:

```typescript
// apps/lfx-one/src/app/app.routes.ts (excerpt)
{ path: '',                    pathMatch: 'full', data: { lens: 'me' },        loadComponent: ... },
{ path: 'foundation/overview',                    data: { lens: 'foundation' }, loadComponent: ... },
{ path: 'foundation/health-metrics',              data: { lens: 'foundation' }, canActivate: [dashboardAccessGuard], loadComponent: ... },
{ path: 'foundation/marketing-impact',            data: { lens: 'foundation' }, canActivate: [marketingImpactAccessGuard], loadComponent: ... },
{ path: 'foundation/campaigns',                   data: { lens: 'foundation' }, canActivate: [campaignAccessGuard], loadComponent: ... },
{ path: 'project/overview',                       data: { lens: 'project' },    loadComponent: ... },
{ path: 'org',                                     data: { lens: 'org' },        loadComponent: ... },
```

Feature routes (`/meetings`, `/votes`, `/surveys`, etc.) typically don't declare `data.lens` — instead, feature pages **read** `activeLens` from `LensService` to decide whether to show a "My …" view (me lens) or a scoped view. Those flat mounts run `lensRedirectGuard`, which rewrites the URL to `/foundation/...` or `/project/...` while one of those lenses is active.

Me-only pages are the exception: `/crowdfunding`, `/mentorship` and `/formations` (the My Formations page, #2753) declare `data: { lens: 'me' }` so a deep link or hard refresh switches to the Me lens (`MainLayoutComponent.syncLensFromRoute`), and they deliberately skip `lensRedirectGuard` — they have no foundation/project twin to redirect to. `/formations` is the instructive case: its foundation-prefixed sibling, `/foundation/formations`, is the auditor-only Formations queue, a different page for a different audience, so a lens-driven rewrite would have sent a Me-lens visitor somewhere they may not be allowed.

## Persona

### `PersonaType` (`packages/shared/src/interfaces/persona.interface.ts`)

```typescript
type PersonaType = 'contributor' | 'maintainer' | 'board-member' | 'executive-director';
```

Personas are **detected from committee memberships**. A user can carry multiple personas simultaneously; the "primary" persona is the highest-priority one (`executive-director` > `board-member` > `maintainer` > `contributor`).

### Server-side detection

Two server services own persona resolution:

- **`PersonaDetectionService`** (`apps/lfx-one/src/server/services/persona-detection.service.ts`)
  - `getPersonas(req)` — RPC call to the NATS subject `NatsSubjects.PERSONAS_GET` returning the raw persona payload.
  - `checkRootWriter(req)` — independent NATS lookup (`NatsSubjects.PROJECT_SLUG_TO_UID` + access check) to confirm root-writer status.
- **`PersonaEnrichmentService`** (`apps/lfx-one/src/server/services/persona-enrichment.service.ts`)
  - `getEnrichedPersonas(req)` — batches project metadata fetches so the frontend gets project names/slugs/parent UIDs alongside raw persona UIDs.

Both are exported as singletons from `apps/lfx-one/src/server/utils/persona-helper.ts`. SSR uses `resolvePersonaForSsr(req, res)` — a hybrid that reads the persona cookie first and falls back to NATS on cache miss.

Non-obvious behavior:

- Root writers are **injected** with the `executive-director` persona server-side even if they don't natively hold it (for consistent lens-gating).
- Impersonation overrides are honored only if the target persona is in the detected list — users can't "upgrade" themselves through impersonation.
- The ROOT (tenant root) project is stripped from the detection response before consumers see it; `checkRootWriter` uses an independent NATS lookup to avoid leaking access.
- The persona cookie holds only personas + organizations, not projects. Project enrichment always refreshes from `/api/user/personas?enriched=true` after page hydration.

### Frontend consumption

`PersonaService` (`apps/lfx-one/src/app/shared/services/persona.service.ts`) surfaces signals derived from the hydrated `AuthContext`:

```typescript
class PersonaService {
  currentPersona: WritableSignal<PersonaType>;
  allPersonas: WritableSignal<PersonaType[]>;
  personaProjects: WritableSignal<Record<PersonaType, PersonaProject[]>>;

  hasBoardRole: Signal<boolean>; // 'board-member' or 'executive-director' in allPersonas
  hasProjectRole: Signal<boolean>; // 'maintainer' or 'contributor' in allPersonas
  isRootWriter: WritableSignal<boolean>;
  enrichedPersonasLoaded: WritableSignal<boolean>;

  refreshEnrichedPersonas(force?: boolean): Observable<PersonaApiResponse>;
}
```

Typical consumers: `lens-switcher.component.ts` (hides lenses the persona can't use), `sidebar.component.ts` (decides which nav items to render), and `ProjectContextService` (picks the right context based on `hasBoardRole`).

## Project Context

### `ProjectContextService` (`apps/lfx-one/src/app/shared/services/project-context.service.ts`)

Carries the "what project/foundation am I currently scoped to?" state across feature pages. Exposes computed signals for the **active context** inferred from `activeLens` + persona:

```typescript
class ProjectContextService {
  activeContext: Signal<ProjectContext | null>; // foundation- or project-scoped, computed
  isFoundationContext: Signal<boolean>; // true when the active context is a foundation
  canWrite: Signal<boolean>; // resolved via ProjectService.getProject()

  // Formation signals (GH-1955) — derived off the same activeProject fetch as canWrite, so
  // consumers (e.g. FormationCardComponent, ProjectDashboardComponent) share one call instead
  // of each fetching the active project independently. These are FormationCardComponent's
  // *fallback* source only: where a host already holds a FormationChecklistResponse it passes
  // it as the card's `formation` input, and the card then reads none of them (#2719) — on the
  // foundation drill-down this service describes the parent foundation, not the child project.
  isActiveProjectInFormation: Signal<boolean>;
  activeProjectFormationSubStage: Signal<string | null>;
  isActiveProjectConfidential: Signal<boolean>; // true only for ProjectStage.FormationConfidential
  activeProjectAnnouncementDate: Signal<string | null>; // via PermissionsService.getProjectSettings
  activeProjectAnnouncementDateLoading: Signal<boolean>;
  activeProjectAnnouncementDateHasError: Signal<boolean>;

  // Stage signals (#2754) — the project-lens sidebar and its landing page key off these
  activeProjectStage: Signal<string | null>; // e.g. "Formation - Exploratory"; fetched per context, null while resolving or absent
  activeProjectStageResolved: Signal<boolean>; // false from a context change until that context's stage fetch answers
  formationOverviewAllowedSlug: Signal<string | null>; // the Formation-stage project whose /project/overview formationOverviewRedirectGuard let stand; cleared when navigation leaves the overview (formationOverviewReleaseGuard)

  setFoundation(ctx: ProjectContext, syncUrl = true): void; // syncUrl: false when a navigation owns the destination URL
  setProject(ctx: ProjectContext, syncUrl = true): void;
  setFormationOverviewAllowedSlug(slug: string | null): void; // written by formationOverviewRedirectGuard on every overview landing decision
  clearFoundation(): void;
  clearProject(): void;
}
```

Resolution rules for `activeContext`:

- `activeLens === 'foundation'` → returns the foundation selection.
- `activeLens === 'project'` → returns the project selection.
- `activeLens === 'me' | 'org'` → returns the foundation selection if the persona is board-scoped (`hasBoardRole`), otherwise the project selection.

Example — a feature page reading the context:

```typescript
// apps/lfx-one/src/app/modules/votes/votes-dashboard/votes-dashboard.component.ts (sketch)
private readonly projectContextService = inject(ProjectContextService);

protected readonly activeContext = this.projectContextService.activeContext;
protected readonly canWrite = this.projectContextService.canWrite;
```

## Org Lens addresses

Org Lens is the one lens whose context **is** in the route: pages are addressed `/org/{segment}/{page}` (spec 050), where `{segment}` is the organization's slug, or its 18-char SFID when it has none. The legacy `/org/{page}` form still routes and renders the selected organization. Its address is rewritten to the organization's form only when a selection is written or confirmed under it: an organization switch, or the default / cookie-restored selection the org list confirms on its first answer. One exception: on the `/org/not-found` dead end (or anything beneath it), picking the organization that is already selected still leaves, for its overview. The general legacy-address redirect is spec 050 US3, not yet built — see `app.routes.ts`. Three rules follow from that, and all are enforced only by convention — read them before adding an Org Lens page or link:

1. **Never hard-code an Org Lens address.** Every in-app link (sidebar item, breadcrumb, table row, "view all", CTA) is built through `OrgLensNavigationService` (`apps/lfx-one/src/app/shared/services/org-lens-navigation.service.ts`): `orgLensLink(page, …rest)` returns router commands (`['/org', segment, page, …]`, or the legacy `['/org', page, …]` while nothing is selected), `orgLensPath(...)` the same as a string for string-typed `routerLink`s. Both read `AccountContextService.selectedUrlSegment()`, so a link built inside a `computed()` follows an organization switch. Build links in a `computed()` or in the row view-model — not by calling the service from the template (frontend-checklist §4). EasyCLA is no exception (lfx-self-serve#2743); its leftover `/org/easycla` mount and `?org=` reader stay for one release after the `ORG_EASYCLA_RETURN_IN_PATH` rollout gate is enabled — the BFF mints the org-addressed return only once every replica that could serve it routes the twin — for returns minted before the flip.
2. **Recognition-time code uses the URL, not the selection.** A `CanMatch`/`CanActivate` guard mounted under `/org/:orgSegment` runs _before_ `orgPathParamGuard` has adopted the addressed organization, so at that moment the selection may still be the cookie's. Such a guard derives its redirect target from the URL being recognized with `orgLensPagePath(urlSegments, page)` (`packages/shared/src/utils/org-lens-url.utils.ts`) — as `orgLensRoiEnabledGuard` does. `OrgLensNavigationService` (selection-derived) is for links and for code that runs after recognition; `orgLensClaM3EnabledGuard` falls back to it only on the legacy `/org/easycla` address, which names no organization to keep.

3. **An Org Lens `routerLink` is an address, not an identity.** It changes on every organization switch, so it must not be a `@for` track key — the whole list would be torn down and rebuilt (and Font Awesome's kit JS re-bakes every icon) when only the hrefs moved. Track org-scoped rows by `orgLensDestinationKey(routerLink)` (`packages/shared/src/utils/org-lens-url.utils.ts`, the address with the organization segment removed) or another organization-independent key, as `SidebarComponent` does.

Re-addressing after a selection change is `OrgLensNavigationService.navigateToSelectedOrg(intent)`. It is a no-op unless the selection carries a URL segment. A `'switch'` (the viewer picked an organization in the selector) re-addresses any Org Lens page — including off the `/org/not-found` dead end — and **pushes** history so Back returns to the pre-switch organization; except when the address named no organization (bare `/org`, legacy `/org/{page}`), where there is nothing to go back to and the insert **replaces** like a canonicalization. A `'default'` (the app selected an organization because none was, or restored the cookie's) only fills an organization into a legacy address that names none, **replaces** history, and never leaves `/org/not-found` or overrides an address that already names an organization. The service itself reads `router.url` synchronously; the deferral lives in the caller: `OrgNavigationService.writeDefaultAddress()` issues the `'default'` write only when the router is idle, otherwise defers it until the in-flight navigation (and any cancel-and-redirect after it) has settled — one pending write at most, torn down with the service — and then re-reads the destination. A `'switch'` is issued synchronously: the viewer's click is itself the settled address.

**EasyCLA's corporate-signing return is the one place a query parameter names an organization**, and two rules keep it from outranking the path (lfx-self-serve#2743, #2770):

- `?org=` is honoured **only on the leftover `/org/easycla/…` mount**, where the address carries no organization otherwise. Under `/org/:orgSegment/easycla/…` the path is the authority (`orgPathParamGuard` adopted it before activation); a `?org=` there — stale from a switch, or crafted — is never adopted, and is stripped from the address. Both EasyCLA pages ask the one predicate, `OrgLensNavigationService.isOrgAddressed(route.snapshot)`, so they cannot drift.
- A `'switch'` that leaves **any** EasyCLA address, on either mount, drops `?org=` and `?signed=` (`queryParamsHandling: 'merge'` with both nulled; the rest of the query, e.g. `?sig=`, rides along as on every other page). Return state describes a trip opened for one organization and never belongs to another; the page is reused across the switch, so a preserved `?signed=1` would resume the old organization's wait under the new one.

**The addressed selection is pinned against bootstrap re-seeding.** `AccountContextService.addressedUid` marks the selection an address names; while it is set, `initializeUserOrganizations` (the persona refresh) and the org-items default do not replace it. Three paths set it: the path guard's resolver hit (`adoptFromAddress`), the guard's already-selected shortcut, and the org-items default or cookie-restored match the moment before `navigateToSelectedOrg('default')` writes it into the address (`pinSelection`, lfx-self-serve#2570). The third matters for grant-only viewers (staff): their persona response carries **no** organizations, and if it lands after the default has been written into `/org/{segment}/{page}` an unpinned selection is reset to the placeholder under that address — the bar names the organization, the page renders empty. Pinning happens at selection time, not at the write, because the refresh can also land in the gap before the write. The pin therefore outlives the write: a default selected outside Org Lens (where the `'default'` write is a no-op) stays pinned with no address naming it, and the unpinned re-seed paths run only before any default / restored / adopted selection exists — intended, since the mid-session reset blanks the selector on the Me lens the same way. Two kinds of pin: an **address** pin (resolver hit, FR-020 stub, guard shortcut — `isAdoptedFromAddress`) is honoured by every bootstrap path including a later org-items reload; a **default** pin (org-items default, cookie-restored match) holds only against the persona re-seed, and a later authoritative org-items page re-runs the selection. The guard shortcut **upgrades** a default pin to an address pin the moment the default write lands on `/org/{segment}/…` — deliberately: a re-default there would render B under `/org/A` (the `'default'` write leaves an addressed page alone), spec 050's silent substitution. So the default kind governs only pages no address names (Me/Project lens, the legacy form before its write); and `OrgNavigationService.handlePendingSelection` refuses to re-default while `OrgLensNavigationService.isOnAddressedPage()` — on an addressed page a mid-session revocation keeps the selection the address names, never another organization under it; routing it to `/org/not-found`, as a resolver miss does, is a follow-up. The EasyCLA leftover return (`OrgClaReturnService.adopt`) is the fourth address-pin path: `?org=` names the organization there, and the return can resolve before the persona refresh lands. The data is FGA-gated regardless.

The slug in every Org Lens address and link is the **index's** (the org-items row or the resolver's answer), never member-service's. Addresses are resolved against the index (`/api/orgs/resolve/:segment` reads query-service); the canonical record (`GET /api/orgs/uid/:uid`, member-service) runs ahead of it during lag, so a slug taken from there would reopen as not-found for anyone the address is shared with. Concretely:

- **Only indexed rows write the slug.** `AccountContextService.applyCanonicalRecord` never touches it — not to fill a gap, not to overwrite, and not to unset one it disagrees with: the next navigation asks the resolver, which is the index and hands the indexed slug straight back, so an unset would only flip-flop. The Org Profile edit hook (`updateCanonicalRecord`, spec 021) patches display fields and leaves the slug alone for the same reason.
- **Unknown slug → SFID address.** A selection with no indexed slug yet (a cookie-restored or FR-020 stub) addresses as its SFID until an indexed row answers: the org list on bootstrap, or the resolver on the next navigation (the path guard takes no shortcut for an unknown slug). An address-adopted selection is never re-checked by the org list; its slug comes from the resolver alone.
- **A rename lands links first, then the address.** Once the index carries the new slug and an indexed row has answered with it, every `orgLensLink` re-renders from the selection immediately; the address bar follows on the next navigation the path guard resolves, because a `'default'` write never re-addresses an already-addressed page. Until the index catches up, the old slug is still the indexed one and still resolves.
- **The guard's shortcut trusts a held slug only until the next resolve.** `orgPathParamGuard` skips the round trip for a known, slug-shaped (`isOrgSlugSegment`) held slug that matches the address; a slug the index reassigns in between is not detected until a resolve occurs. FGA gates the page data regardless.

Nothing re-writes an address behind a canonical-record fetch; `orgPathParamGuard` still canonicalizes a deep link from the resolver's own answer.

## Org Lens empty states

Every Org Lens "nothing to show" — page-level and section-level — renders from one component, `<lfx-org-lens-empty-state>` (`apps/lfx-one/src/app/shared/components/org-lens-empty-state/`), driven by the copy registry `ORG_LENS_EMPTY_STATE_COPY` (`packages/shared/src/constants/org-lens-empty-state.constants.ts`; state names and action kinds in `packages/shared/src/interfaces/org-lens-empty-state.interface.ts`). Call sites choose a **state**, never a string; product and design review the registry file. The one exception is the Org-Lens-off dead end on `/org/not-found` (spec 050 US5), which keeps its static cause-blind wording.

**Page level** is decided by `OrgLensEmptyStateService.pageState` (`apps/lfx-one/src/app/shared/services/org-lens-empty-state.service.ts`), which mirrors the server read gate's precedence (spec 053 FR-016):

1. the caller holds the selected organization (direct, inherited, or LF-team) → render the page; a partial roll-up shows the switcher's "list incomplete" notice instead (FR-010);
2. the roster never loaded (`lookupOutcome: 'failed'`) → `could-not-load`;
3. the roster is partial and the caller holds nothing loaded → `could-not-load`;
4. the LF-team check failed (`staffCheck: 'failed'`) → `staff-check-failed`, with the reference id;
5. the caller holds nothing → `no-organization`;
6. otherwise a selection is pending → render the page.

Rule 1 before 2–3 is the #2216 fix (a present grant is authoritative whatever else failed); rule 4 before 5 is the #2533 never-fall-through rule (a failed check must not read as the employee no-access copy). Rules 2–4 live in one place, `OrgLensEmptyStateService.classifyLookup(holdsAnything)`, which both the page and the dead end call.

`/org/not-found` (`org-not-found.component.ts`) applies, in order: **`not-found-staff`** when the caller is LF team (the rule-1 analogue — their own list is empty by design and their way in is switcher search); then **`classifyLookup`** (rules 2–4) with "holds anything" = the caller's grant sets or list rows are non-empty (unfiltered — an open switcher search must not flip the state); then **`could-not-load`** when the caller's own list failed to load (`OrgNavigationService.upstreamFailed`); then **`wrong-organization`** when the caller holds something (the list is the primary control — picking a row leaves through `OrgLensNavigationService.navigateToSelectedOrg('switch')`, or the legacy `/org/overview` when the row has no URL segment) or **`no-access`**. The `no-access` / `wrong-organization` states never name the addressed organization (spec 050 DR-002).

**Retry** (`OrgLensEmptyStateService.retry`, shared by the page states, the dead end and the switcher's FR-010 notice) re-runs the role-grants lookup with the BFF cache bypassed (`?refresh=1`) and then, if a list was fetched or is in flight, re-fetches it through `OrgNavigationService.refreshList` — which, unlike the bootstrap's `resetAndReload`, never default-selects another organization or clears the current one.

**Section level** is classified per request by `classifySectionError` (`apps/lfx-one/src/app/shared/utils/org-lens-empty-state.utils.ts`) from the refusal's stated `code`, never from HTTP status alone: `FORBIDDEN` → `section-no-access`; `ROLE_GRANTS_UNAVAILABLE` / `ACCESS_CHECK_UNAVAILABLE` (`ORG_LENS_UNVERIFIABLE_ACCESS_CODES`) → `section-could-not-verify` with Retry; anything else, including a 403 without the gate's code → `section-could-not-load`. An empty result set → `section-empty`, which names the selected period and offers "Reset filters" only when a caller-set filter narrows the query (FR-013).

**Wire contract** — `GET /api/orgs/me/role-grants` (`RoleGrantsResponse`, `packages/shared/src/interfaces/org-selector.interface.ts`) carries, besides the grant sets: `lookupOutcome` (`ok` | `partial` | `failed`), `staffCheck` (`ok` | `failed`) and, only when the staff check failed, `correlationId` — also sent as the `X-Correlation-Id` response header (its own header, not `X-Request-Id`: it is the id logged by the computation that produced the result, which within the short cache window may be an earlier request's). The server (`apps/lfx-one/src/server/services/org-role-grants.service.ts`) never caches a failed roster; a failed staff check is cached only for `ORG_ACCESS_AWARE_FAILED_STAFF_CHECK_CACHE_TTL_MS` (5 s) with its id — the short entry shields the gate reads (every section request, the org-items list) during an authorizer outage while recovery is not pinned for the full TTL; a degraded roll-up keeps the full TTL (its causes are often structural). The viewer's Retry (`?refresh=1`) recomputes once per click, coalesced per burst, and rewrites the entry — but only past a degraded or failed entry; a clean `ok` entry is never bypassable, so the flag is not a fan-out lever.

## Putting it together

The lens system is designed so that **route depth never reflects context** — every feature lives at a flat top-level route (`/meetings`, `/votes`, etc.) and reads its context at runtime from `LensService` + `ProjectContextService`. This keeps routing simple and lets lens switches change the whole dashboard without a re-route.

Sequence for a typical page load:

1. **SSR**: `resolvePersonaForSsr` fetches personas + organizations from cookie/NATS, populates `AuthContext`.
2. **Hydration**: `PersonaService` signals populate from `AuthContext` via Angular TransferState.
3. **Enrichment**: `refreshEnrichedPersonas()` fires in the background to hydrate `personaProjects`.
4. **Lens gating**: `LensService.activeLens` clamps to the allowed set; `availableLenses` drives the lens-switcher UI.
5. **Feature page**: reads `activeLens` + `ProjectContextService.activeContext` to decide which data to fetch and which UI variants to render.

## Related

- [Persona Detection Pipeline](persona-detection.md) — where personas come from: the upstream persona-service NATS contract and the detection→persona mapping that feeds the signals above.
- [Impersonation](../backend/impersonation.md) — how the server-side effective identity interacts with persona detection.
- [Component Architecture](component-architecture.md) — layout components (`MainLayoutComponent`, `ProfileLayoutComponent`) that host lens-aware pages.
- [Drawer Pattern](drawer-pattern.md) — several drawers use `buildLensAwareInsightsUrl` to deep-link into Insights with the right scope.
