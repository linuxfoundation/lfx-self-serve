// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementAttendanceTrendView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsLineChartComponent } from '../../../components/health-metrics-line-chart/health-metrics-line-chart.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementAttendanceTrend,
  HealthMetricsEngagementAttendanceTrendQuery,
  HealthMetricsEngagementAttendanceTrendView,
} from '@lfx-one/shared/interfaces';

/**
 * `#trend` — all-meeting attendance by month for the selected year: January to the month in progress in year to
 * date, else January to December. One read holds every month the view has; the period pill cuts it client-side.
 */
@Component({
  selector: 'lfx-engagement-attendance-trend',
  imports: [EmptyStateComponent, HealthMetricsLineChartComponent, HealthMetricsMetricsRowComponent, Skeleton, UiNoteComponent],
  templateUrl: './engagement-attendance-trend.component.html',
})
export class EngagementAttendanceTrendComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation without meetings, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** Decides which month is still in progress; refreshed on every read, so a month rollover is seen. */
  protected readonly today = signal<Date>(new Date());

  protected readonly query: Signal<HealthMetricsEngagementAttendanceTrendQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEngagementAttendanceTrend> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEngagementAttendanceTrendView> = computed(() => this.buildView(this.response()));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The year is cut from the loaded months, so a pill change re-settles off the same response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

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
            tap((response) => {
              // The month in progress is judged as of this read.
              this.today.set(new Date());
              this.loading.set(!foundationSeen);
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) {
                this.settled.emit(!this.loadFailed() && this.buildView(response).state === 'empty');
              }
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED }
    );
  }

  private buildView(response: HealthMetricsEngagementAttendanceTrend): HealthMetricsEngagementAttendanceTrendView {
    const range = this.chrome.selectedRange();
    // The pill's own year, so the trend and the pill always name the same one.
    const year = this.chrome.periods.find((period) => period.range === range)?.year ?? this.today().getUTCFullYear();
    return buildHealthMetricsEngagementAttendanceTrendView(response.months, range, year, this.today());
  }

  /** Re-settles the re-cut year; a failed or unread scope has nothing to re-settle. */
  private onRangeChange(): void {
    // A read in flight still holds the previous foundation's payload, and its own settle is still to come.
    if (this.loadFailed() || this.loading()) return;

    this.settled.emit(this.view().state === 'empty');
  }
}
