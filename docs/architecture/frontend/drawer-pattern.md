<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Drawer Component Pattern

## Overview

Drawer components provide detail panels that slide in from the right side of the screen. They are used extensively in the dashboards module for drill-down views that display charts, lists, and summary data.

All drawer components follow a consistent pattern built on PrimeNG's `p-drawer` with Angular signals for state management.

## Visibility Management

Drawers use `model<boolean>(false)` for two-way binding with the parent component:

```typescript
// In the drawer component
public readonly visible = model<boolean>(false);

// In the parent template
<lfx-my-drawer [(visible)]="drawerVisible"></lfx-my-drawer>
```

The `model()` approach is preferred over split `[visible]` + `(visibleChange)` bindings. It provides cleaner syntax and aligns with Angular 20's recommended patterns.

### Close Handler

```typescript
protected onClose(): void {
  this.visible.set(false);
}
```

## Modal Semantics and Focus Management

PrimeNG's `p-drawer` (the `^20.4.0` range this repo depends on, resolved to `20.4.0` at the time
of writing) doesn't give a modal drawer real dialog semantics or focus management on its own:
its container hardcodes `role="complementary"` (not bound to any input, so `[modal]="true"`
doesn't change it), it never emits `aria-modal` under any configuration, and while it does apply
`pFocusTrap` unconditionally (so Tab/Shift+Tab already cycles once focus is inside), it never
moves focus into the panel on open or restores it on close.

Every drawer that opens over page content — not just ones with forms — needs this wired
explicitly going forward (GH-2620). **This is not yet true of the rest of the codebase**: as of
this writing, only this drawer and `group-seat-holders-drawer` apply it, out of roughly 60
`p-drawer` templates. GH-2620's own scope was this one drawer; sweeping the rest is a follow-up,
not something this section's existence implies is already done.

```typescript
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ElementRef, inject, PLATFORM_ID, viewChild } from '@angular/core';
import { filter } from 'rxjs';

private readonly platformId = inject(PLATFORM_ID);
private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');
private previouslyFocusedElement: HTMLElement | null = null;

public constructor() {
  // Restores focus whenever `visible` goes false — reacts to the signal itself (via
  // toObservable, not effect() — see the Component Structure Order note below), not PrimeNG's
  // `(onHide)` output. Traced against the pinned Drawer source: `onHide` only fires when
  // something calls Drawer's own close() (its built-in close button, the Escape
  // document-listener, or a dismissible mask-click) — flipping `visible` from outside (a
  // hand-rolled close button, or a host-driven close after a successful write) never reaches
  // it, since the animation-end cleanup that runs for every other case calls `hide(false)`,
  // which explicitly suppresses that emit.
  toObservable(this.visible)
    .pipe(
      filter((visible) => !visible),
      takeUntilDestroyed()
    )
    .subscribe(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      if (this.previouslyFocusedElement?.isConnected) {
        this.previouslyFocusedElement.focus();
      }
      this.previouslyFocusedElement = null;
    });
}

// Bind (onShow) on <p-drawer> to this — it needs the panel's real DOM to exist first (so
// `titleRef()` resolves), which the constructor subscription above isn't guaranteed to have on
// the same tick `visible` flips true.
protected onDrawerShow(): void {
  if (!isPlatformBrowser(this.platformId)) return;
  this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  this.titleRef()?.nativeElement.focus();
}
```

```html
<p-drawer
  [(visible)]="visible"
  [modal]="true"
  [pt]="{
    root: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'my-drawer-title',
    },
  }"
  (onShow)="onDrawerShow()"
  ...>
  <ng-template #header>
    <h2 #titleRef id="my-drawer-title" tabindex="-1" data-testid="my-drawer-title">{{ drawerHeading() }}</h2>
    ...
  </ng-template>
  ...
</p-drawer>
```

- **`pt.root`**: Drawer has no `role`/`ariaLabel`/`ariaLabelledBy` inputs — this is PrimeNG's
  pass-through escape hatch, the only way to override the hardcoded `role` and add `aria-modal`.
- **Prefer `aria-labelledby` over a duplicated `aria-label`** when the title is already visible
  text in the header — point it at that heading instead of restating the string.
- **The heading needs `tabindex="-1"`, an `id` (the `aria-labelledby` target), and a
  `data-testid`** (query specs by testid, not the CSS id — the id stays reserved for the ARIA
  wiring). `-1` keeps it out of the natural Tab order; it's reachable only via `onDrawerShow()`.
- **The heading's text must never render empty, including through the close animation.** If it's driven by loaded data (`item()?.title` or similar), `onDrawerShow()` can focus it before that data arrives — fall back to a loading/error string. A naive `item()?.title ?? (visible() ? loadingOrErrorString : '')` still announces an unnamed dialog for the ~150ms the panel stays mounted after closing (that data resets to `null` on close too) — carry the last non-empty value forward instead of falling back to `''`, via a `scan` accumulator that only updates on a real title or while `visible()`, and otherwise returns its own previous value unchanged. Combine the dependent signals into **one** plain `computed()` first, then cross into RxJS with a single `toObservable()` over that — feeding several independently-constructed `toObservable()` sources into `combineLatest` risks each settling on its own schedule when one of them (here, `item()`, via the drawer's own data-loading pipeline) transitively depends on another (`visible()`), so `combineLatest` can combine a stale tuple. Seed the `scan` and `toSignal` both with a non-empty value too, not `''` — `toObservable()` emits through an internal `effect()`, which Angular never runs synchronously at creation, so there's a real window right after `visible()` flips true where this signal hasn't caught up yet (Copilot review, PR #2636):

  ```typescript
  const state = computed(() => ({ title: this.item()?.title, visible: this.visible(), loadFailed: this.loadFailed() }));
  toSignal(
    toObservable(state).pipe(
      scan((last, { title, visible, loadFailed }) => {
        if (title) return title;
        if (visible) return loadFailed ? 'Unable to load item' : 'Loading item…';
        return last;
      }, 'Loading item…')
    ),
    { initialValue: 'Loading item…' }
  );
  ```

- **Focus target**: the title heading, not the close button or the first form field — landing on
  a form field drops a screen-reader user mid-form with no context; the title is already the
  `aria-labelledby` target, so focusing it announces the heading immediately.
- **Prefer watching `visible()` itself over `(onHide)` for focus-restore** — see the code comment
  above for why `(onHide)` misses a hand-rolled close button and any host-driven close.
  `group-seat-holders-drawer` restores via `(onHide)` instead and is not non-conformant for it:
  it uses PrimeNG's _built-in_ close button, for which `(onHide)` is reliable, and has no
  host-driven close path of its own. `(onHide)` is a narrower approach that happens to be safe
  for that drawer's specific close paths, not a broken one — but it doesn't generalize, so a new
  drawer (or one gaining a hand-rolled close button or an external close later) should default to
  watching `visible()`.
- **Esc-to-close and Tab-trapping need no code here** — `closeOnEscape` defaults `true`
  (independent of `modal`/`dismissible`) and `pFocusTrap` is unconditional on the container.

## Lazy Data Loading

Drawers load data only when opened, not on component initialization. This is achieved by converting the `visible` model signal to an observable and reacting to changes:

```typescript
private readonly drawerLoading = signal(false);

private initDrawerData(): Signal<DrawerData> {
  const defaultValue = { monthly: DEFAULT_MONTHLY, distribution: DEFAULT_DISTRIBUTION };

  return toSignal(
    toObservable(this.visible).pipe(
      skip(1), // Skip the initial false value
      switchMap((isVisible) => {
        if (!isVisible) {
          this.drawerLoading.set(false);
          return of(defaultValue);
        }

        this.drawerLoading.set(true);
        const accountId = this.accountContextService.selectedAccount().accountId;

        if (!accountId) {
          this.drawerLoading.set(false);
          return of(defaultValue);
        }

        return this.analyticsService.getData(accountId).pipe(
          tap(() => this.drawerLoading.set(false)),
          catchError(() => {
            this.drawerLoading.set(false);
            return of(defaultValue);
          })
        );
      })
    ),
    { initialValue: defaultValue }
  );
}
```

**Key details:**

- `skip(1)` prevents an API call on component initialization (skips the initial `false`)
- `switchMap` cancels in-flight requests if the drawer opens/closes rapidly
- Error handling returns sensible defaults rather than throwing
- A `WritableSignal<boolean>` tracks loading state

## Parallel API Calls with forkJoin

When a drawer needs data from multiple endpoints, use `forkJoin` inside the `switchMap`:

```typescript
return forkJoin({
  monthly: this.analyticsService.getMonthlyData(accountId, slug),
  distribution: this.analyticsService.getDistribution(accountId, slug),
  keyMembers: this.analyticsService.getKeyMembers(accountId, slug),
}).pipe(
  tap(() => this.drawerLoading.set(false)),
  catchError(() => {
    this.drawerLoading.set(false);
    return of(defaultValue);
  })
);
```

All requests execute in parallel. A single `catchError` handles failure from any request.

## Chart Integration

Chart data is derived from the loaded data using computed signals:

```typescript
// Extract specific data from the combined response
protected readonly monthlyData = computed(() => this.drawerData().monthly);
protected readonly hasData = computed(() => this.monthlyData().data.length > 0);

// Transform into Chart.js format
protected readonly chartData: Signal<ChartData<'line'>> = this.initChartData();

private initChartData(): Signal<ChartData<'line'>> {
  return computed(() => {
    const { monthlyData, monthlyLabels } = this.monthlyData();
    return {
      labels: monthlyLabels,
      datasets: [
        {
          data: monthlyData,
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[400], 0.2),
          fill: true,
        },
      ],
    };
  });
}
```

Chart options are static objects (not signals) defined as `protected readonly` class properties.

## Input-Based Drawers

Some drawers receive data via inputs rather than fetching it. These skip the lazy loading pattern:

```typescript
export class OrgDependencyDrawerComponent {
  public readonly visible = model<boolean>(false);
  public readonly summaryData = input<BusFactorResponse>(DEFAULT_VALUE);

  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { topCompaniesCount, topCompaniesPercentage } = this.summaryData();
      return {
        labels: [`${topCompaniesCount} Orgs (${topCompaniesPercentage}%)`],
        datasets: [{ data: [topCompaniesPercentage], backgroundColor: lfxColors.blue[500] }],
      };
    });
  }
}
```

## Template Structure

### Standard Layout

Modal semantics and focus management (below) are part of this standard layout, not an optional
add-on — `[pt]="drawerPt"` and `(onShow)="onDrawerShow()"` on `<p-drawer>`, and `#titleRef`/`id`/
`tabindex="-1"`/`data-testid` plus `{{ drawerHeading() }}` on the heading, all belong in every new
drawer from the start. See "Modal Semantics and Focus Management" above for what each piece is for
and the `drawerPt`/`onDrawerShow()`/`drawerHeading()` implementations this example assumes.

```html
<p-drawer
  [(visible)]="visible"
  position="right"
  [modal]="true"
  [showCloseIcon]="false"
  [pt]="drawerPt"
  (onShow)="onDrawerShow()"
  styleClass="xl:w-[45%] lg:w-[55%] md:w-[70%] sm:w-[90%] w-full"
  data-testid="my-drawer">
  <!-- Header -->
  <ng-template #header>
    <div class="flex items-start justify-between gap-4 w-full">
      <div class="flex flex-col gap-1 flex-1">
        <h2 #titleRef id="my-drawer-title" tabindex="-1" class="text-lg font-semibold text-gray-900" data-testid="my-drawer-title">{{ drawerHeading() }}</h2>
        <p class="text-sm text-gray-500">Subtitle text</p>
      </div>
      <button
        type="button"
        (click)="onClose()"
        class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors flex-shrink-0"
        aria-label="Close panel">
        <i class="fa-light fa-xmark text-xl"></i>
      </button>
    </div>
  </ng-template>

  <!-- Content Sections -->
  <div class="flex flex-col gap-6 pb-2">
    <!-- Section with chart -->
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h3 class="text-sm font-medium text-gray-900">Section Title</h3>
        <p class="text-xs text-gray-500">Description</p>
      </div>

      @if (drawerLoading()) {
      <div class="flex items-center justify-center py-12">
        <i class="fa-light fa-spinner-third fa-spin text-2xl text-gray-400"></i>
      </div>
      } @else if (hasData()) {
      <div class="h-[240px]">
        <lfx-chart type="line" [data]="chartData()" [options]="chartOptions" height="100%"> </lfx-chart>
      </div>
      } @else {
      <div class="text-center py-8 border border-slate-200 rounded-lg">
        <i class="fa-light fa-eyes text-3xl text-gray-400 mb-2 block"></i>
        <p class="text-sm text-gray-500">No data available</p>
      </div>
      }
    </div>

    <!-- Insights Handoff Footer -->
    <lfx-insights-handoff-section
      title="Looking for detailed metrics?"
      description="Detailed breakdowns available in the Organization Dashboard."
      link="https://insights.linuxfoundation.org"
      buttonLabel="View Organization Dashboard">
    </lfx-insights-handoff-section>
  </div>
</p-drawer>
```

### Key Template Conventions

- **Responsive width**: `xl:w-[45%] lg:w-[55%] md:w-[70%] sm:w-[90%] w-full`
- **Header**: Uses `ng-template #header` for PrimeNG drawer customization
- **Content spacing**: `flex flex-col gap-6` between sections
- **Loading spinner**: `fa-light fa-spinner-third fa-spin`
- **Empty state**: Icon + descriptive text in a bordered container
- **Test IDs**: `data-testid` on the drawer and key sections
- **Modal semantics and focus**: `role="dialog"`/`aria-modal`/`aria-labelledby` via `[pt].root`,
  and focus-in/focus-restore — see Modal Semantics and Focus Management, above; PrimeNG's Drawer
  provides none of this on its own

## List Display

For member lists or item lists inside drawers, use `@for` with track:

```html
@for (member of keyMembersData().members; track member.userId; let last = $last) {
<div
  class="flex items-center justify-between gap-3 px-4 py-3"
  [class.border-b]="!last"
  [class.border-slate-200]="!last"
  [attr.data-testid]="'drawer-member-' + member.userId">
  <!-- Content -->
</div>
}
```

Use `let last = $last` to conditionally render borders between items.

## Component Structure Order

Drawer components follow the standard component organization:

1. Private injections (`inject()`), including `PLATFORM_ID` if the drawer wires focus management
2. Model signals (`model<boolean>(false)`)
3. Inputs (`input<T>()`)
4. WritableSignals (`signal()`) — plus, separately, any private non-signal fields the drawer
   needs (`titleRef` via `viewChild()`, `previouslyFocusedElement`, a static `pt`-passthrough
   object like `drawerPt`): these aren't signals and don't belong in this bullet's own category,
   they just have nowhere else to go before the constructor needs them
5. Chart options (static `protected readonly` objects)
6. Computed signals and data loading signals
7. Constructor (the focus-restore `toObservable()` subscription from Modal Semantics and Focus
   Management, above; new constructor logic should reach for `toObservable()` first —
   `docs/reviews/frontend-checklist.md` §5 disfavors `effect()` outside logging/debugging, and the
   form-state `effect()` still present in `formation-item-drawer.component.ts` is a violation to
   migrate, not a pattern to copy — it was added five months after §5 landed, not before it)
8. Protected methods (`onClose()`, `onDrawerShow()`)
9. Private initializer functions (`initDrawerData()`, `initChartData()`)

## Opening a Drawer From a Query Param

Two shapes exist for landing a user inside a drawer from a URL:

- **URL-synced** — the drawer's open/closed state mirrors a query param for as long as it is open, and closing it clears the param. `my-newsletters` does this with `?issue=` (see its `onDrawerVisibleChange`). Use it when the drawer is a destination worth bookmarking or sharing.
- **Consumed once** — the param is a one-shot instruction: open this thing on arrival, then forget it. `FormationChecklistSectionComponent` does this with `?item=<template_item_key>` (`FORMATION_ITEM_QUERY_PARAM`), which the Me-lens pending-action row and the formation-service item-assigned email link to (#2727, #2732, #2573, #2616). Use it when the drawer is one of many over a shared surface and a stale URL would misrepresent the page.

The consumed-once shape has four rules, all in `formation-checklist-section.component.ts`'s `initDeepLink`:

1. **Browser only.** Guard with `isPlatformBrowser`; the server render never opens a modal or rewrites the URL (a server-side `router.navigate` risks an NG0500 hydration mismatch).
2. **Read once, at mount.** The value is navigation intent, not reactive state: read it from the route snapshot in the constructor. A fresh navigation to the page creates a fresh component and a fresh read.
3. **Wait for the first terminal state, then strip in place.** Act on the first `ready` / `no-template` / `no-items` state, then `router.navigate([], { queryParams: { <param>: null }, queryParamsHandling: 'merge', replaceUrl: true })`. Once-only becomes structural: a refresh, Back or a post-mutation reload cannot re-trigger it, and the URL never claims something is open when it isn't. The `error` state is deliberately not terminal, so an in-page Retry can still honour the link.
4. **Fail quietly, never echo.** An unknown value (a stale link) opens nothing and is still stripped; the caller-controlled text is never rendered or logged.

## Insights Handoff & Deep-Linking

Several analytics drawers expose an "Open in LFX Insights" CTA that links out to the Insights app with the current foundation or project pre-selected. The URL is **lens-aware** — it resolves to a collection page in Foundation lens and a project page in Project lens. This branching lives in one helper so every drawer handoff stays consistent.

### `buildLensAwareInsightsUrl` (`packages/shared/src/utils/insights.utils.ts`)

```typescript
buildLensAwareInsightsUrl(
  slug: string | null | undefined,
  isFoundationContext: boolean,
  opts?: { projectSubPath?: string; projectParams?: Record<string, string | undefined> }
): string
```

- Foundation context → `/collection/details/{slug}`
- Project context → `/project/{slug}[/{projectSubPath}][?projectParams]`
- Missing slug → falls back to the Insights root so the CTA never renders as broken.

Widget-specific params (`contributors-leaderboard`, `organization-dependency`, etc.) are passed via `projectParams` — the underlying `buildInsightsUrl(path, params?)` helper URL-encodes path segments and filters undefined/empty params.

### Pattern in a drawer component

```typescript
// apps/lfx-one/src/app/modules/dashboards/components/active-contributors-drawer/active-contributors-drawer.component.ts (sketch)
private readonly projectContextService = inject(ProjectContextService);

protected readonly insightsUrl: Signal<string> = computed(() =>
  buildLensAwareInsightsUrl(
    this.projectContextService.activeContext()?.slug,
    this.projectContextService.isFoundationContext(),
    {
      projectSubPath: 'contributors',
      projectParams: { timeRange: 'alltime', widget: 'contributors-leaderboard' },
    }
  )
);
```

The template wires the signal into the handoff component:

```html
<lfx-insights-handoff-section [link]="insightsUrl()" />
```

Because `insightsUrl` is a computed signal, the URL re-evaluates automatically when the user switches lens or selects a different foundation/project. Centralizing the foundation-vs-project branching means drawers don't re-implement URL logic and stay in sync if the Insights URL map ever changes.

## Common Utilities

- `hexToRgba(color, alpha)` — Converts hex colors to RGBA for chart transparency
- `wrapLabel(text, maxLength)` — Wraps long labels for chart axes
- `lfxColors` — Color palette from `@lfx-one/shared/constants`
- `buildInsightsUrl(path, params?)` / `buildLensAwareInsightsUrl(slug, isFoundationContext, opts?)` — Insights handoff URL builders

## RxJS Operators Used

| Operator         | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `toObservable()` | Convert signal to observable for reactive pipeline   |
| `toSignal()`     | Convert observable back to signal with initial value |
| `skip(1)`        | Skip initial emission to prevent load on init        |
| `switchMap()`    | Cancel previous request on new trigger               |
| `forkJoin()`     | Execute parallel requests                            |
| `tap()`          | Side effects (update loading state)                  |
| `catchError()`   | Return defaults on error                             |
| `of()`           | Emit default/fallback values                         |
