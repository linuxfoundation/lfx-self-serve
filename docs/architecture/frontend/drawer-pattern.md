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

```html
<p-drawer
  [(visible)]="visible"
  position="right"
  [modal]="true"
  [showCloseIcon]="false"
  styleClass="xl:w-[45%] lg:w-[55%] md:w-[70%] sm:w-[90%] w-full"
  data-testid="my-drawer">
  <!-- Header -->
  <ng-template #header>
    <div class="flex items-start justify-between gap-4 w-full">
      <div class="flex flex-col gap-1 flex-1">
        <h2 class="text-lg font-semibold text-gray-900">Drawer Title</h2>
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

1. Private injections (`inject()`)
2. Model signals (`model<boolean>(false)`)
3. Inputs (`input<T>()`)
4. WritableSignals (`signal()`)
5. Chart options (static `protected readonly` objects)
6. Computed signals and data loading signals
7. Protected methods (`onClose()`)
8. Private initializer functions (`initDrawerData()`, `initChartData()`)

## Common Utilities

- `hexToRgba(color, alpha)` — Converts hex colors to RGBA for chart transparency
- `wrapLabel(text, maxLength)` — Wraps long labels for chart axes
- `lfxColors` — Color palette from `@lfx-one/shared/constants`

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
