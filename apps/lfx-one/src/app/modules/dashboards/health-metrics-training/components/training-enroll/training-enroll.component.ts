// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_TRAINING_ENROLLMENT_BAR_CLASS,
  HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS,
  HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED,
  lfxColors,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsTrainingEnrollmentView, formatHealthMetricsTrainingCount, hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsL2Range,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentQuery,
  HealthMetricsTrainingEnrollmentView,
  HealthMetricsTrainingEnrollmentYearView,
} from '@lfx-one/shared/interfaces';

/**
 * `#enroll` — the period's enrollments, certifications and revenue, the split by delivery type, and
 * enrollments per year. The by-type bars follow the Enrollments / Revenue toggle.
 */
@Component({
  selector: 'lfx-training-enroll',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton],
  templateUrl: './training-enroll.component.html',
})
export class TrainingEnrollComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly barClass = HEALTH_METRICS_TRAINING_ENROLLMENT_BAR_CLASS;
  protected readonly metric = signal<HealthMetricsTrainingEnrollmentMetric>(HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS[0].id);
  protected readonly metricOptions: FilterPillOption[] = [...HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS];

  protected readonly query: Signal<HealthMetricsTrainingEnrollmentQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
    range: this.range(),
  }));
  protected readonly response: Signal<HealthMetricsTrainingEnrollment> = this.initResponse();
  protected readonly view: Signal<HealthMetricsTrainingEnrollmentView> = computed(() =>
    buildHealthMetricsTrainingEnrollmentView(this.response(), this.query().range, this.metric())
  );

  protected readonly byTypeTitle = computed(() => (this.metric() === 'revenue' ? 'Revenue by type' : 'Enrollments by type'));
  protected readonly byTypeNote = computed(() => (this.metric() === 'revenue' ? 'highest revenue first' : 'highest volume first'));
  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => this.buildChart(this.view().trend));
  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => this.tooltipTitle(items[0]?.dataIndex),
          label: (item) => `Enrollments: ${formatHealthMetricsTrainingCount(item.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        beginAtZero: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        // The caption reads "thousands per year", so the axis is labelled in K.
        ticks: { color: lfxColors.gray[500], font: { size: 10 }, callback: (value) => `${Number(value) / 1000}K` },
      },
    },
  };

  protected onMetricChange(id: string): void {
    const option = HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS.find((candidate) => candidate.id === id);
    if (option) this.metric.set(option.id);
  }

  private initResponse(): Signal<HealthMetricsTrainingEnrollment> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug && a.range === b.range),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getTrainingEnrollment(query) : of(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED);
            }),
            tap(() => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED }
    );
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The training views carry the four L2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }

  /** Enrollments per year; the open year is drawn lighter, as it will always look short until it ends. */
  private buildChart(trend: HealthMetricsTrainingEnrollmentYearView[]): ChartData<'bar'> {
    const color = lfxColors.blue[600];

    return {
      labels: trend.map((year) => String(year.year)),
      datasets: [
        {
          label: 'Enrollments',
          data: trend.map((year) => year.enrollments),
          backgroundColor: trend.map((year) => (year.isPartialYear ? hexToRgba(color, 0.4) : color)),
          borderRadius: 2,
          maxBarThickness: 32,
        },
      ],
    };
  }

  private tooltipTitle(index: number | undefined): string {
    const year = index === undefined ? undefined : this.view().trend[index];
    if (!year) return '';

    return year.isPartialYear ? `${year.year} · partial year` : String(year.year);
  }
}
