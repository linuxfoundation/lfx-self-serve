// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, input, model, PLATFORM_ID, Signal, untracked, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { ANALYTICS_TOP_PROJECTS_LIMIT, lfxColors } from '@lfx-one/shared/constants';
import { buildAnalyticsDelta, buildOverTimeChartData, buildTagsChartData, mapPlatformDistributionRows, mapSentimentRows } from '@lfx-one/shared/utils';
import { SocialListeningService } from '@services/social-listening.service';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, map, Observable, of, startWith, switchMap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';

import type {
  LoadableState,
  SocialListeningAnalyticsOverview,
  SocialListeningAnalyticsRequest,
  SocialListeningPlatformRow,
  SocialListeningSentimentRow,
  SocialListeningTopProject,
  StatCardItem,
} from '@lfx-one/shared/interfaces';

/**
 * Social Listening Analytics tab (LFXV2-3018), ported from PCC's
 * `reports/social-listening/.../analytics` component. All six panels read the feed-derived
 * 3015 endpoints (not PCC's pre-aggregated views — master §0) through declarative `toSignal`
 * pipelines keyed off the page's scope signals, so period/platform/sub-project changes
 * propagate automatically. A failed request degrades only its own panel.
 *
 * Bar visualizations (platform, sentiment) are CSS flex segments — export-safe and free of
 * chart lifecycle concerns; only Mentions Over Time (line) and Mentions by Tag (bar) use
 * `lfx-chart`, with options held as plain class properties (rule: `computed()` options churn
 * the reference and force PrimeNG to destroy/rebuild the chart).
 *
 * Export: the page increments `exportNonce` (input-driven trigger, rule 12.7 — no viewChild
 * calls); the component captures its own content grid via `downloadCardAsImage` and reports
 * progress back through the `isExporting` model so the header button can spin.
 */
@Component({
  selector: 'lfx-social-listening-analytics',
  imports: [DecimalPipe, CardComponent, ChartComponent, EmptyStateComponent, MessageComponent, StatCardGridComponent, SkeletonModule],
  templateUrl: './social-listening-analytics.component.html',
  styleUrl: './social-listening-analytics.component.scss',
})
export class SocialListeningAnalyticsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly socialListeningService = inject(SocialListeningService);

  // === Scope inputs (page-owned signals, propagated down) ===
  public readonly foundationSlug = input('');
  public readonly period = input('');
  public readonly platform = input('all');
  public readonly sourceProjectId = input('all');

  // === Export (page-triggered via nonce; progress reported back via model) ===
  public readonly exportNonce = input(0);
  public readonly isExporting = model(false);

  private readonly analyticsContent = viewChild<ElementRef<HTMLElement>>('analyticsContent');

  private readonly analyticsRequest: Signal<SocialListeningAnalyticsRequest | null> = this.initAnalyticsRequest();

  // === Panel states (each pipeline degrades independently) ===
  private readonly overviewState: Signal<LoadableState<SocialListeningAnalyticsOverview | null>> = this.initAnalyticsState(
    (req) => this.socialListeningService.getAnalyticsOverview(req),
    null
  );
  private readonly overTimeState: Signal<LoadableState<ChartData<'line'> | null>> = this.initAnalyticsState(
    (req) => this.socialListeningService.getAnalyticsOverTime(req).pipe(map(buildOverTimeChartData)),
    null
  );
  private readonly platformState: Signal<LoadableState<SocialListeningPlatformRow[]>> = this.initAnalyticsState(
    (req) => this.socialListeningService.getAnalyticsPlatformDistribution(req).pipe(map((rows) => mapPlatformDistributionRows(rows))),
    []
  );
  private readonly tagsState: Signal<LoadableState<ChartData<'bar'> | null>> = this.initAnalyticsState(
    (req) => this.socialListeningService.getMentionsTags(req).pipe(map(buildTagsChartData)),
    null
  );
  private readonly sentimentState: Signal<LoadableState<SocialListeningSentimentRow[]>> = this.initAnalyticsState(
    (req) => this.socialListeningService.getAnalyticsSentimentDistribution(req).pipe(map(mapSentimentRows)),
    []
  );
  private readonly topProjectsState: Signal<LoadableState<SocialListeningTopProject[]>> = this.initAnalyticsState(
    (req) => this.socialListeningService.getAnalyticsTopProjects({ ...req, limit: ANALYTICS_TOP_PROJECTS_LIMIT }),
    []
  );

  // === Template-facing derivations ===
  public readonly statCards: Signal<StatCardItem[]> = this.initStatCards();
  public readonly overviewLoading = computed(() => this.overviewState().loading);
  public readonly overviewError = computed(() => this.overviewState().error);

  public readonly overTimeData = computed(() => this.overTimeState().data);
  public readonly overTimeLoading = computed(() => this.overTimeState().loading);
  public readonly overTimeError = computed(() => this.overTimeState().error);

  public readonly platformRows = computed(() => this.platformState().data);
  public readonly platformLoading = computed(() => this.platformState().loading);
  public readonly platformError = computed(() => this.platformState().error);
  /** PCC behavior: the per-platform % label is only meaningful on the unfiltered (all-platforms) view. */
  public readonly showPlatformPercents = computed(() => this.platform() === 'all');

  public readonly tagsData = computed(() => this.tagsState().data);
  public readonly tagsLoading = computed(() => this.tagsState().loading);
  public readonly tagsError = computed(() => this.tagsState().error);

  public readonly sentimentRows = computed(() => this.sentimentState().data);
  public readonly sentimentLoading = computed(() => this.sentimentState().loading);
  public readonly sentimentError = computed(() => this.sentimentState().error);

  public readonly topProjects = computed(() => this.topProjectsState().data);
  public readonly topProjectsLoading = computed(() => this.topProjectsState().loading);
  public readonly topProjectsError = computed(() => this.topProjectsState().error);

  // === Chart options — plain class properties, never computed() (rule 7.8) ===
  protected readonly overTimeOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { usePointStyle: true, pointStyle: 'line', padding: 15, color: lfxColors.gray[600] },
      },
      tooltip: { mode: 'index', intersect: false },
    },
    elements: {
      line: { tension: 0.4, fill: false },
      point: { radius: 3, hoverRadius: 5 },
    },
    scales: {
      x: { display: true, grid: { display: false }, ticks: { color: lfxColors.gray[500] } },
      y: { display: true, beginAtZero: true, grid: { color: lfxColors.gray[200] }, ticks: { color: lfxColors.gray[500] } },
    },
  };

  protected readonly tagsChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 11 } } },
      y: { display: true, beginAtZero: true, grid: { color: lfxColors.gray[200] }, ticks: { color: lfxColors.gray[500] } },
    },
  };

  public constructor() {
    // Export trigger: the page increments exportNonce; the component owns its content element
    // and performs the capture itself. Effect = signal → imperative DOM sink (html-to-image),
    // which is the sanctioned effect use; the initial run is a no-op via the nonce guard.
    effect(() => {
      if (this.exportNonce() === 0) return;
      if (!isPlatformBrowser(this.platformId)) return;
      untracked(() => void this.exportAnalytics());
    });
  }

  private async exportAnalytics(): Promise<void> {
    const element = this.analyticsContent()?.nativeElement;
    if (!element || this.isExporting()) return;

    this.isExporting.set(true);
    // Yield a frame so Angular can paint the header spinner before html-to-image blocks the
    // main thread with DOM traversal (PCC parity).
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      await downloadCardAsImage(element, `social-listening-analytics-${this.period() || 'export'}`, { backgroundColor: lfxColors.white });
    } finally {
      this.isExporting.set(false);
    }
  }

  /** Scope shared by all six analytics requests; null until the page has a foundation + period. */
  private initAnalyticsRequest(): Signal<SocialListeningAnalyticsRequest | null> {
    return computed(() => {
      const foundationSlug = this.foundationSlug();
      const period = this.period();
      if (!foundationSlug || !period) return null;
      return {
        foundationSlug,
        period,
        platform: this.platform() !== 'all' ? this.platform() : undefined,
        sourceProjectId: this.sourceProjectId() !== 'all' ? this.sourceProjectId() : undefined,
      };
    });
  }

  /**
   * Shared declarative-state pipeline for the analytics panels: refetch on scope change
   * (debounceTime(0) coalesces synchronous multi-signal changes into one round), loading via
   * `startWith`, per-panel error via `catchError` (errors degrade one panel, not the tab).
   */
  private initAnalyticsState<T>(fetchFn: (req: SocialListeningAnalyticsRequest) => Observable<T>, empty: T): Signal<LoadableState<T>> {
    return toSignal(
      toObservable(this.analyticsRequest).pipe(
        debounceTime(0),
        switchMap((req) => {
          if (req === null) {
            return of<LoadableState<T>>({ loading: false, error: null, data: empty });
          }
          return fetchFn(req).pipe(
            map((data): LoadableState<T> => ({ loading: false, error: null, data })),
            catchError(() => of<LoadableState<T>>({ loading: false, error: 'Failed to load this panel', data: empty })),
            startWith<LoadableState<T>>({ loading: true, error: null, data: empty })
          );
        })
      ),
      { initialValue: { loading: false, error: null, data: empty } }
    );
  }

  /**
   * KPI stat cards (Total Mentions / Negative / Positive Sentiment). Deltas come precomputed
   * from the server; `buildAnalyticsDelta` hides them when the previous window was too thin
   * (null) and flips colors on the negative card (an increase in negative sentiment is bad).
   */
  private initStatCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const overview = this.overviewState().data;
      return [
        {
          icon: 'fa-light fa-ear-listen',
          iconContainerClass: 'bg-blue-100 text-blue-600',
          label: 'Total Mentions',
          value: overview ? overview.TOTAL_MENTIONS.toLocaleString() : '0',
          subLine: overview ? `across ${overview.CHILD_PROJECTS_COUNT} projects` : undefined,
          delta: buildAnalyticsDelta(overview?.TOTAL_MENTIONS_CHANGE_PCT ?? null),
        },
        {
          icon: 'fa-light fa-face-frown',
          iconContainerClass: 'bg-red-100 text-red-600',
          label: 'Negative Sentiment',
          value: overview ? `${overview.NEGATIVE_SENTIMENT_PERCENT}%` : '0%',
          subLine: 'of all mentions',
          delta: buildAnalyticsDelta(overview?.NEGATIVE_SENTIMENT_CHANGE_PCT ?? null, true),
        },
        {
          icon: 'fa-light fa-face-smile',
          iconContainerClass: 'bg-emerald-100 text-emerald-600',
          label: 'Positive Sentiment',
          value: overview ? `${overview.POSITIVE_SENTIMENT_PERCENT}%` : '0%',
          subLine: 'of all mentions',
          delta: buildAnalyticsDelta(overview?.POSITIVE_SENTIMENT_CHANGE_PCT ?? null),
        },
      ];
    });
  }
}
