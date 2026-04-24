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
- `availableLenses` is driven by role-based access rules: root writers see all four lenses; `foundation` is available when `hasBoardRole || isRootWriter`; `project` is available when `hasProjectRole || isRootWriter`. A user can carry both roles and see both lenses.

### Route wiring

Every top-level route under `MainLayoutComponent` that is lens-aware declares its lens via `data.lens`:

```typescript
// apps/lfx-one/src/app/app.routes.ts (excerpt)
{ path: '',                    pathMatch: 'full', data: { lens: 'me' },        loadComponent: ... },
{ path: 'foundation/overview',                    data: { lens: 'foundation' }, loadComponent: ... },
{ path: 'foundation/health-metrics',              data: { lens: 'foundation' }, canActivate: [executiveDirectorGuard], loadComponent: ... },
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

## Putting it together

The lens system is designed so that **route depth never reflects context** — every feature lives at a flat top-level route (`/meetings`, `/votes`, etc.) and reads its context at runtime from `LensService` + `ProjectContextService`. This keeps routing simple and lets lens switches change the whole dashboard without a re-route.

Sequence for a typical page load:

1. **SSR**: `resolvePersonaForSsr` fetches personas + organizations from cookie/NATS, populates `AuthContext`.
2. **Hydration**: `PersonaService` signals populate from `AuthContext` via Angular TransferState.
3. **Enrichment**: `refreshEnrichedPersonas()` fires in the background to hydrate `personaProjects`.
4. **Lens gating**: `LensService.activeLens` clamps to the allowed set; `availableLenses` drives the lens-switcher UI.
5. **Feature page**: reads `activeLens` + `ProjectContextService.activeContext` to decide which data to fetch and which UI variants to render.

## Related

- [Impersonation](../backend/impersonation.md) — how the server-side effective identity interacts with persona detection.
- [Component Architecture](component-architecture.md) — layout components (`MainLayoutComponent`, `ProfileLayoutComponent`) that host lens-aware pages.
- [Drawer Pattern](drawer-pattern.md) — several drawers use `buildLensAwareInsightsUrl` to deep-link into Insights with the right scope.
