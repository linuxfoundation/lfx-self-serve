# LFXV2-2206 — Project / Foundation dashboard sidebar (Quick Links + Staff)

## Context

LFX One’s Project and Foundation overview dashboards currently render as a single full-width column with Quick links inline in the page header. Staff data (`executive_director`, `program_manager`, `opportunity_owner`) already loads via `PermissionsService.getProjectSettings()` and renders in `lfx-project-staff-card`, but only as a carousel metric card inside `lfx-foundation-health` — not on the Project lens at all.

PCC’s dashboard pairs a wide main column with a narrower sidebar containing **QUICK LINKS** and **PROJECT STAFF**. This ticket adapts that layout for Self Serve’s Project and Foundation overview pages: a flex main + fixed-width sidebar at `xl`, with permission-gated Quick links and conditionally visible staff.

## Outcome

- **Project lens** (`/project/overview`): Page title only in the header. Below it, a responsive flex layout with the left main column stacking Recent Progress → Meetings → Pending Actions, and a right sidebar showing Quick links (when `canWrite`) and **Project Staff** when staff data warrants display (see visibility gating below).
- **Foundation lens** (`/foundation/overview`, ED and Board personas): Same flex layout. Main column stacks Foundation Health → Marketing Overview (ED only) → Meetings → Pending Actions → Organization Involvement. Sidebar shows Quick links (when `canWrite`) and **Foundation Staff** under the same visibility rules.
- Staff rows show avatar, person name (or “Not Set”), and role label — vertical collaborator layout (PCC `collaborators.component.html` pattern), not the metric-card row layout.
- Staff is **removed** from the Foundation Health carousel and the **Staff** filter pill is removed — staff lives only in the sidebar.
- **Project lens** gains Pending Actions, wired to `ProjectService.getPendingActions(slug, uid)` scoped to the active project.
- Below `xl` breakpoint, the sidebar stacks below the main column at full width (mobile-first stack).

## Scope decisions

- **Layout:** `flex flex-col xl:flex-row xl:items-start xl:gap-10` with main `flex-1 min-w-0` and sidebar host `block w-full shrink-0 xl:w-64` (~256px fixed width at desktop). Not a proportional 75/25 CSS grid — the sidebar stays a consistent readable width while main content fills remaining space.
- **Quick links placement:** Move entirely from header to sidebar. Header retains only the `{name} Overview` title.
- **Quick links gating:** Keep existing `ProjectContextService.canWrite` gate — same three create links (meeting, group, mailing list). When `canWrite()` is false, hide the Quick links section entirely (`@if (canWrite())` in template; `empty:hidden` on sidebar host collapses empty quicklinks).
- **Staff visibility gating:** Hide the entire staff section when there is nothing meaningful to show: `@if (loading() || hasError() || hasAnyStaff())`. When fetch succeeds with zero assigned roles, the staff block is omitted (sidebar may show only Quick links, or collapse entirely via `empty:hidden`). Loading and error states still render. When at least one role is assigned, all three rows render — including “Not Set” placeholders for vacant roles.
- **Staff heading:** `"Project Staff"` on Project lens; `"Foundation Staff"` on Foundation lens. Section header uses icon + title + horizontal rule (`text-base font-medium`, `fa-people-group`), not the uppercase label style used for Quick links.
- **Staff data source:** Reuse `GET /api/projects/:uid/permissions` → `ProjectSettings` — no new BFF endpoint.
- **Staff edit dialog:** Out of scope — PCC’s `EditProjectStaffComponent` / PATCH flow does not exist in Self Serve; staff is read-only display.
- **Foundation-only sections** (Marketing Overview, Organization Involvement) stay in the main column, not the sidebar.
- **Me / Org / Multi-persona dashboards:** Out of scope — only Project and Foundation overview pages change.
- **PR size:** Single PR, estimated ~400–600 LOC across shared constants, 2–3 component refactors, 3 dashboard templates, and foundation-health cleanup.

## Architecture mirror table

| Concern                  | Shipped pattern (PCC)                                                                                         | This ticket (Self Serve)                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Main + sidebar layout    | `dashboard.component.html` (`xl:w-3/4` / `xl:w-1/4`)                                                          | Flex row at `xl` with `flex-1` main + `xl:w-64` sidebar                                 |
| Quick links sidebar card | `quick-links/quick-links.component.html` — vertical links in `p-card` header `"QUICK LINKS"`                  | `dashboard-quicklinks` with `layout="sidebar"`                                          |
| Staff sidebar card       | `collaborators/collaborators.component.html` — avatar + name + role rows in `p-card` header `"PROJECT STAFF"` | `project-staff-card` with dynamic heading                                                 |
| Staff data               | Embedded on `Project` from `GET projects/{id}?view=pcc`                                                       | `PermissionsService.getProjectSettings(uid)` → `ProjectSettings`                        |
| Staff roles              | ED, Program Manager, Opportunity Owner (hard-coded labels)                                                    | Same three roles via shared constant                                                    |
| Quick links permissions  | Per-resource permission getters                                                                               | `canWrite` aggregate (existing Self Serve pattern)                                      |
| Pending actions          | N/A on PCC dashboard                                                                                          | `executive-director-dashboard.component.ts` pattern                                     |

The PCC `collaborators.component.html` vertical row layout (avatar left, name, role below) is the visual reference for the sidebar staff variant.

## File structure map

```
Modify: packages/shared/src/constants/project-staff.constants.ts — PROJECT_STAFF_ROWS constant (role keys, labels, icons)
Modify: packages/shared/src/constants/index.ts — re-export PROJECT_STAFF_ROWS

Modify: apps/lfx-one/src/app/modules/dashboards/components/dashboard-quicklinks/dashboard-quicklinks.component.ts — add layout input
Modify: apps/lfx-one/src/app/modules/dashboards/components/dashboard-quicklinks/dashboard-quicklinks.component.html — sidebar variant template

Modify: apps/lfx-one/src/app/modules/dashboards/components/project-staff-card/project-staff-card.component.ts — heading input; use shared constant
Modify: apps/lfx-one/src/app/modules/dashboards/components/project-staff-card/project-staff-card.component.html — sidebar staff template
Modify: apps/lfx-one/src/app/modules/dashboards/components/project-staff-card/project-staff-card.component.scss — sidebar row styles if needed

Create: apps/lfx-one/src/app/modules/dashboards/components/dashboard-sidebar/dashboard-sidebar.component.ts — composes quick links + staff for sidebar column
Create: apps/lfx-one/src/app/modules/dashboards/components/dashboard-sidebar/dashboard-sidebar.component.html

Modify: apps/lfx-one/src/app/modules/dashboards/components/foundation-health/foundation-health.component.ts — remove staff filter pill, showStaffCard, ProjectStaffCard import
Modify: apps/lfx-one/src/app/modules/dashboards/components/foundation-health/foundation-health.component.html — remove staff card from carousel

Modify: apps/lfx-one/src/app/modules/dashboards/project-dashboard/project-dashboard.component.ts — pending actions signal, sidebar import, cast drawer host
Modify: apps/lfx-one/src/app/modules/dashboards/project-dashboard/project-dashboard.component.html — flex layout, pending actions, sidebar

Modify: apps/lfx-one/src/app/modules/dashboards/executive-director/executive-director-dashboard.component.ts — sidebar import
Modify: apps/lfx-one/src/app/modules/dashboards/executive-director/executive-director-dashboard.component.html — flex layout, sidebar

Modify: apps/lfx-one/src/app/modules/dashboards/board-member/board-member-dashboard.component.ts — sidebar import
Modify: apps/lfx-one/src/app/modules/dashboards/board-member/board-member-dashboard.component.html — flex layout, sidebar
```

### Step clusters

**Step cluster A — Shared constants + sidebar leaf components:**
`project-staff.constants.ts`, `dashboard-quicklinks` sidebar variant, `project-staff-card` sidebar variant, new `dashboard-sidebar`

**Step cluster B — Remove duplicate staff from Foundation Health carousel:**
`foundation-health.component.{ts,html}`

**Step cluster C — Wire flex + sidebar layout on all three overview dashboards:**
`project-dashboard`, `executive-director-dashboard`, `board-member-dashboard` (+ pending actions on project dashboard)

---

## Step 1 — Shared constants + sidebar leaf components

**Files:**

- `packages/shared/src/constants/project-staff.constants.ts` (new)
- `packages/shared/src/constants/index.ts`
- `apps/lfx-one/src/app/modules/dashboards/components/dashboard-quicklinks/dashboard-quicklinks.component.ts`
- `apps/lfx-one/src/app/modules/dashboards/components/dashboard-quicklinks/dashboard-quicklinks.component.html`
- `apps/lfx-one/src/app/modules/dashboards/components/project-staff-card/project-staff-card.component.ts`
- `apps/lfx-one/src/app/modules/dashboards/components/project-staff-card/project-staff-card.component.html`
- `apps/lfx-one/src/app/modules/dashboards/components/project-staff-card/project-staff-card.component.scss`
- `apps/lfx-one/src/app/modules/dashboards/components/dashboard-sidebar/dashboard-sidebar.component.ts` (new)
- `apps/lfx-one/src/app/modules/dashboards/components/dashboard-sidebar/dashboard-sidebar.component.html` (new)

**What:**

1. **Shared constant** — create `packages/shared/src/constants/project-staff.constants.ts`:

```typescript
import type { ProjectSettings } from '../interfaces/project.interface';

export interface ProjectStaffRowConfig {
  key: keyof Pick<ProjectSettings, 'executive_director' | 'program_manager' | 'opportunity_owner'>;
  label: string;
  icon: string;
}

export const PROJECT_STAFF_ROWS: readonly ProjectStaffRowConfig[] = [
  { key: 'executive_director', label: 'Executive Director', icon: 'fa-light fa-user-tie' },
  { key: 'program_manager', label: 'Program Manager', icon: 'fa-light fa-user-gear' },
  { key: 'opportunity_owner', label: 'Opportunity Owner', icon: 'fa-light fa-user-chart' },
] as const;
```

Export from `constants/index.ts`. Map rows in a `computed()` using `PROJECT_STAFF_ROWS` + `settings()`. A minimal local `StaffRow` type (adds `user` field only) is acceptable.

2. **`dashboard-quicklinks`** — add input:

```typescript
public readonly layout = input<'header' | 'sidebar'>('header');
```

- **`header`** (default): keep current horizontal inline template unchanged.
- **`sidebar`**: new block wrapped in `@if (canWrite())`:
  - Section label: `<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick links</h2>`
  - Responsive link list: horizontal wrap below `xl`, vertical column at `xl+`.
  - `data-testid="dashboard-quicklinks-sidebar"`.

3. **`project-staff-card`** — add heading input:

```typescript
public readonly heading = input<string>('Project Staff');
```

- Sidebar-only full-width column gated by `@if (loading() || hasError() || hasAnyStaff())`:
  - Section header: icon + `{{ heading() }}` + horizontal rule (`text-base font-medium text-gray-900`, `fa-people-group`).
  - When visible, iterate all three staff rows. Assigned: avatar + name + role below + optional mailto with tooltip. Unassigned within a visible section: grey placeholder avatar + “Not Set” + role label.
  - Loading/error states adapt to sidebar width (no fixed `md:w-80`).
  - `data-testid="project-staff-sidebar"`.

4. **`dashboard-sidebar`** — new component:

```typescript
@Component({
  selector: 'lfx-dashboard-sidebar',
  host: { class: 'block w-full shrink-0 xl:w-64' },
  imports: [DashboardQuicklinksComponent, ProjectStaffCardComponent],
  templateUrl: './dashboard-sidebar.component.html',
})
export class DashboardSidebarComponent {
  public readonly projectUid = input.required<string>();
  public readonly staffHeading = input.required<string>();
}
```

Template:

```html
<aside class="flex flex-col gap-8 w-full" data-testid="dashboard-sidebar">
  <lfx-dashboard-quicklinks layout="sidebar" class="empty:hidden" />
  <lfx-project-staff-card [projectUid]="projectUid()" [heading]="staffHeading()" class="empty:hidden" />
</aside>
```

**Why:**
Centralizes sidebar composition once so three dashboard templates stay DRY. `empty:hidden` collapses each child when its template renders no DOM (e.g. quicklinks hidden for non-writers, staff hidden when fully unassigned).

**Out of scope:** Card wrapper components (`p-card`); Self Serve uses Tailwind sections, not PrimeNG cards.

**References:**

- PCC staff rows: `/Users/audi/01-home/02-work/Sites/lfx/pcc/main/apps/v2-frontend/src/app/modules/pages/dashboard/components/collaborators/collaborators.component.html`
- Existing staff fetch: `project-staff-card.component.ts`
- `UserInfo` / `ProjectSettings`: `packages/shared/src/interfaces/project.interface.ts`

**Decisions made in Step 1:**

- Kept a minimal local `StaffRow` type derived from `PROJECT_STAFF_ROWS` keys (adds `user` field only).
- Sidebar staff layout uses name-above-role vertical stack with grey placeholder avatar for unassigned roles.
- Staff section hidden entirely when fetch succeeds with zero assigned roles — avoids an empty-looking sidebar block.
- `dashboard-quicklinks` sidebar variant wraps the section in `@if (canWrite())` at the outer block level.

---

## Step 2 — Remove staff from Foundation Health carousel

**Files:**

- `apps/lfx-one/src/app/modules/dashboards/components/foundation-health/foundation-health.component.ts`
- `apps/lfx-one/src/app/modules/dashboards/components/foundation-health/foundation-health.component.html`

**What:**

1. Remove `{ id: 'staff', label: 'Staff' }` from `filterOptions` array.
2. Delete `showStaffCard` computed.
3. Remove `ProjectStaffCardComponent` from imports and the template carousel block.
4. Remove the `filter === 'staff'` early-return branch in metric card initialization.

**Why:**
Staff moves to the page-level sidebar; keeping it in the carousel duplicates data and preserves a filter pill that no longer has meaning.

---

## Step 3 — Wire flex + sidebar layout on Project, ED, and Board overview dashboards

**Files:**

- `apps/lfx-one/src/app/modules/dashboards/project-dashboard/project-dashboard.component.ts`
- `apps/lfx-one/src/app/modules/dashboards/project-dashboard/project-dashboard.component.html`
- `apps/lfx-one/src/app/modules/dashboards/executive-director/executive-director-dashboard.component.ts`
- `apps/lfx-one/src/app/modules/dashboards/executive-director/executive-director-dashboard.component.html`
- `apps/lfx-one/src/app/modules/dashboards/board-member/board-member-dashboard.component.ts`
- `apps/lfx-one/src/app/modules/dashboards/board-member/board-member-dashboard.component.html`

**What:**

### Shared layout pattern (all three templates)

Replace header quicklinks + full-width sections stack with:

```html
<!-- Header: title only -->
@if (context()) {
<div class="mb-6" data-testid="...-foundation-project">
  <h1 class="font-display font-light text-2xl">{{ context()?.name }} Overview</h1>
</div>
}

<!-- Main + sidebar flex -->
<div class="flex flex-col xl:flex-row xl:items-start xl:gap-10 gap-10" data-testid="...-sections-grid">
  <div class="flex flex-col gap-10 flex-1 min-w-0">
    <!-- existing @defer sections here, unchanged order -->
  </div>

  @if (context()?.uid; as uid) {
  <lfx-dashboard-sidebar [projectUid]="uid" [staffHeading]="staffHeading" />
  }
</div>
```

Remove `<lfx-dashboard-quicklinks />` from the header in all three templates.

### Project dashboard (`project-dashboard.component.ts`)

Add imports: `DashboardSidebarComponent`, `PendingActionsComponent`, `DashboardCastDrawerHostComponent`.

Add pending-actions wiring mirroring ED dashboard via private `initPendingActions()`:

```typescript
private readonly projectService = inject(ProjectService);
private readonly refresh$ = new BehaviorSubject<void>(undefined);

protected readonly staffHeading = 'Project Staff';

public readonly pendingActions: Signal<PendingActionItem[]>;

public constructor() {
  this.pendingActions = this.initPendingActions();
}
```

Add pending actions to main column **after Meetings** and cast drawer host at template bottom.

### Foundation dashboards

**ED / Board:** `protected readonly staffHeading = 'Foundation Staff'`. Import `DashboardSidebarComponent`. Remove `DashboardQuicklinksComponent` from dashboard imports (sidebar owns it).

Main column section order unchanged:

- **ED:** Foundation Health → Marketing Overview → Meetings (if `showMeetings()`) → Pending Actions → Org Involvement (if `showOrgInvolvement()`)
- **Board:** Foundation Health → Meetings (if `showMeetings()`) → Pending Actions → Org Involvement (if `showOrgInvolvement()`)
- **Project:** Recent Progress → Meetings → Pending Actions

Sidebar receives `activeContext().uid` — for Foundation lens this is the foundation UID via `ProjectContextService.activeContext()`.

**Decisions made in Step 3:**

- Project dashboard pending actions omit the persona param (server treats as persona-agnostic).
- Sidebar UID sourced from `selectedProject()` / `activeContext()` on all three dashboards.
- ED/Board header uses `selectedFoundation()?.name` for title; sidebar uses `selectedProject()?.uid` for staff fetch UID.
- Fixed-width sidebar (`xl:w-64`) chosen over proportional grid for consistent sidebar readability.

---

## Step 4 — Verification

1. **Type/lint/format/build:**

   ```bash
   yarn check-types
   yarn lint:check
   yarn format:check
   yarn build
   ```

2. **Manual smoke (golden path):**
   - **Project lens** (`/project/overview?project={slug}`): At ≥1280px, main content left + ~256px sidebar right. Left: Recent Progress, Meetings, Pending Actions. Right: Quick links (writer user) + Project Staff when at least one role assigned. Header has title only.
   - **Foundation lens — ED** (`/foundation/overview?project={foundation-slug}`): Main column + sidebar with Quick links + **Foundation Staff** heading when staff present.
   - **Foundation lens — Board**: Same sidebar; main column omits Marketing Overview.
   - **Contributor (canWrite=false)**: Quick links hidden; staff visible only when at least one role is assigned.
   - **Foundation Health carousel**: No Staff filter pill; no staff card in horizontal scroll.

3. **Edge cases:**
   - Project with no staff assigned → staff section hidden; sidebar may be empty or show only Quick links.
   - Project with one role assigned → all three rows visible (assigned + “Not Set” for vacant roles).
   - `getProjectSettings` failure → staff section shows error state (`project-staff-card-error`).
   - Narrow viewport (< `xl`) → sidebar stacks below main content at full width.

4. **Regression check:**
   - Me lens dashboard (`/`) unchanged.
   - Foundation Health metric cards and drawers still work without staff card in carousel.
   - Quick link routes (`/meetings/create`, `/groups/create`, `/mailing-lists/create`) still navigate correctly from sidebar.

---

## Critical files cheat sheet

| File                                                       | Purpose (Step)                              |
| ---------------------------------------------------------- | ------------------------------------------- |
| `packages/shared/src/constants/project-staff.constants.ts` | Shared staff row config (1)                 |
| `dashboard-quicklinks.component.{ts,html}`                 | Header + sidebar quick link variants (1)    |
| `project-staff-card.component.{ts,html,scss}`              | Sidebar staff display (1)                   |
| `dashboard-sidebar.component.{ts,html}`                    | Sidebar column composer (1)                 |
| `foundation-health.component.{ts,html}`                    | Remove carousel staff (2)                   |
| `project-dashboard.component.{ts,html}`                    | Project flex layout + pending actions (3)   |
| `executive-director-dashboard.component.{ts,html}`         | ED flex layout (3)                          |
| `board-member-dashboard.component.{ts,html}`               | Board flex layout (3)                       |

## Reused functions/utilities

- `PermissionsService.getProjectSettings(uid)` — staff data fetch
- `ProjectContextService.canWrite` — quick links gate
- `ProjectContextService.activeContext` / `selectedFoundation` / `selectedProject` — UID and title context
- `ProjectService.getPendingActions(slug, uid)` — pending actions for project dashboard
- `PROJECT_STAFF_ROWS` — role labels/icons (new shared constant, Step 1)
- `AvatarComponent` (`lfx-avatar`) — staff avatars
- `PendingActionsComponent` + `DashboardCastDrawerHostComponent` — pending actions + vote drawer

## Out of scope (per ticket)

- Edit-project-staff dialog and PATCH mutation (PCC `EditProjectStaffComponent`)
- Me, Org, and Multi-persona dashboard layout changes
- Per-resource quick link permission granularity (PCC-style); Self Serve keeps aggregate `canWrite`
- New BFF endpoints or microservice changes
- E2E test additions (no existing dashboard staff E2E coverage; manual smoke sufficient for v1)
- Sticky/fixed sidebar scroll behavior
- Proportional 75/25 CSS grid layout (shipped as flex + fixed sidebar width instead)
- “Foundation Staff” vs “Project Staff” for sub-projects under a foundation on Project lens — Project lens always shows **Project Staff** for the selected project node
