// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { finalize, of, switchMap } from 'rxjs';

import type { PerformanceSummaryKpi, WebActivitiesSummaryResponse, WebActivityDomainRow } from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-web-activity-tab',
  imports: [SparklineKpiCardComponent],
  templateUrl: './web-activity-tab.component.html',
  styles: [],
})
export class WebActivityTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly webData: Signal<WebActivitiesSummaryResponse | null> = this.initWebData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly domainRows: Signal<WebActivityDomainRow[]> = this.initDomainRows();
  protected readonly hasDomains = computed(() => this.domainRows().length > 0);

  // === Private Initializers ===
  private initWebData(): Signal<WebActivitiesSummaryResponse | null> {
    const slug$ = toObservable(this.foundationSlug);

    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.analyticsService.getWebActivitiesSummary(slug).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: null }
    );
  }

  private initKpiCards(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.webData();
      if (!data) return [];

      const totalSessions = data.totalSessions;
      const totalPageViews = data.totalPageViews;
      const pagesPerSession = totalSessions > 0 ? totalPageViews / totalSessions : 0;

      return [
        {
          id: 'total-sessions',
          label: 'Total Sessions',
          icon: 'fa-light fa-browser',
          iconClass: 'bg-blue-100 text-blue-600',
          value: formatNumber(totalSessions),
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
        },
        {
          id: 'total-page-views',
          label: 'Total Page Views',
          icon: 'fa-light fa-file-lines',
          iconClass: 'bg-emerald-100 text-emerald-600',
          value: formatNumber(totalPageViews),
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
        },
        {
          id: 'pages-per-session',
          label: 'Pages / Session',
          icon: 'fa-light fa-layer-group',
          iconClass: 'bg-amber-100 text-amber-600',
          value: pagesPerSession.toFixed(1),
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
        },
      ];
    });
  }

  private initDomainRows(): Signal<WebActivityDomainRow[]> {
    return computed(() => {
      const data = this.webData();
      if (!data?.domainGroups?.length) return [];

      const totalSessions = data.totalSessions ?? 0;

      return [...data.domainGroups]
        .sort((a, b) => b.totalSessions - a.totalSessions)
        .map((d): WebActivityDomainRow => {
          const share = totalSessions > 0 ? (d.totalSessions / totalSessions) * 100 : 0;
          return {
            domain: d.domainGroup,
            sessions: formatNumber(d.totalSessions),
            pageViews: formatNumber(d.totalPageViews),
            pagesPerSession: d.totalSessions > 0 ? (d.totalPageViews / d.totalSessions).toFixed(1) : '0.0',
            sessionShare: share,
            sessionShareFormatted: `${Math.round(share)}%`,
          };
        });
    });
  }
}
