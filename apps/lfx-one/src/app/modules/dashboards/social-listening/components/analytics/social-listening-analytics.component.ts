// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, inject, input, model, PLATFORM_ID, Signal, untracked, viewChild } from '@angular/core';
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
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, map, Observable, of, startWith, switchMap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';

import type {
  LoadableState,
  MentionFilters,
  SocialListeningAnalyticsOverview,
  SocialListeningAnalyticsRequest,
  SocialListeningPlatformRow,
  SocialListeningSentimentRow,
  SocialListeningTopProject,
  StatCardItem,
} from '@lfx-one/shared/interfaces';

/**
 * Social Listening Analytics tab (LFXV2-3018, PCC port): six panels over the feed-derived 3015
 * endpoints, refetched when the page's scope or feed predicate changes; each panel degrades independently.
 */
@Component({
  selector: 'lfx-social-listening-analytics',
  imports: [DecimalPipe, CardComponent, ChartComponent, EmptyStateComponent, MessageComponent, StatCardGridComponent, SkeletonModule],
  templateUrl: './social-listening-analytics.component.html',
  styleUrl: './social-listening-analytics.component.scss',
})
export class SocialListeningAnalyticsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly socialListeningService = inject(SocialListeningService);
  private readonly messageService = inject(MessageService);

  // === Scope inputs (page-owned signals, propagated down) ===
  public readonly foundationSlug = input('');
  public readonly period = input('');
  /** Display-only: the per-platform % label is meaningful on the unfiltered view. The request itself takes `filters.platform`. */
  public readonly platform = input('all');
  /** The feed predicate — analytics panels filter identically to the feed so the two tabs agree. */
  public readonly filters = input<MentionFilters>({});

  // === Export (page-triggered via nonce; progress reported back via model) ===
  public readonly exportNonce = input(0);
  public readonly isExporting = model(false);
  /** True while any panel is still fetching — the page disables the export trigger so the PNG can't capture skeletons. */
  public readonly panelsLoading = model(false);

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

  private readonly anyPanelLoading = computed(
    () =>
      this.overviewLoading() || this.overTimeLoading() || this.platformLoading() || this.tagsLoading() || this.sentimentLoading() || this.topProjectsLoading()
  );

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

  private destroyed = false;

  public constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));

    // Export trigger: the page increments exportNonce; the component captures its own content
    // (effect = signal → imperative DOM sink). The initial run is a no-op via the nonce guard.
    effect(() => {
      if (this.exportNonce() === 0) return;
      if (!isPlatformBrowser(this.platformId)) return;
      untracked(() => void this.exportAnalytics());
    });

    // Report panel loading to the page so the export trigger stays disabled while skeletons are visible.
    effect(() => this.panelsLoading.set(this.anyPanelLoading()));
  }

  private async exportAnalytics(): Promise<void> {
    const element = this.analyticsContent()?.nativeElement;
    if (!element || this.isExporting()) return;

    this.isExporting.set(true);
    // Yield a frame so Angular can paint the header spinner before html-to-image blocks the
    // main thread with DOM traversal (PCC parity).
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const exported = await downloadCardAsImage(element, `social-listening-analytics-${this.period() || 'export'}`, { backgroundColor: lfxColors.white });
      if (!exported) {
        this.messageService.add({
          severity: 'error',
          summary: 'Export Failed',
          detail: 'The analytics image could not be generated. Please try again.',
        });
      }
    } finally {
      // A tab switch destroys this component mid-export; writing the model then throws, and the
      // page clears its own `exporting` on teardown.
      if (!this.destroyed) this.isExporting.set(false);
    }
  }

  /** Scope + feed predicate shared by all six analytics requests; null until the page has a foundation + period. */
  private initAnalyticsRequest(): Signal<SocialListeningAnalyticsRequest | null> {
    return computed(() => {
      const foundationSlug = this.foundationSlug();
      const period = this.period();
      if (!foundationSlug || !period) return null;
      return { foundationSlug, period, ...this.filters() };
    });
  }

  /**
   * Shared declarative-state pipeline for the analytics panels: `debounceTime(0)` coalesces
   * synchronous scope changes, `startWith`/`catchError` give per-panel loading/error.
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

  /** KPI stat cards; deltas come precomputed from the server and `buildAnalyticsDelta` hides thin previous windows. */
  private initStatCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const overview = this.overviewState().data;
      const projectCount = overview?.CHILD_PROJECTS_COUNT ?? 0;
      const projectNoun = projectCount === 1 ? 'project' : 'projects';
      return [
        {
          icon: 'fa-light fa-ear-listen',
          iconContainerClass: 'bg-blue-100 text-blue-600',
          label: 'Total Mentions',
          value: overview ? overview.TOTAL_MENTIONS.toLocaleString('en-US') : '0',
          subLine: overview ? `across ${projectCount} ${projectNoun}` : undefined,
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
