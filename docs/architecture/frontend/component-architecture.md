# Component Architecture

## 📁 Module File Organization

The project follows a modular file organization pattern where components are organized by their functional area:

### Module Structure

Feature modules live as top-level directories under `apps/lfx-one/src/app/modules/` (not nested under a `project/` parent). The tree below shows a representative slice of how each module is organized — see [AGENTS.md](../../../AGENTS.md#feature-modules) for the full current inventory (badges, documents, events, trainings, transactions, etc. follow the same pattern).

```text
apps/lfx-one/src/app/modules/
├── committees/                 # Committee management
│   ├── committee-dashboard/    # Main committees route component
│   ├── committee-view/         # Committee detail route component
│   ├── committee-manage/       # Committee create/edit
│   └── components/             # Committee-specific components
├── dashboards/                 # Role-based dashboards
│   ├── board-member/           # Board member dashboard
│   ├── contributor/            # Contributor dashboard
│   ├── maintainer/             # Maintainer dashboard
│   └── components/             # Dashboard-specific components (drawers, cards)
├── meetings/                   # Meetings management
│   ├── meetings-entry/         # Route entry for /meetings: picks the dashboard or the redesign (flag + Me lens)
│   ├── meetings-dashboard/     # Existing meetings page (also the only page at /foundation/meetings and /project/meetings)
│   ├── meetings-redesign/      # Me lens meetings redesign, layout shell (flag-gated)
│   ├── meeting-manage/         # Pre-v2 full-page create/edit wizard — the shipping default
│   ├── meeting-composer/       # v2 create/edit composer, a drawer over the current page (flag-gated)
│   ├── meeting-join/           # Public meeting join page
│   ├── meeting-not-found/      # Meeting 404 page
│   └── components/             # Meeting-specific components
├── mailing-lists/              # Mailing lists
│   ├── mailing-list-dashboard/ # Main mailing lists route component
│   ├── mailing-list-view/      # Mailing list detail
│   ├── mailing-list-manage/    # Mailing list create/edit
│   └── components/             # Mailing list components
├── votes/                      # Voting system
│   ├── votes-dashboard/        # Main votes route component
│   ├── vote-manage/            # Vote create/edit
│   └── components/             # Vote-specific components
├── surveys/                    # Survey management
│   ├── surveys-dashboard/      # Main surveys route component
│   ├── survey-manage/          # Survey create/edit
│   └── components/             # Survey-specific components
├── profile/                    # User profile management
│   ├── profile-overview/       # Profile overview tab
│   ├── manage-profile/         # Profile editing
│   ├── affiliations/           # User affiliations
│   ├── developer/              # Developer settings
│   ├── email/                  # Email management
│   ├── password/               # Password management
│   └── components/             # Profile components
├── settings/                   # Application settings
│   ├── settings-dashboard/     # Main settings route component
│   └── components/             # Settings-specific components
└── pages/                      # Static pages
    └── home/                   # Home/projects listing
```

> **Note**: Routes are FLAT under `MainLayoutComponent` — there is no `/project/:slug` nesting.
>
> **Meetings create/edit**: `meetings/` carries two implementations side by side. `meeting-manage/` is the pre-v2 full-page wizard; `meeting-composer/` is the v2 drawer. The `meeting-v2-enabled` LaunchDarkly flag (`MEETING_V2_ENABLED_FLAG`) decides which one a user gets at every entry point: the meetings dashboard, the group meetings tab, meeting cards, the dashboard quicklinks, the create-artifact dialog, and the `/meetings/create` and `/meetings/:id/edit` deep links. Each deep link is a pair of routes on the same path — a composer entry (`MeetingComposerRouteComponent`) behind the `meetingsV2Guard` CanMatch, then the wizard — so turning the flag off sends the same URL back to the wizard with no deploy. With no answer from LaunchDarkly the browser uses `MEETING_V2_ENABLED_DEFAULT` (`false`). Retiring the wizard means dropping each pair's wizard entry, the guard and the flag.
>
> **Meetings page**: the flat `/meetings` route loads `MeetingsEntryComponent`, a thin wrapper that renders a loading state on the server and until LaunchDarkly is ready, then either `MeetingsDashboardComponent` or, when `MEETINGS_REDESIGN_FLAG` is on, the active lens is `me` and the URL is the flat `/meetings`, the `@defer`-loaded `MeetingsRedesignComponent`. The same routes are mounted at `/foundation/meetings` and `/project/meetings`, where the wrapper renders the dashboard immediately (server included) with no loader or flag wait. This is unrelated to the `meeting-v2-enabled` composer flag above.

### Key Principles

1. **Section Organization**: Each major feature area (meetings, committees, etc.) has its own folder
2. **Route Components**: Components that have routes live directly in their section folder
3. **Shared Components Within Section**: Components used only within a section live in that section's `components` folder
4. **Truly Shared Components**: Only components used across multiple sections remain in `apps/lfx-one/src/app/shared/components`

### Import Pattern

When importing section-specific components:

```typescript
// From within the same section (e.g., committee-view importing committee-form)
import { CommitteeFormComponent } from '../components/committee-form/committee-form.component';

// From another section (e.g., project dashboard importing committee-form)
import { CommitteeFormComponent } from '../../committees/components/committee-form/committee-form.component';

// Truly shared components still use the alias
import { ButtonComponent } from '@app/shared/components/button/button.component';
```

### Component Placement Guidelines

When creating new components, follow these guidelines:

1. **Route Components**: If the component has its own route, place it directly in the section folder
2. **Section-Specific Components**: If used only within one section, place in that section's `components` folder
3. **Cross-Section Components**: If used across multiple sections, place in `app/shared/components`
4. **UI Wrapper Components**: PrimeNG wrappers (`lfx-*`) go in `app/shared/components`
5. **Uikit Components**: Generic PrimeNG-free UI primitives (`lfx-ui-*`, `Ui*Component`) go in `app/shared/uikit` — see [Uikit](#-uikit-primeng-free-components)

## 🎯 PrimeNG Component Wrapper Strategy

All PrimeNG components are abstracted through LFX wrapper components for UI library independence and consistent API.

### Wrapper Philosophy

```text
Application Code → LFX Wrapper → PrimeNG Component → DOM
    └── Clean API    └── Abstraction  └── UI Library    └── Rendered UI
```

### Benefits

1. **UI Library Independence**: Easy migration from PrimeNG to other libraries
2. **Consistent API**: All components follow Angular signals pattern
3. **Type Safety**: Proper TypeScript interfaces and validation
4. **Template Flexibility**: Full support for all PrimeNG template options
5. **Brand Consistency**: LFX-specific styling and behavior

## 🧱 Uikit (PrimeNG-free components)

`app/shared/uikit/` is a component library built from Angular and Tailwind only, with no PrimeNG imports, inspired by the Insights uikit. It sits beside the PrimeNG wrappers: new generic primitives can be built here instead of wrapping PrimeNG.

- Selector prefix `lfx-ui-` (enforced by an ESLint override for `shared/uikit/**`) and class names `Ui*Component`, so they never collide with the wrapper classes
- Standalone, signal inputs, `model()` for two-way values, `OnPush`
- Styled with Tailwind only; components use the LFX UI Library `ui-*` roles (see [Styling System](./styling-system.md#lfx-ui-library-tokens))
- Overlays, when needed, build on `@angular/cdk`
- Every component has a Storybook story and a unit spec; run Storybook with `yarn storybook` from the repo root

The component list lives in `apps/lfx-one/src/app/shared/uikit/README.md`, the single source; each component PR adds its entry there.

## 🧩 Current Wrapper Components

### AvatarComponent (`lfx-avatar`)

**Features**: Intelligent priority system with automatic fallback logic

**Priority Chain**: image → icon → label (first character, uppercase)

```typescript
// Avatar with full fallback chain
<lfx-avatar
  [image]="user.picture"
  [icon]="'fa-light fa-user'"
  [label]="user.name"
  [shape]="'circle'"
  (onClick)="handleAvatarClick($event)">
</lfx-avatar>

// Component implementation with computed signals
@Component({
  selector: 'lfx-avatar',
  imports: [CommonModule, AvatarModule],
})
export class AvatarComponent {
  // Input signals
  public readonly image = input<string>('');
  public readonly icon = input<string>('');
  public readonly label = input<string>('');

  // Error handling
  private readonly imageErrorSignal = signal<boolean>(false);

  // Computed display logic
  public readonly displayImage = computed(() => {
    return this.image() && !this.imageErrorSignal() ? this.image() : '';
  });

  public readonly displayIcon = computed(() => {
    return !this.displayImage() && this.icon() ? this.icon() : '';
  });

  public readonly displayLabel = computed(() => {
    const image = this.displayImage();
    const icon = this.displayIcon();
    const label = this.label();

    if (!image && !icon && label) {
      return label.charAt(0).toUpperCase();
    }
    return '';
  });
}
```

### Other Wrapper Components

Additional wrappers follow the same pattern: `BadgeComponent`, `ButtonComponent`, `BreadcrumbComponent`, `CardComponent`, `MenuComponent`, `MenubarComponent`, `TableComponent`. Each uses `input()` signals for properties, `output()` for events, and `@ContentChild` with `descendants: false` for template projection. See the source files in `app/shared/components/` for each wrapper's specific API.

## 🏗 Layout Components

Two layout components ship today under `apps/lfx-one/src/app/layouts/`:

### MainLayoutComponent

The primary layout that wraps every authenticated route (header + sidebar + content outlet). Routes are **flat** under this layout — there is no nested `/project/:slug` routing pattern. Lens context (Me / Foundation / Project / Org) is supplied via `LensService` and the route's `data.lens` value rather than through nested routing.

```typescript
// apps/lfx-one/src/app/app.routes.ts (excerpt)
{
  path: '',
  canActivate: [authGuard],
  loadComponent: () => import('./layouts/main-layout/main-layout.component').then((m) => m.MainLayoutComponent),
  children: [
    { path: '', pathMatch: 'full', data: { lens: 'me' }, loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent) },
    { path: 'meetings', loadChildren: () => import('./modules/meetings/meetings.routes').then((m) => m.MEETING_ROUTES) },
    // ... every feature route registers as a flat child of MainLayoutComponent
  ],
}
```

### ProfileLayoutComponent

Wraps the `/profile` sub-tree to render tabbed profile pages (overview, edit, affiliations, developer, email, password). Used only by profile-feature routes.

### Page header (`lfx-page-header`)

Every main lens page (Me, Foundation, Project, Org) opens with `<lfx-page-header>` (`apps/lfx-one/src/app/shared/components/page-header/`), so title, description and spacing look the same everywhere:

- **Title.** It is always an `h1` in Roboto Slab light at `text-2xl`, `text-gray-900`. Pages never restyle it or bump its size per breakpoint.
- **Description.** The optional `description` input renders Inter `text-sm` in `text-gray-500`, `gap-1` under the title. When the copy needs markup, project a `<span pageHeaderDescription>` instead; it renders under the input in the same style, so it can also carry a second line.
- **Spacing.** The component has no outer margin. The header sits at the top of the page content, so `MainLayoutComponent`'s `py-6` is the only top spacing. Pages leave `mb-6` below it (or a parent `gap-6`; 21px at the 14px root).
- **Slots.** Use `[pageHeaderTitleSuffix]` for an inline tag beside the title, and `[pageHeaderActions]` for buttons or filters to the right of the title; they wrap below it when the row runs out of room. `eyebrow` adds an uppercase label above the title (Marketing Kit).
- **Test ids.** `titleTestId` and `descriptionTestId` keep page-specific test ids. They default to `page-header-title` and `page-header-description`.

Pages opened from a list or an action (detail, create and manage pages) and placeholder pages keep their own headings; a sidebar page that is itself a form (mentorship registration) still uses the header. Health Metrics is the exception: its gate builds its own sticky header, because its design sets the title in Roboto Slab light at 24px over a 13px subtitle and pins the tab bar inside the header. The Me lens meetings redesign (`meetings-redesign`, behind `MEETINGS_REDESIGN_FLAG`) is the other: it hand-builds a sticky header with the same type spec, and its fade and tabs bar stick to the measured header height.

### Tab shells: signal state vs. child routes

Most tabbed pages hold the active tab in a signal and swap content with `@if` — `marketing-impact`, `campaigns`, `org-contributions` and `org-project-detail-tab-bar` all work this way. Prefer that: it is simpler, and a tab that is just a panel does not need a URL.

Reach for **child routes** only when each tab is a page in its own right — its own lazy chunk, its own title, and its own deep-link target. `foundation/health-metrics` is the one such shell today:

```typescript
// apps/lfx-one/src/app/app.routes.ts (excerpt)
{
  path: 'foundation/health-metrics',
  loadComponent: () => import('./modules/dashboards/health-metrics-gate/health-metrics-gate.component')...,
  children: [
    // No `redirectTo` on the empty child: `/foundation/health-metrics` must keep its exact URL,
    // because with the feature flag off the gate renders the legacy page and mounts no outlet.
    { path: '', pathMatch: 'full', loadComponent: ... },           // Overview
    { path: 'engagement', title: '...', loadComponent: ... },      // Engagement (Level 2)
    { path: 'events', title: '...', loadComponent: ... },          // Events (Level 2)
    { path: 'members', title: '...', loadComponent: ... },         // Members (Level 2)
    { path: 'non-members', title: '...', loadComponent: ... },     // Non-Members (Level 2)
    { path: 'training', title: '...', loadComponent: ... },        // Training (Level 2)
  ],
}
```

Two rules this shell establishes:

- **Chrome that outlives a tab switch is a component-provided service, never `providedIn: 'root'`.** `HealthMetricsChromeService` is listed in the gate's `providers`, so every child route inherits the same instance through the node injector — the selected period and the measured sticky-header height survive tab switches, and both reset when the user leaves the page. A root-provided service would leak that state across unrelated visits.
- **`routerLinkActive` needs `queryParams: 'ignored'`.** Tab links carry no query params while the URL always carries `foundationSlug`, so the default matching never marks a tab active. Pass an explicit `IsActiveMatchOptions`, using `paths: 'exact'` for the empty-path tab and `paths: 'subset'` for the rest.

A Level 2 tab composes `HealthMetricsL2ShellComponent` (`modules/dashboards/components/health-metrics-l2-shell/`) rather than re-implementing the layout. The tab passes its `sections`, `idPrefix`, `dataSections`, `subNavItems`, `blank`, `navLabel` and `testIdPrefix` — `sections` and `dataSections` are read once at init, while `subNavItems` stays reactive so badges update as counts arrive — projects each section body through an `<ng-template lfxHealthMetricsL2Section="key">`, and relays each body's `reading`/`settled` to the shell. The shell owns the sticky section nav (right of the sections, collapsing to a rail of ticks that opens as a floating panel once the gate's `hmpage` container is 1100px or narrower), the scroll-spy and fragment deep links, and the page itself scrolls the sections; a section with no projected body renders an anchored "Awaiting data" placeholder.

Each `settled` carries a verdict the tab relays as `sectionSettled(key, $event)`: `true` when the read found nothing for the period, `false` for data or a failed read, and `null` for no verdict (a closed period's forecast, a renewals window with none due). A section whose every read settled `true` shows the design's compact empty state in place of its body, controls and badge; once every data section has, the tab's `blank` card (`HEALTH_METRICS_<TAB>_BLANK`, through the shared `HealthMetricsBlankCardComponent`) replaces the sub-nav and sections. The bodies stay mounted but hidden, so a period with data brings them back. A section's verdict must not depend on its own filters or toggles, or its empty state would hide the control that switches back.

For the scroll-spy used inside a Level 2 page, five rules apply, each attributed to the component that established it:

- Observe heading **sentinels** rather than whole sections — two whole sections light at once mid-scroll (`account-settings.component.ts`).
- Keep an `intersecting` Set, so exactly one item is ever active (`account-settings.component.ts`).
- Give a short last section an end sentinel with a **non-zero height** (`account-settings.component.ts`), and observe it only once it starts below the first screen (`health-metrics-l2-shell.component.ts`). A zero-height sentinel never intersects; one in a non-scrolling area intersects immediately and lights the last item at rest.
- Register teardown once via `destroyRef.onDestroy`, **not** inside the setup function, which re-runs whenever the sticky offset changes (`health-metrics-l2-shell.component.ts`, whose observers are rebuilt as the sticky offset changes and the page starts or stops overflowing).
- Release a fragment deep link only once **every** async section that can change the page's height has settled (`health-metrics-l2-shell.component.ts`'s `dataSections` input, e.g. `HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS`). Clearing the pending key on the first section to report leaves a later section's reflow to push the anchor out of view unanswered. A section joins that list only once its component emits `reading`/`settled` and the tab relays both to the shell's `sectionReading`/`sectionSettled` — a listed section that never emits `settled` holds every deep link until the TTL. A key names a read, not necessarily an anchor: two reads under one anchor each get their own key (Members' `bridge` under `#tiers`, in `HEALTH_METRICS_MEMBERS_DATA_SECTIONS`), so the first to settle cannot release the link.

Each async section of a Level 2 page owns its own read, and every one of them faces the same
ordering problem: the foundation is not selected on the first pass. The rule the engagement sections
share is a **per-component `foundationSeen` latch** — a plain closure variable, not shared state —
set the first time a query carries a non-empty slug, with the response tap writing
`loading.set(!foundationSeen)` and gating its `settled` emission on the same flag:

- Before any foundation resolves, the skeleton holds. Clearing `loading` there would let the table
  caption an unread scope as a measured empty one, which is a different and much more confident
  claim than "still loading".
- That first empty-slug pass must **not** emit `settled`. It would drop every section out of the
  shell's wait set before a single read has run, releasing the pending fragment — and
  the shell's `sectionReading` cannot re-arm a key that is already cleared, so the deep link lands at the wrong
  offset once the real read reflows the page. A read that never gets a foundation is bounded by the
  pending-section TTL instead.
- A foundation **cleared after** a read still settles, because the latch stays set. Without it the
  section wedges on the skeleton forever, and — since the shell holds a fragment deep link until
  every listed section reports — it would also hold every deep link until the TTL.

Known limitation: once latched, a scope cleared after a read renders the _measured-empty_ card
rather than a neutral one. Distinguishing the third state ("no foundation selected") belongs to the
page-wide neutral state, not to four per-section copies of the same computed.

A Level 2 page scrolls the page itself, never an inner pane (`health-metrics-l2-shell.component.ts`). At the wide layout the sub-nav host is sticky 8px below `HealthMetricsChromeService.stickyTopPx`, and each section carries that offset as its `scroll-margin-top`, so `scrollIntoView({ block: 'start' })` lands a pick or a deep link below the sticky header. The spy observes the viewport with a band that is the top 30% of the viewport left below the header, set in pixels (`-<offset>px 0px -<bottom>px 0px`) and rebuilt when the viewport height changes — a percentage bottom margin is of the whole viewport and closes the band on a short window. Both sentinels are observed only while the end sentinel starts below the first screen (measured against the page, not the scroll), since a footer can make the page scroll while both sit in view; a start sentinel at the top of the column lights the first item when the reader jumps back to the top, since that jump never sweeps the first heading through the band. Because the page scrolls, the router's app-wide `scrollPositionRestoration: 'top'` would jump it up on every pill, search or page change, all of which write the query string. The shell puts the scroll position back after any navigation that changes only the query string, or restates the current URL (skipped, yet still scrolled), so a tab switch still lands at the top; a section jump made while that router scroll is still due is replayed after it. A section that starts a read keeps its height until every read rendering in it has painted (a read in a section keyed differently passes that section's key, as Members' bridge does inside `tiers`), so the loading state never shortens the page under the reader.

## 🎨 Component Development Pattern

### Template for New Wrapper Components

```typescript
@Component({
  selector: 'lfx-[component-name]',
  imports: [CommonModule, [PrimeNGModule]],
  templateUrl: './[component-name].component.html',
})
export class [ComponentName]Component {
  // Input signals for all PrimeNG properties
  public readonly [property] = input<[Type]>([defaultValue]);

  // Output signals for all PrimeNG events
  public readonly [event] = output<[EventType]>();

  // Template references for content projection
  @ContentChild('[templateName]', {
    static: false,
    descendants: false  // Critical for template scoping
  }) [templateName]Template?: TemplateRef<any>;

  // Event handlers
  protected handle[Event](event: [EventType]): void {
    this.[event].emit(event);
  }
}
```

### Template Projection Pattern

```html
<p-[component] [property]="property()" (event)="handleEvent($event)">
  <!-- For templates with context -->
  <ng-template #[templateName] let-[contextVar]="[contextVar]">
    <ng-container
      *ngTemplateOutlet="[templateName]Template || null; 
                         context: { $implicit: [contextVar] }">
    </ng-container>
  </ng-template>

  <!-- For templates without context -->
  <ng-template #[templateName] *ngIf="[templateName]Template">
    <ng-container *ngTemplateOutlet="[templateName]Template || null"></ng-container>
  </ng-template>

  <!-- For default content projection -->
  <ng-content></ng-content>
</p-[component]>
```

### Critical: Template Scoping with `descendants: false`

**Problem**: Angular's `@ContentChild` by default searches through all descendant elements, which can cause template conflicts when components are nested.

**Example of the Problem**:

```html
<lfx-card>
  <ng-template #header>Card Header</ng-template>
  <lfx-table>
    <ng-template #header>Table Header</ng-template>
    <!-- This conflicts! -->
  </lfx-table>
</lfx-card>
```

**Solution**: Always use `descendants: false` in all `@ContentChild` decorators:

```typescript
// ✅ Correct - only finds direct child templates
@ContentChild('header', { static: false, descendants: false }) headerTemplate?: TemplateRef<any>;

// ❌ Incorrect - searches all descendants, causing conflicts
@ContentChild('header', { static: false }) headerTemplate?: TemplateRef<any>;
```

This ensures:

- Each wrapper component only finds its own direct child templates
- Nested components don't interfere with parent templates
- Template scoping works as expected in complex component hierarchies

## 📚 Creating New Wrapper Components

### Research Phase

Before creating a wrapper, **always research the PrimeNG component thoroughly**:

1. **Study PrimeNG Documentation**: Visit the official PrimeNG documentation for the component
2. **Review Properties & Events**: Identify all available properties, events, and methods
3. **Identify Templates**: Check supported template options (`pTemplate` directives)
4. **Template Context**: Study what context data templates receive

### Implementation Steps

#### Step 1: Generate Component

```bash
# In the apps/lfx-one directory
ng generate component shared/components/[component-name] --skip-tests
```

> **Note**: The `--standalone` flag is no longer needed — Angular defaults components, directives, and pipes to standalone.

#### Step 2: Define Input/Output Signals

```typescript
// Required inputs
public readonly requiredProperty = input.required<string>();

// Optional inputs with defaults
public readonly optionalProperty = input<boolean>(false);
public readonly arrayProperty = input<Item[]>([]);

// Union type inputs with defaults
public readonly severity = input<'success' | 'info' | 'warning' | 'danger'>('info');

// Events should match PrimeNG event names exactly
public readonly onClick = output<MouseEvent>();
public readonly onSelectionChange = output<SelectionChangeEvent>();
```

#### Step 3: Add Template References

```typescript
// For each pTemplate supported by the PrimeNG component
// CRITICAL: Always use descendants: false
@ContentChild('header', { static: false, descendants: false }) headerTemplate?: TemplateRef<any>;
@ContentChild('body', { static: false, descendants: false }) bodyTemplate?: TemplateRef<any>;
@ContentChild('item', { static: false, descendants: false }) itemTemplate?: TemplateRef<any>;
```

#### Step 4: Implement Event Handlers

```typescript
protected handleClick(event: MouseEvent): void {
  this.onClick.emit(event);
}

protected handleSelectionChange(event: SelectionChangeEvent): void {
  this.onSelectionChange.emit(event);
}
```

#### Step 5: Create Template with Proper Context

```html
<p-[component] [property1]="property1()" [property2]="property2()" (onClick)="handleClick($event)" (onSelectionChange)="handleSelectionChange($event)">
  <!-- Template outlets for each supported template -->
  <ng-template #header *ngIf="headerTemplate">
    <ng-container *ngTemplateOutlet="headerTemplate"></ng-container>
  </ng-template>

  <ng-template #item let-item let-index="index">
    <ng-container *ngTemplateOutlet="itemTemplate || null; context: { $implicit: item, index: index }"> </ng-container>
  </ng-template>

  <!-- Default content projection -->
  <ng-content></ng-content>
</p-[component]>
```

### Common Template Types

- **Layout Templates**: `header`, `footer`, `title`, `subtitle`
- **Item Templates**: `item`, `option`, `selectedItem` (receive context data)
- **Content Templates**: `start`, `end`, `content`
- **State Templates**: `empty`, `loading`, `error`
- **Navigation Templates**: `paginatorleft`, `paginatorright`, `summary`

## 📝 Development Checklist

### Research & Planning

- [ ] **Research**: Check PrimeNG documentation for all properties, events, and templates
- [ ] **Dependencies**: Identify required PrimeNG modules and imports
- [ ] **Context**: Understand template context structure from PrimeNG source

### Component Implementation

- [ ] **Component Selector**: Use `lfx-` prefix (enforced by ESLint)
- [ ] **Standalone Component**: Import dependencies explicitly
- [ ] **Input Signals**: Use `input()` and `input.required()` for properties with proper types
- [ ] **Output Signals**: Use `output()` for events with correct event types
- [ ] **Template References**: Use `@ContentChild()` for all template references
- [ ] **Template Scoping**: **CRITICAL** - Always use `descendants: false` in `@ContentChild()`
- [ ] **Context**: Ensure template context matches PrimeNG's structure exactly
- [ ] **Fallbacks**: Use `|| null` for template outlets to handle undefined cases

### Code Quality

- [ ] **Type Safety**: Import and use interfaces from `@lfx-one/shared` package
- [ ] **Event Handling**: Proper event emission and parameter passing
- [ ] **Accessibility**: Include ARIA labels and roles where applicable
- [ ] **Nested Testing**: Test component works when nested with other wrappers
- [ ] **Build Verification**: Ensure build passes and no TypeScript errors
- [ ] **Documentation**: Update this documentation with usage examples

### Integration

- [ ] **Shared Interfaces**: Add any new interfaces to `@lfx-one/shared/interfaces`
- [ ] **Export Path**: Ensure component is exported correctly
- [ ] **Usage Guidelines**: Update project documentation
- [ ] **Component Hierarchy**: Verify component fits properly in app structure

## Component Hierarchy

```text
AppComponent
└── RouterOutlet
    └── MainLayoutComponent (authGuard protected, provides header + sidebar + content area)
        ├── /                    → DashboardComponent (role-based dashboard)
        ├── /projects            → HomeComponent (project listing)
        ├── /meetings            → MeetingsEntryComponent (lazy loaded; renders MeetingsDashboardComponent or, behind `meetings-redesign` in the Me lens, MeetingsRedesignComponent)
        ├── /groups              → CommitteeDashboardComponent (lazy loaded)
        ├── /mailing-lists       → MailingListDashboardComponent (lazy loaded)
        ├── /votes               → VotesDashboardComponent (lazy loaded)
        ├── /votes/:id           → VoteDetailComponent (vote detail page, keeps the current lens, in-place 404)
        ├── /surveys             → SurveysDashboardComponent (lazy loaded)
        ├── /settings            → redirects by lens (settingsLensRedirectGuard): Me → /profile/settings; foundation/project → lens-prefixed settings; other lenses (e.g. org) fall through to SettingsDashboardComponent
        └── /profile             → ProfileLayoutComponent (lazy loaded; tabs incl. settings → AccountSettingsComponent, transactions)

    Standalone routes (outside MainLayoutComponent):
    ├── /meetings/not-found      → MeetingNotFoundComponent
    └── /meetings/:id            → MeetingJoinComponent (public meeting join)
```

## 🎯 Usage Guidelines

1. **Always use LFX wrapper components** instead of PrimeNG directly (or a `lfx-ui-*` uikit component where one exists)
2. **Import wrapper components directly** - no barrel exports
3. **Follow the established patterns** for consistency
4. **Use shared interfaces** for type safety
5. **Support template projection** for flexibility
6. **Maintain accessibility** standards
7. **Test component isolation** and integration
8. **Follow module organization** - place components in section-specific folders when appropriate
9. **Minimize shared components** - only truly cross-cutting components belong in shared/components
