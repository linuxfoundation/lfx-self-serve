// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_DEFAULT_SORT,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_SORT_COLUMNS,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEngagementNewsletterChart,
  buildHealthMetricsEngagementNewsletterView,
  healthMetricsRowSortValue,
  sortHealthMetricsRows,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsLineChartComponent } from '../../../components/health-metrics-line-chart/health-metrics-line-chart.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementNewsletterChartView,
  HealthMetricsEngagementNewsletterMode,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterPointView,
  HealthMetricsEngagementNewsletterQuery,
  HealthMetricsEngagementNewsletterRowView,
  HealthMetricsEngagementNewsletterView,
} from '@lfx-one/shared/interfaces';

/**
 * `#newsletters` — every newsletter sent in the period, its rates or its audience on the chart, and each one in the
 * table. One read carries every period, so the period pill re-projects the loaded response rather than re-reading.
 */
@Component({
  selector: 'lfx-engagement-newsletter-performance',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsLineChartComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsThComponent,
    Skeleton,
    TableComponent,
    UiPaginationComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './engagement-newsletter-performance.component.html',
})
export class EngagementNewsletterPerformanceComponent {
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

  protected readonly modes = HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES;
  protected readonly size = HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_PAGE_SIZE;

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly mode = signal<HealthMetricsEngagementNewsletterMode>(this.toMode(this.initialParams.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.nlMode)));
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation that sent nothing, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEngagementNewsletterQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEngagementNewsletterPerformance> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEngagementNewsletterView> = computed(() =>
    buildHealthMetricsEngagementNewsletterView(this.response(), this.chrome.selectedRange())
  );
  /** Nothing sent in the period, or never measured; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && this.view().isEmpty);

  protected readonly sorting = injectHealthMetricsTableSort(
    HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_SORT_COLUMNS,
    HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_DEFAULT_SORT
  );
  /** A new foundation or period is a different list, and a new sort a different order, so paging restarts. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.query().foundationSlug}|${this.chrome.selectedRange()}|${JSON.stringify(this.sorting.sort())}`),
    computation: () => 0,
  });

  protected readonly points = computed<HealthMetricsEngagementNewsletterPointView[]>(() =>
    this.mode() === 'audience' ? this.view().audiencePoints : this.view().ratePoints
  );
  protected readonly chart: Signal<HealthMetricsEngagementNewsletterChartView> = computed(() =>
    buildHealthMetricsEngagementNewsletterChart(this.points(), this.mode())
  );
  // Kept inside the loaded rows, so a page picked before a smaller read lands never leaves the table blank.
  /** The table's rows in the picked order; the chart keeps its own chronological order. */
  protected readonly rows: Signal<HealthMetricsEngagementNewsletterRowView[]> = computed(() =>
    sortHealthMetricsRows(this.view().rows, this.sorting.order(), healthMetricsRowSortValue)
  );
  protected readonly pageRows: Signal<HealthMetricsEngagementNewsletterRowView[]> = computed(() => {
    const rows = this.rows();
    const page = Math.min(this.page(), Math.max(0, Math.ceil(rows.length / this.size) - 1));
    return rows.slice(page * this.size, (page + 1) * this.size);
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The list is per period, so a pill change re-settles it off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onModeChange(key: string | null): void {
    const mode = this.toMode(key);
    this.mode.set(mode);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.nlMode]: mode === 'rates' ? null : mode },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  private initResponse(): Signal<HealthMetricsEngagementNewsletterPerformance> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEngagementNewsletterPerformance(query) : of(HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (!foundationSeen) return;

              this.settled.emit(!this.loadFailed() && buildHealthMetricsEngagementNewsletterView(response, this.chrome.selectedRange()).isEmpty);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED }
    );
  }

  /** Re-settles the re-projected list; a failed or unread scope has nothing to re-settle. */
  private onRangeChange(): void {
    // A read in flight still holds the previous foundation's payload, and its own settle is still to come.
    if (this.loadFailed() || this.loading()) return;

    this.settled.emit(this.view().isEmpty);
  }

  private toMode(key: string | null): HealthMetricsEngagementNewsletterMode {
    return HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES.find((mode) => mode.key === key)?.key ?? 'rates';
  }
}
