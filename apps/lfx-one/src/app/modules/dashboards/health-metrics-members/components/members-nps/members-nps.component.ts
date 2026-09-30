// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_NPS_MAX_AUDIENCE_LENGTH,
  HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT,
  HEALTH_METRICS_MEMBERS_NPS_UNMEASURED,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  lfxColors,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersNpsAudienceOptions,
  buildHealthMetricsMembersNpsSegments,
  buildHealthMetricsMembersNpsSummary,
  buildHealthMetricsMembersNpsTrend,
  buildHealthMetricsMembersNpsTrendNote,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skipWhile, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  HealthMetricsL2Range,
  HealthMetricsMembersNps,
  HealthMetricsMembersNpsAudience,
  HealthMetricsMembersNpsAudienceOption,
  HealthMetricsMembersNpsQuery,
  HealthMetricsMembersNpsSegmentView,
  HealthMetricsMembersNpsSummaryView,
  HealthMetricsMembersNpsTrendNote,
  HealthMetricsMembersNpsTrendPointView,
} from '@lfx-one/shared/interfaces';

/**
 * `#nps` — one audience's latest survey in the selected period: the score with its response rate, the
 * response distribution with non-responses at full weight, and the score and rate over every wave.
 */
@Component({
  selector: 'lfx-members-nps',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton],
  templateUrl: './members-nps.component.html',
})
export class MembersNpsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly rateFloorPct = HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a period without a survey, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** The requested audience; `null` lets the read pick the first one surveyed in the period. */
  protected readonly audience = signal<string | null>(this.parseInitialAudience());

  private readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  private readonly range = computed<HealthMetricsL2Range>(() => {
    const range = this.chrome.selectedRange();
    // The views carry the four Level 2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  });

  protected readonly query: Signal<HealthMetricsMembersNpsQuery> = computed(() => ({
    foundationSlug: this.foundationSlug(),
    range: this.range(),
    audience: this.audience(),
  }));
  protected readonly response: Signal<HealthMetricsMembersNps> = this.initResponse();

  protected readonly audienceOptions: Signal<HealthMetricsMembersNpsAudienceOption[]> = computed(() =>
    buildHealthMetricsMembersNpsAudienceOptions(this.response().audiences)
  );
  /** The read's own pick, so an audience the period did not survey never shows as selected. */
  protected readonly selectedAudience: Signal<HealthMetricsMembersNpsAudience | null> = computed(() => {
    const { audiences, selectedAudience } = this.response();
    return audiences.find((candidate) => candidate.audience === selectedAudience) ?? null;
  });
  protected readonly summary: Signal<HealthMetricsMembersNpsSummaryView> = computed(() => buildHealthMetricsMembersNpsSummary(this.selectedAudience()));
  protected readonly segments: Signal<HealthMetricsMembersNpsSegmentView[]> = computed(() => buildHealthMetricsMembersNpsSegments(this.selectedAudience()));
  protected readonly trend: Signal<HealthMetricsMembersNpsTrendPointView[]> = computed(() => buildHealthMetricsMembersNpsTrend(this.response().trend));
  protected readonly trendNote: Signal<HealthMetricsMembersNpsTrendNote | null> = computed(() => buildHealthMetricsMembersNpsTrendNote(this.trend()));
  protected readonly noSurvey = computed(() => this.selectedAudience() === null);
  protected readonly distributionLabel = computed(
    () =>
      `Response distribution: ${this.segments()
        .map((segment) => `${segment.label} ${segment.countLabel}`)
        .join(', ')}, ${this.summary().surveyedLabel}.`
  );
  protected readonly chartData: Signal<ChartData<'bar' | 'line'>> = computed(() => this.buildChart(this.trend()));
  protected readonly chartLabel = computed(
    () => `NPS score and response rate over ${this.trend().length} survey waves, oldest first. The following table lists the same values.`
  );
  protected readonly chartOptions: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (item) => this.tooltipLabel(item.datasetIndex, item.dataIndex),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        beginAtZero: true,
        suggestedMax: 100,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 } },
      },
      y1: {
        position: 'right',
        min: 0,
        max: 100,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.amber[600], font: { size: 10 }, callback: (value) => `${value}%` },
      },
    },
  };

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const seeded = this.audience();
      toObservable(this.audience)
        .pipe(
          // Drops the state just read out of the URL, but not a reset of it that lands before the first emission.
          skipWhile((value, index) => index === 0 && value === seeded),
          distinctUntilChanged(),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  protected onAudienceChange(id: string): void {
    if (this.response().audiences.some((candidate) => candidate.audience === id)) this.audience.set(id);
  }

  private initResponse(): Signal<HealthMetricsMembersNps> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_NPS_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;
    // An audience the read fell back from; resetting it to `null` resolves to the same audience, so it is not re-read.
    let droppedAudience: string | null = null;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged(
          (a, b) =>
            a.foundationSlug === b.foundationSlug &&
            a.range === b.range &&
            (a.audience === b.audience || (b.audience === null && a.audience === droppedAudience))
        ),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersNps(query) : of(HEALTH_METRICS_MEMBERS_NPS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_NPS_UNMEASURED);
            }),
            tap((response) => {
              // An audience the period did not survey falls back, so the URL must not keep naming it.
              if (!this.loadFailed() && query.audience !== null && response.selectedAudience !== query.audience) {
                droppedAudience = query.audience;
                this.audience.set(null);
              }
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_NPS_UNMEASURED }
    );
  }

  /** Score bars on the left axis; the response rate as a dashed line on the right, red where it falls below the floor. */
  private buildChart(points: HealthMetricsMembersNpsTrendPointView[]): ChartData<'bar' | 'line'> {
    const rateColors = points.map((point) => (point.isRateBelowFloor ? lfxColors.red[600] : lfxColors.amber[600]));
    return {
      labels: points.map((point) => point.label),
      datasets: [
        {
          type: 'line',
          label: 'Response rate',
          data: points.map((point) => point.ratePct),
          yAxisID: 'y1',
          borderColor: lfxColors.amber[600],
          borderWidth: 2,
          borderDash: [4, 3],
          pointBackgroundColor: rateColors,
          pointBorderColor: rateColors,
          pointRadius: points.map((point) => (point.isRateBelowFloor ? 4.5 : 3.5)),
          spanGaps: true,
        },
        {
          type: 'bar',
          label: 'NPS score',
          data: points.map((point) => point.score),
          yAxisID: 'y',
          backgroundColor: lfxColors.blue[300],
          borderRadius: 2,
          maxBarThickness: 52,
        },
      ],
    } as ChartData<'bar' | 'line'>;
  }

  private tooltipLabel(datasetIndex: number, index: number): string {
    const point = this.trend()[index];
    if (!point) return '';
    return datasetIndex === 0 ? `Response rate ${point.rateLabel}` : `NPS score ${point.scoreLabel}`;
  }

  private syncUrl(): void {
    const audience = this.audience();
    const first = this.response().audiences[0]?.audience ?? null;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.npsAudience]: audience === null || audience === first ? null : audience },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  private parseInitialAudience(): string | null {
    const value = this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.npsAudience)?.trim() ?? '';
    return value === '' ? null : value.slice(0, HEALTH_METRICS_MEMBERS_NPS_MAX_AUDIENCE_LENGTH);
  }
}
