// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import {
  getYearForRange,
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED,
  HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS,
  HEALTH_METRICS_MEMBERS_CHURN_SHARE_BAR_CLASS,
  HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  lfxColors,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersChurnDepartureRows,
  buildHealthMetricsMembersChurnDeparturesSubtitle,
  buildHealthMetricsMembersChurnView,
  buildHealthMetricsMembersMovementCountNote,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsL2Range,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDepartureRowView,
  HealthMetricsMembersChurnDepartures,
  HealthMetricsMembersChurnDeparturesQuery,
  HealthMetricsMembersChurnMode,
  HealthMetricsMembersChurnTrendPointView,
  HealthMetricsMembersChurnView,
} from '@lfx-one/shared/interfaces';
import type { TablePageEvent } from 'primeng/table';

/**
 * `#churn` — the selected year's revenue or logo churn, who left, where the loss sits by tier and the
 * churn trend. Every year is read once and re-projected per period; "Who left" pages server-side.
 */
@Component({
  selector: 'lfx-members-churn',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './members-churn.component.html',
})
export class MembersChurnComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once both reads settle — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly modeOptions: FilterPillOption[] = [...HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS];
  protected readonly tierPillClass = HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS;
  protected readonly shareBarClass = HEALTH_METRICS_MEMBERS_CHURN_SHARE_BAR_CLASS;
  protected readonly size = HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a year without churn, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly departuresLoading = signal<boolean>(true);
  protected readonly departuresFailed = signal<boolean>(false);
  protected readonly mode = signal<HealthMetricsMembersChurnMode>(this.parseInitialMode());
  /** The foundation the shown churn belongs to, so a new foundation holds the skeleton. */
  private readonly responseFoundation = signal<string | null>(null);
  // Both start pending so the first read to land cannot settle the section before the other starts.
  private churnPending = true;
  private departuresPending = true;

  private readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  private readonly range = computed<HealthMetricsL2Range>(() => {
    const range = this.chrome.selectedRange();
    // The views carry the four Level 2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  });
  private readonly year = computed(() => getYearForRange(this.range()));
  private readonly departuresScope = computed(() => `${this.foundationSlug()}|${this.year()}`);

  /** A new foundation or year restarts paging, since its departures share nothing with the last. */
  protected readonly page = linkedSignal<string, number>({
    source: this.departuresScope,
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly response: Signal<HealthMetricsMembersChurn> = this.initResponse();
  protected readonly departuresQuery: Signal<HealthMetricsMembersChurnDeparturesQuery> = computed(() => ({
    foundationSlug: this.foundationSlug(),
    year: this.year(),
    offset: (this.page() - 1) * this.size,
    pageSize: this.size,
  }));
  protected readonly departures: Signal<HealthMetricsMembersChurnDepartures> = this.initDepartures();

  protected readonly view: Signal<HealthMetricsMembersChurnView> = computed(() =>
    buildHealthMetricsMembersChurnView(this.response(), this.range(), this.mode())
  );
  protected readonly departureRows: Signal<HealthMetricsMembersChurnDepartureRowView[]> = computed(() =>
    buildHealthMetricsMembersChurnDepartureRows(this.departures().rows)
  );
  protected readonly totalRecords = computed(() => this.departures().totalRecords);
  protected readonly departuresSubtitle = computed(() => buildHealthMetricsMembersChurnDeparturesSubtitle(this.totalRecords(), this.view().lostCount));
  protected readonly countNote = computed(() =>
    this.departuresLoading() || this.departuresFailed() ? null : buildHealthMetricsMembersMovementCountNote(this.totalRecords(), this.view().lostCount)
  );
  protected readonly first = computed(() => (this.page() - 1) * this.size);
  /** Holds the skeleton until a foundation's first read lands; a period or mode change re-projects in place. */
  protected readonly firstRead = computed(
    () => this.loading() && (this.response() === HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED || this.responseFoundation() !== this.foundationSlug())
  );
  protected readonly trend: Signal<HealthMetricsMembersChurnTrendPointView[]> = computed(() => this.view().trend);
  protected readonly showTrend = computed(() => this.trend().filter((point) => point.value !== null).length > 1);
  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => this.buildChart(this.trend(), this.view().trendRose));
  protected readonly chartLabel = computed(
    () => `${this.view().trendTitle} over ${this.trend().length} years, oldest first. The following table lists the same values.`
  );
  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (item) => this.trend()[item.dataIndex]?.valueLabel ?? '',
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        beginAtZero: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 }, callback: (value) => `${value}%` },
      },
    },
  };

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(computed(() => ({ mode: this.mode(), page: this.page() })))
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.mode === b.mode && a.page === b.page),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  protected onModeChange(id: string): void {
    const mode = HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS.find((candidate) => candidate.id === id)?.id;
    if (mode) this.mode.set(mode);
  }

  protected onTablePage(event: TablePageEvent): void {
    this.page.set(Math.floor((event.first ?? 0) / this.size) + 1);
  }

  private initResponse(): Signal<HealthMetricsMembersChurn> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.foundationSlug).pipe(
        distinctUntilChanged(),
        tap((foundationSlug) => {
          foundationSeen = foundationSeen || foundationSlug !== '';
          this.churnPending = true;
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((foundationSlug) =>
          (foundationSlug ? this.analyticsService.getMembersChurn(foundationSlug) : of(HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED);
            }),
            tap(() => {
              this.responseFoundation.set(foundationSlug);
              this.loading.set(!foundationSeen);
              this.churnPending = false;
              this.settle(foundationSeen);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED }
    );
  }

  private initDepartures(): Signal<HealthMetricsMembersChurnDepartures> {
    if (!isPlatformBrowser(this.platformId)) {
      return computed(() => HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED);
    }

    let foundationSeen = false;

    return toSignal(
      toObservable(this.departuresQuery).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.departuresPending = true;
          this.departuresLoading.set(true);
          this.departuresFailed.set(false);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersChurnDepartures(query) : of(HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED)).pipe(
            catchError(() => {
              this.departuresFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one neither settles nor ends the loading state.
              if (this.clampPage(response)) return;

              this.departuresLoading.set(!foundationSeen);
              this.departuresPending = false;
              this.settle(foundationSeen);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED }
    );
  }

  /** Held until a foundation is seen and both reads land, so an unread section cannot release the shell's deep link. */
  private settle(foundationSeen: boolean): void {
    if (foundationSeen && !this.churnPending && !this.departuresPending) this.settled.emit();
  }

  /** Earlier years pale, the selected one solid — red when its churn rose on the year before. */
  private buildChart(points: HealthMetricsMembersChurnTrendPointView[], rose: boolean): ChartData<'bar'> {
    const selectedColor = rose ? lfxColors.red[600] : lfxColors.blue[600];
    return {
      labels: points.map((point) => point.label),
      datasets: [
        {
          label: this.view().trendTitle,
          data: points.map((point) => point.value),
          backgroundColor: points.map((point) => (point.isSelected ? selectedColor : lfxColors.blue[200])),
          borderRadius: 2,
          maxBarThickness: 52,
        },
      ],
    } as ChartData<'bar'>;
  }

  private syncUrl(): void {
    const page = this.page();
    const mode = this.mode();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnMode]: mode === HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS[0].id ? null : mode,
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnPage]: page > 1 ? page : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?churnPage=` past the end selects no rows while the count still reports the real total. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(response: HealthMetricsMembersChurnDepartures): boolean {
    const lastPage = Math.max(1, Math.ceil(response.totalRecords / this.size));
    // The sentinel's zero is no count, so a failed read keeps the page; an empty year moves to page 1.
    if (response === HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialMode(): HealthMetricsMembersChurnMode {
    const value = this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnMode);
    return HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS.find((candidate) => candidate.id === value)?.id ?? HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS[0].id;
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }
}
