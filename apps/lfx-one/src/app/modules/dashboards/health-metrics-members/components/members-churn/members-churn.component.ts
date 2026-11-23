// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  getYearForRange,
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_DEFAULT_SORT,
  HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_SORT_COLUMNS,
  HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED,
  HEALTH_METRICS_MEMBERS_CHURN_SECTION_OPTIONS,
  HEALTH_METRICS_MEMBERS_CHURN_TIER_DEFAULT_SORT,
  HEALTH_METRICS_MEMBERS_CHURN_TIER_SORT_COLUMNS,
  HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersChurnDepartureRows,
  buildHealthMetricsMembersChurnView,
  healthMetricsRowSortValue,
  sortHealthMetricsRows,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsBarChartComponent } from '../../../components/health-metrics-bar-chart/health-metrics-bar-chart.component';
import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDepartureRowView,
  HealthMetricsMembersChurnDepartures,
  HealthMetricsMembersChurnDeparturesQuery,
  HealthMetricsMembersChurnSection,
  HealthMetricsMembersChurnTierRowView,
  HealthMetricsMembersChurnView,
} from '@lfx-one/shared/interfaces';

/**
 * `#churn` — the selected year's revenue churn, logo churn and dues lost, over one of the members lost, the loss by tier
 * or the trend. Every year is read once and re-projected per period; Members lost pages and sorts server-side.
 */
@Component({
  selector: 'lfx-members-churn',
  imports: [
    EmptyStateComponent,
    HealthMetricsBarChartComponent,
    HealthMetricsCellComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsThComponent,
    Skeleton,
    TableComponent,
    UiBadgeComponent,
    UiPaginationComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './members-churn.component.html',
})
export class MembersChurnComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly sectionOptions = HEALTH_METRICS_MEMBERS_CHURN_SECTION_OPTIONS;
  protected readonly size = HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a year without churn, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly departuresLoading = signal<boolean>(true);
  protected readonly departuresFailed = signal<boolean>(false);
  protected readonly section = signal<HealthMetricsMembersChurnSection>(this.parseInitialSection());
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

  /** Members lost sorts on the server across every page; the default keeps the view's rank. */
  protected readonly departuresSorting = injectHealthMetricsTableSort(
    HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_SORT_COLUMNS,
    HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_DEFAULT_SORT
  );
  /** By tier is not paged, so it sorts in the browser. */
  protected readonly tierSorting = injectHealthMetricsTableSort(HEALTH_METRICS_MEMBERS_CHURN_TIER_SORT_COLUMNS, HEALTH_METRICS_MEMBERS_CHURN_TIER_DEFAULT_SORT);
  /** Zero-based, as the pager counts. A new foundation, year or order restarts paging, since its departures share nothing with the last. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.foundationSlug()}|${this.year()}|${JSON.stringify(this.departuresSorting.sort())}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 0),
  });

  protected readonly response: Signal<HealthMetricsMembersChurn> = this.initResponse();
  protected readonly departuresQuery: Signal<HealthMetricsMembersChurnDeparturesQuery> = computed(() => ({
    foundationSlug: this.foundationSlug(),
    year: this.year(),
    offset: this.page() * this.size,
    pageSize: this.size,
    sort: this.departuresSorting.order(),
  }));
  protected readonly departures: Signal<HealthMetricsMembersChurnDepartures> = this.initDepartures();

  protected readonly view: Signal<HealthMetricsMembersChurnView> = computed(() => buildHealthMetricsMembersChurnView(this.response(), this.range()));
  /**
   * The period was never measured; the shell shows the section's empty state instead, even when its Members lost read
   * failed, since that list has nothing to show for it. A year that lost nothing reads "0%".
   */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && !this.view().yearMeasured);
  protected readonly departureRows: Signal<HealthMetricsMembersChurnDepartureRowView[]> = computed(() =>
    buildHealthMetricsMembersChurnDepartureRows(this.departures().rows)
  );
  protected readonly tierRows: Signal<HealthMetricsMembersChurnTierRowView[]> = computed(() =>
    sortHealthMetricsRows(this.view().tiers, this.tierSorting.order(), healthMetricsRowSortValue)
  );
  protected readonly totalRecords = computed(() => this.departures().totalRecords);
  /** Holds the skeleton until a foundation's first read lands; a period change re-projects in place. */
  protected readonly firstRead = computed(
    () => this.loading() && (this.response() === HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED || this.responseFoundation() !== this.foundationSlug())
  );
  /** Two years with either rate make a trend; one bar alone is no line. */
  protected readonly showTrend = computed(() => this.view().trend.filter((point) => point.value !== null || point.logoValue !== null).length > 1);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(computed(() => ({ section: this.section(), page: this.page() })))
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.section === b.section && a.page === b.page),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  protected onSectionChange(value: string | null): void {
    this.section.set(this.toSection(value));
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
            tap((response) => {
              this.responseFoundation.set(foundationSlug);
              this.loading.set(!foundationSeen);
              this.churnPending = false;
              this.settle(foundationSeen, response);
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

  /**
   * Held until a foundation is seen and both reads land, so an unread section cannot release the shell's deep link.
   * The churn read passes its own response, which its signal does not carry yet.
   */
  private settle(foundationSeen: boolean, churn: HealthMetricsMembersChurn = this.response()): void {
    if (!foundationSeen || this.churnPending || this.departuresPending) return;

    // A failed churn read keeps its error on screen, so it never settles empty; a failed Members lost read only shows under its view.
    this.settled.emit(!this.loadFailed() && !buildHealthMetricsMembersChurnView(churn, this.range()).yearMeasured);
  }

  private syncUrl(): void {
    const page = this.page();
    const section = this.section();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnView]: section === HEALTH_METRICS_MEMBERS_CHURN_SECTION_OPTIONS[0].id ? null : section,
        // The URL counts pages from 1.
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnPage]: page > 0 ? page + 1 : null,
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
    const lastPage = Math.max(0, Math.ceil(response.totalRecords / this.size) - 1);
    // The sentinel's zero is no count, so a failed read keeps the page; an empty year moves to the first page.
    if (response === HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialSection(): HealthMetricsMembersChurnSection {
    return this.toSection(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnView));
  }

  private toSection(value: string | null): HealthMetricsMembersChurnSection {
    return HEALTH_METRICS_MEMBERS_CHURN_SECTION_OPTIONS.find((option) => option.id === value)?.id ?? HEALTH_METRICS_MEMBERS_CHURN_SECTION_OPTIONS[0].id;
  }

  /** The URL's 1-based page as the pager's 0-based one. */
  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.churnPage));
    return Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0;
  }
}
