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

Feature routes (`/meetings`, `/votes`, `/surveys`, etc.) typically don't declare `data.lens` — instead, feature pages **read** `activeLens` from `LensService` to decide whether to show a "My …" view (me lens) or a scoped view.

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

  setFoundation(ctx: ProjectContext): void;
  setProject(ctx: ProjectContext): void;
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

Org Lens is the one lens whose context **is** in the route: pages are addressed `/org/{segment}/{page}` (spec 050), where `{segment}` is the organization's slug, or its 18-char SFID when it has none. The legacy `/org/{page}` form still routes and renders the selected organization. Its address is rewritten to the organization's form only when the selection is written under it: an organization switch, or the automatic default (or cookie-restored selection) applied when the org list first answers. One follow-up exists: on the `/org/not-found` dead end, picking the organization that is already selected leaves for its overview. The general legacy-address redirect is spec 050 US3, not yet built — see `app.routes.ts`. Three rules follow from that, and all are enforced only by convention — read them before adding an Org Lens page or link:

1. **Never hard-code an Org Lens address.** Every in-app link (sidebar item, breadcrumb, table row, "view all", CTA) is built through `OrgLensNavigationService` (`apps/lfx-one/src/app/shared/services/org-lens-navigation.service.ts`): `orgLensLink(page, …rest)` returns router commands (`['/org', segment, page, …]`, or the legacy `['/org', page, …]` while nothing is selected), `orgLensPath(...)` the same as a string for string-typed `routerLink`s. Both read `AccountContextService.selectedUrlSegment()`, so a link built inside a `computed()` follows an organization switch. Build links in a `computed()` or in the row view-model — not by calling the service from the template (frontend-checklist §4). EasyCLA (`/org/easycla`) is the single documented exception and keeps its legacy address until lfx-self-serve#2743.
2. **Recognition-time code uses the URL, not the selection.** A `CanMatch`/`CanActivate` guard mounted under `/org/:orgSegment` runs _before_ `orgPathParamGuard` has adopted the addressed organization, so at that moment the selection may still be the cookie's. Such a guard derives its redirect target from the URL being recognized with `orgLensPagePath(urlSegments, page)` (`packages/shared/src/utils/org-lens-url.utils.ts`) — as `orgLensRoiEnabledGuard` does. `OrgLensNavigationService` (selection-derived) is for links and for code that runs after recognition; `orgLensClaM3EnabledGuard` uses it only because the legacy EasyCLA address names no organization to keep.

3. **An Org Lens `routerLink` is an address, not an identity.** It changes on every organization switch, so it must not be a `@for` track key — the whole list would be torn down and rebuilt (and Font Awesome's kit JS re-bakes every icon) when only the hrefs moved. Track org-scoped rows by `orgLensDestinationKey(routerLink)` (`packages/shared/src/utils/org-lens-url.utils.ts`, the address with the organization segment removed) or another organization-independent key, as `SidebarComponent` does.

Re-addressing after a selection change is `OrgLensNavigationService.navigateToSelectedOrg(intent)`. It is a no-op unless the selection carries a URL segment. A `'switch'` (the viewer picked an organization in the selector) re-addresses any Org Lens page — including off the `/org/not-found` dead end — and **pushes** history so Back returns to the pre-switch organization. A `'default'` (the app selected an organization because none was, or restored the cookie's) only fills an organization into a legacy address that names none, **replaces** history, and never leaves `/org/not-found` or overrides an address that already names an organization.

The slug in every Org Lens address and link is the **index's** (the org-items row or the resolver's answer), never member-service's. Addresses are resolved against the index (`/api/orgs/resolve/:segment` reads query-service), and during index lag the canonical record (`GET /api/orgs/uid/:uid`, member-service) runs ahead of it — a slug taken from there would reopen as not-found for anyone the address is shared with. So `AccountContextService.applyCanonicalRecord` never sets the slug — a selection with no indexed slug yet (a cookie stub, the FR-020 resolver-unavailable stub) addresses as its SFID until an indexed row answers — and nothing re-writes an address behind a canonical-record fetch (`orgPathParamGuard` still canonicalizes a deep link from the resolver's own answer, and an Org Profile rename reaches the address only once the index has it). A rename reaches links and addresses together when the index has caught up and the org list is next loaded.

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
