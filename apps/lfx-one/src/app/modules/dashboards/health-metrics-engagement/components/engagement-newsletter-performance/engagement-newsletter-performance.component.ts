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
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
  HEALTH_METRICS_OVERVIEW_PROGRESS_TINT,
  HEALTH_METRICS_OVERVIEW_STROKES,
  lfxColors,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementNewsletterView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type { TablePageEvent } from 'primeng/table';

import type {
  FilterPillOption,
  HealthMetricsEngagementNewsletterMode,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterPointView,
  HealthMetricsEngagementNewsletterQuery,
  HealthMetricsEngagementNewsletterView,
} from '@lfx-one/shared/interfaces';

/**
 * `#newsletters` — every newsletter sent in the period, its rates or its audience on the chart, and each one in the
 * table. One read carries every period, so the period pill re-projects the loaded response rather than re-reading.
 */
@Component({
  selector: 'lfx-engagement-newsletter-performance',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './engagement-newsletter-performance.component.html',
})
export class EngagementNewsletterPerformanceComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav badge: newsletters sent in the period; `null` while a read is pending or failed. */
  public readonly countChange = output<number | null>();
  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly modeOptions: FilterPillOption[] = HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES.map((mode) => ({ id: mode.key, label: mode.label }));
  protected readonly colors = {
    open: HEALTH_METRICS_OVERVIEW_STROKES.progress,
    click: HEALTH_METRICS_OVERVIEW_STROKES.thisYear,
    clickToOpen: HEALTH_METRICS_OVERVIEW_STROKES.high,
  };

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly mode = signal<HealthMetricsEngagementNewsletterMode>(this.toMode(this.initialParams.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.nlMode)));
  protected readonly size = signal<number>(HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_PAGE_SIZE);
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

  /** A new foundation or period is a different list, so paging restarts. */
  protected readonly first = linkedSignal<string, number>({
    source: computed(() => `${this.query().foundationSlug}|${this.chrome.selectedRange()}`),
    computation: () => 0,
  });

  protected readonly audienceMode = computed(() => this.mode() === 'audience');
  protected readonly points = computed<HealthMetricsEngagementNewsletterPointView[]>(() =>
    this.audienceMode() ? this.view().audiencePoints : this.view().ratePoints
  );
  protected readonly chartData: Signal<ChartData<'line'>> = computed(() => this.buildChart(this.points()));
  protected readonly chartOptions: Signal<ChartOptions<'line'>> = computed(() => this.buildChartOptions(this.points()));
  /** The chart's values as text, one row per newsletter, for the screen-reader table beside it. */
  protected readonly chartRows = computed(() => {
    const datasets = this.chartData().datasets;
    const format = (value: unknown): string => {
      if (typeof value !== 'number') return '—';
      return this.audienceMode() ? value.toLocaleString('en-US') : `${Math.round(value)}%`;
    };
    return this.points().map((point, index) => ({ key: point.key, title: point.title, cells: datasets.map((dataset) => format(dataset.data[index])) }));
  });
  protected readonly chartLabel = computed(() =>
    this.audienceMode()
      ? 'Recipients and unique opens by newsletter, oldest first. The following table lists the same values.'
      : 'Open, click and click-to-open rate by newsletter, oldest first. The following table lists the same values.'
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The badge and the list are per period, so a pill change re-reports both off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onModeChange(key: string): void {
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

  protected onTablePage(event: TablePageEvent): void {
    this.size.set(event.rows ?? this.size());
    this.first.set(event.first ?? 0);
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
          this.countChange.emit(null);
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

              const view = buildHealthMetricsEngagementNewsletterView(response, this.chrome.selectedRange());
              this.countChange.emit(this.loadFailed() ? null : view.newslettersSent);
              this.settled.emit(!this.loadFailed() && view.isEmpty);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED }
    );
  }

  /** Re-reports the badge and re-settles the re-projected list; a failed or unread scope stays `null`. */
  private onRangeChange(): void {
    // A read in flight still holds the previous foundation's payload, and its own settle is still to come.
    if (this.loadFailed() || this.loading()) return;

    this.countChange.emit(this.view().newslettersSent);
    this.settled.emit(this.view().isEmpty);
  }

  private toMode(key: string | null): HealthMetricsEngagementNewsletterMode {
    return HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES.find((mode) => mode.key === key)?.key ?? 'rates';
  }

  /** The design's lines: open rate filled in blue, click rate in purple and click-to-open dashed green; or recipients over unique opens. */
  private buildChart(points: HealthMetricsEngagementNewsletterPointView[]): ChartData<'line'> {
    const line = (label: string, data: (number | null)[], color: string, extra: object = {}): ChartData<'line'>['datasets'][number] => ({
      label,
      data,
      borderColor: color,
      borderWidth: 2,
      pointBorderColor: color,
      pointBackgroundColor: lfxColors.white,
      pointBorderWidth: 2,
      pointRadius: 3.5,
      spanGaps: false,
      ...extra,
    });
    const filled = { fill: 'origin', backgroundColor: HEALTH_METRICS_OVERVIEW_PROGRESS_TINT };

    return {
      labels: points.map((point) => point.tick),
      datasets: this.audienceMode()
        ? [
            line(
              'Recipients',
              points.map((point) => point.recipients),
              this.colors.open,
              filled
            ),
            line(
              'Unique opens',
              points.map((point) => point.uniqueOpens),
              this.colors.click
            ),
          ]
        : [
            line(
              'Open rate',
              points.map((point) => point.openPct),
              this.colors.open,
              filled
            ),
            line(
              'Click rate',
              points.map((point) => point.clickPct),
              this.colors.click
            ),
            line(
              'Click-to-open rate',
              points.map((point) => point.clickToOpenPct),
              this.colors.clickToOpen,
              { borderDash: [5, 4] }
            ),
          ],
    };
  }

  /** Rates top out at the highest one, rounded up to the next 10%; counts start at zero and scale themselves. */
  private buildChartOptions(points: HealthMetricsEngagementNewsletterPointView[]): ChartOptions<'line'> {
    const audience = this.audienceMode();
    const peak = Math.max(0, ...points.flatMap((point) => [point.openPct ?? 0, point.clickPct ?? 0, point.clickToOpenPct ?? 0]));
    // Float noise is trimmed first, so 0.7 × 100 tops out at 70% rather than 80%, without dropping a real 50.04%.
    const top = Math.min(100, Math.max(10, Math.ceil(Math.round(peak * 1000) / 10_000) * 10));
    const tick = { color: lfxColors.gray[500], font: { size: 10 } };

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            title: (items) => points[items[0]?.dataIndex ?? -1]?.title ?? '',
            label: (item) =>
              item.parsed.y === null ? '' : `${item.dataset.label} ${audience ? item.parsed.y.toLocaleString('en-US') : `${Math.round(item.parsed.y)}%`}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: tick },
        y: audience
          ? {
              beginAtZero: true,
              grid: { color: lfxColors.gray[200] },
              border: { display: false },
              ticks: { ...tick, callback: (value) => Number(value).toLocaleString('en-US') },
            }
          : { min: 0, max: top, grid: { color: lfxColors.gray[200] }, border: { display: false }, ticks: { ...tick, callback: (value) => `${value}%` } },
      },
    };
  }
}
