// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  createHorizontalBarChartOptions,
  createLineChartOptions,
  DASHBOARD_TOOLTIP_CONFIG,
  lfxColors,
  MARKETING_ACTION_ICON_MAP,
} from '@lfx-one/shared/constants';
import { formatNumber, hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type { ChartData, ChartOptions } from 'chart.js';
import type { WebActivitiesSummaryResponse, MarketingRecommendedAction, MarketingKeyInsight, MarketingActionType } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-website-visits-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DrawerModule, ChartComponent, SkeletonModule, TagComponent],
  templateUrl: './website-visits-drawer.component.html',
  styleUrl: './website-visits-drawer.component.scss',
})
export class WebsiteVisitsDrawerComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals (lazy-loaded data) ===
  protected readonly drawerData: Signal<WebActivitiesSummaryResponse> = this.initDrawerData();
  protected readonly formattedTotalSessions: Signal<string> = computed(() => formatNumber(this.drawerData().totalSessions));
  protected readonly formattedTotalPageViews: Signal<string> = computed(() => formatNumber(this.drawerData().totalPageViews));
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly domainChartData: Signal<ChartData<'bar'>> = this.initDomainChartData();

  protected readonly trendChartOptions: ChartOptions<'line'> = createLineChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y ?? 0).toLocaleString()} sessions`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 }, maxTicksLimit: 8 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (num >= 999_950) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
  });

  protected readonly domainChartOptions: ChartOptions<'bar'> = createHorizontalBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.x ?? 0).toLocaleString()} sessions`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (num >= 999_950) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[600], font: { size: 12 } },
      },
    },
  });

  protected readonly formatNumber = formatNumber;

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected actionIcon(type: MarketingActionType): string {
    return MARKETING_ACTION_ICON_MAP[type];
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<WebActivitiesSummaryResponse> {
    const defaultValue: WebActivitiesSummaryResponse = {
      totalSessions: 0,
      totalPageViews: 0,
      domainGroups: [],
      dailyData: [],
      dailyLabels: [],
    };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || ''));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.drawerLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getWebActivitiesSummary(foundationSlug).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load website visit details.',
              });
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { totalSessions, totalPageViews, domainGroups, dailyData } = this.drawerData();
      const actions: MarketingRecommendedAction[] = [];

      if (totalSessions === 0 && dailyData.length === 0) {
        return actions;
      }

      // Check for declining trend in recent days
      if (dailyData.length >= 14) {
        const firstHalf = dailyData.slice(0, Math.floor(dailyData.length / 2));
        const secondHalf = dailyData.slice(Math.floor(dailyData.length / 2));
        const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
        if (secondAvg < firstAvg * 0.9) {
          const decline = Math.round(((firstAvg - secondAvg) / firstAvg) * 100);
          actions.push({
            title: 'Investigate traffic decline',
            description: `Sessions dropped ~${decline}% in the recent period — review traffic sources and content changes`,
            priority: 'high',
            dueLabel: 'This week',
            actionType: 'decline',
          });
        }
      }

      // Concentration in top domain
      if (domainGroups.length > 1 && totalSessions > 0) {
        const sorted = [...domainGroups].sort((a, b) => b.totalSessions - a.totalSessions);
        const topShare = (sorted[0].totalSessions / totalSessions) * 100;
        if (topShare > 70) {
          actions.push({
            title: `Diversify traffic beyond ${sorted[0].domainGroup}`,
            description: `${topShare.toFixed(0)}% of sessions come from a single domain — expand content across other properties`,
            priority: 'medium',
            dueLabel: 'This month',
            actionType: 'diversify',
          });
        }
      }

      // Pages per session ratio
      if (totalSessions > 0 && totalPageViews > 0) {
        const pagesPerSession = totalPageViews / totalSessions;
        if (pagesPerSession < 1.5) {
          actions.push({
            title: 'Improve internal linking',
            description: `Only ${pagesPerSession.toFixed(1)} pages per session — add cross-links to increase engagement`,
            priority: 'medium',
            dueLabel: 'This month',
            actionType: 'optimize',
          });
        }
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue current strategy',
          description: `${formatNumber(totalSessions)} sessions with healthy traffic distribution`,
          priority: 'low',
          dueLabel: 'Ongoing',
          actionType: 'growth',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { totalSessions, totalPageViews, domainGroups, dailyData } = this.drawerData();
      const insights: MarketingKeyInsight[] = [];

      if (totalSessions === 0 && dailyData.length === 0) {
        return insights;
      }

      // Pages per session
      if (totalSessions > 0) {
        const pagesPerSession = totalPageViews / totalSessions;
        insights.push({
          text: `${pagesPerSession.toFixed(1)} pages per session across ${formatNumber(totalSessions)} visits`,
          type: pagesPerSession >= 2 ? 'driver' : 'info',
        });
      }

      // Domain distribution
      if (domainGroups.length > 0 && totalSessions > 0) {
        const sorted = [...domainGroups].sort((a, b) => b.totalSessions - a.totalSessions);
        const topShare = (sorted[0].totalSessions / totalSessions) * 100;
        if (domainGroups.length >= 3) {
          const top3 = sorted.slice(0, 3).reduce((s, d) => s + d.totalSessions, 0);
          const top3Share = (top3 / totalSessions) * 100;
          insights.push({ text: `${top3Share.toFixed(0)}% of traffic from top 3 domains`, type: topShare > 70 ? 'warning' : 'info' });
        }
      }

      // Daily trend
      if (dailyData.length >= 14) {
        const firstHalf = dailyData.slice(0, Math.floor(dailyData.length / 2));
        const secondHalf = dailyData.slice(Math.floor(dailyData.length / 2));
        const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
        if (secondAvg > firstAvg * 1.1) {
          const growth = Math.round(((secondAvg - firstAvg) / firstAvg) * 100);
          insights.push({ text: `Sessions trending up ~${growth}% in recent days`, type: 'driver' });
        } else if (secondAvg < firstAvg * 0.9) {
          const decline = Math.round(((firstAvg - secondAvg) / firstAvg) * 100);
          insights.push({ text: `Sessions trending down ~${decline}% in recent days`, type: 'warning' });
        } else {
          insights.push({ text: 'Session volume stable over the last 30 days', type: 'info' });
        }
      }

      return insights;
    });
  }

  private initTrendChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { dailyData, dailyLabels } = this.drawerData();
      return {
        labels: dailyLabels,
        datasets: [
          {
            data: dailyData,
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      };
    });
  }

  private initDomainChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { domainGroups } = this.drawerData();
      const sorted = [...domainGroups].sort((a, b) => b.totalSessions - a.totalSessions);
      return {
        labels: sorted.map((d) => d.domainGroup),
        datasets: [
          {
            data: sorted.map((d) => d.totalSessions),
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[400], lfxColors.blue[300], lfxColors.blue[200]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
