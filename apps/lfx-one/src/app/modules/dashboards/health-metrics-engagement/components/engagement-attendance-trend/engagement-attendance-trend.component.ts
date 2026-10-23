// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED, HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE, lfxColors } from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementAttendanceTrendPoints, buildHealthMetricsEngagementAttendanceTrendSummary } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  HealthMetricsEngagementAttendanceTrend,
  HealthMetricsEngagementAttendanceTrendPointView,
  HealthMetricsEngagementAttendanceTrendQuery,
  HealthMetricsEngagementAttendanceTrendSummaryView,
} from '@lfx-one/shared/interfaces';

/**
 * `#trend` — all-meeting attendance over the trailing twelve months, from the view's monthly grain.
 * It ignores the period pill: the window always ends with this month.
 */
@Component({
  selector: 'lfx-engagement-attendance-trend',
  imports: [ChartComponent, EmptyStateComponent, SkeletonModule],
  templateUrl: './engagement-attendance-trend.component.html',
})
export class EngagementAttendanceTrendComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly minMeetings = HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation without meetings, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** Decides which month is still in progress; refreshed on every read, so a month rollover is seen. */
  protected readonly today = signal<Date>(new Date());

  protected readonly query: Signal<HealthMetricsEngagementAttendanceTrendQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEngagementAttendanceTrend> = this.initResponse();

  protected readonly points: Signal<HealthMetricsEngagementAttendanceTrendPointView[]> = computed(() =>
    buildHealthMetricsEngagementAttendanceTrendPoints(this.response().months, this.today())
  );
  protected readonly summary: Signal<HealthMetricsEngagementAttendanceTrendSummaryView> = computed(() =>
    buildHealthMetricsEngagementAttendanceTrendSummary(this.response().months, this.today())
  );
  protected readonly chartData: Signal<ChartData<'line'>> = computed(() => this.buildChart(this.points()));
  protected readonly chartLabel = computed(
    () => `All-meeting attendance over the last ${this.points().length} months, oldest first. The following table lists the same values.`
  );
  protected readonly chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => this.points()[items[0]?.dataIndex ?? -1]?.monthLabel ?? '',
          label: (item) => this.tooltipLabel(item.dataIndex),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        min: 0,
        max: 100,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { stepSize: 25, color: lfxColors.gray[500], font: { size: 10 }, callback: (value) => `${value}%` },
      },
    },
  };

  private initResponse(): Signal<HealthMetricsEngagementAttendanceTrend> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED);
    }

    // Latches on the first non-empty slug, as on the Overview: before any foundation resolves the
    // skeleton holds, while one cleared after a read still settles instead of wedging on it.
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
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight
        // request for the previous one.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEngagementAttendanceTrend(query) : of(HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED)).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED);
            }),
            tap(() => {
              // The response's window rolls with the run date, so the in-progress month is judged now.
              this.today.set(new Date());
              this.loading.set(!foundationSeen);
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED }
    );
  }

  /** One blue line that gaps on unrated months; the month in progress is dashed and hollow. */
  private buildChart(points: HealthMetricsEngagementAttendanceTrendPointView[]): ChartData<'line'> {
    const line = lfxColors.blue[500];
    return {
      labels: points.map((point) => point.label),
      datasets: [
        {
          label: 'Attendance',
          data: points.map((point) => point.rate),
          borderColor: line,
          borderWidth: 2.5,
          pointBorderColor: line,
          pointBorderWidth: 2,
          pointBackgroundColor: points.map((point) => (point.isInProgress ? lfxColors.white : line)),
          pointRadius: 3.5,
          spanGaps: false,
          segment: { borderDash: (context) => (points[context.p1DataIndex]?.isInProgress ? [4, 3] : undefined) },
        },
      ],
    };
  }

  private tooltipLabel(index: number): string {
    const point = this.points()[index];
    return point ? `Attendance ${point.rateLabel} · ${point.meetingsLabel}` : '';
  }
}
