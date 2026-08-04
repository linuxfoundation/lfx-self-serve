// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { createBarChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import { computeMomPct, formatCurrency, formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  MarketingKeyInsight,
  MarketingRecommendedAction,
  PaidProjectBreakdownView,
  RevenueImpactAttributionChannelView,
  RevenueImpactChannelLegendView,
  RevenueImpactProjectBreakdownView,
  RevenueImpactResponse,
  SocialReachResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-paid-social-reach-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, SkeletonModule, TagComponent],
  templateUrl: './paid-social-reach-drawer.component.html',
  styleUrl: './paid-social-reach-drawer.component.scss',
})
export class PaidSocialReachDrawerComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  /** Revenue-impact payload — carries the paid-media project breakdown, channel mix
   *  and spend/revenue trend that this drawer renders below its own social-reach data. */
  public readonly data = input<RevenueImpactResponse>({
    pipelineInfluenced: 0,
    revenueAttributed: 0,
    matchRate: 0,
    changePercentage: 0,
    trend: 'up',
    attributionModels: { linear: 0, firstTouch: 0, lastTouch: 0 },
    engagementTypes: [],
    paidMedia: { roas: 0, impressions: 0, adSpend: 0, adRevenue: 0, monthlyTrend: [] },
    attributionChannels: [],
    projectBreakdown: [],
    eventRegistrationAttribution: { channelBreakdown: [], monthlyTrend: [] },
  });

  private static readonly channelBgClass: Record<string, string> = {
    google_ads: 'bg-blue-500',
    facebook_ads: 'bg-blue-700',
    microsoft_ads: 'bg-emerald-600',
    linkedin_ads: 'bg-gray-700',
    reddit_ads: 'bg-red-500',
    twitter_ads: 'bg-gray-500',
  };
  private static readonly channelBgFallback = 'bg-gray-400';

  protected readonly paidMediaTrendChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: { color: lfxColors.gray[700], font: { size: 11 }, boxWidth: 12, boxHeight: 12, padding: 12 },
      },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label ?? ''}: $${Number(ctx.parsed.y ?? 0).toLocaleString()}`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
      },
      y: {
        type: 'linear',
        position: 'left',
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        title: { display: true, text: 'Dollars ($)', color: lfxColors.gray[500], font: { size: 11 } },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const n = Number(value);
            if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
            return `$${n.toLocaleString()}`;
          },
        },
      },
    },
  };

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals (lazy-loaded data) ===
  protected readonly drawerData: Signal<SocialReachResponse> = this.initDrawerData();
  protected readonly formattedTotalReach: Signal<string> = computed(() => formatNumber(this.drawerData().totalReach));
  protected readonly formattedTotalRevenue: Signal<string> = computed(() => formatCurrency(this.drawerData().totalRevenue));
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();
  // The server zero-fills monthlyData for calendar alignment, so array length
  // no longer signals "no data" — presence of any campaign activity (spend or
  // impressions) does; an active window that delivered zero impressions still
  // warrants the chart rather than a "no data" state.
  protected readonly hasImpressionData: Signal<boolean> = computed(() => {
    const { monthlyData, monthlySpend } = this.drawerData();
    return monthlyData.some((v, i) => v > 0 || (monthlySpend?.[i] ?? 0) > 0);
  });
  protected readonly roasChartData: Signal<ChartData<'bar'>> = this.initRoasChartData();
  protected readonly hasRoasData: Signal<boolean> = computed(() => {
    const roas = this.drawerData().monthlyRoas;
    return !!roas && roas.some((v) => v > 0);
  });

  protected readonly chartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y ?? 0;
            if (val >= 1_000_000) return ` ${(val / 1_000_000).toFixed(1)}M impressions`;
            if (val >= 1_000) return ` ${(val / 1_000).toFixed(1)}K impressions`;
            return ` ${val.toLocaleString()} impressions`;
          },
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
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
    datasets: {
      bar: { barPercentage: 0.7, categoryPercentage: 0.9 },
    },
  });

  protected readonly roasChartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)}x ROAS`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => `${Number(value).toFixed(1)}x`,
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.7, categoryPercentage: 0.9 },
    },
  });

  protected readonly formatNumber = formatNumber;
  protected readonly formatCurrency = formatCurrency;

  // === Performance by Project ===
  /** Project rows the user has expanded to reveal their campaigns. */
  protected readonly expandedProjects = signal<Set<string>>(new Set());

  /**
   * Project rows with display strings, severity and expansion state precomputed.
   * Recomputes when either the data or the expanded set changes, so the template
   * only reads fields — no function calls, no Set.has() in bindings.
   */
  protected readonly projectRows: Signal<PaidProjectBreakdownView[]> = computed(() => {
    const expanded = this.expandedProjects();
    return (this.drawerData().projectBreakdown ?? []).map((p) => ({
      ...p,
      formattedSpend: `$${PaidSocialReachDrawerComponent.compact(p.spend)}`,
      formattedRevenue: `$${PaidSocialReachDrawerComponent.compact(p.revenue)}`,
      formattedConversions: PaidSocialReachDrawerComponent.compact(p.conversions),
      severity: PaidSocialReachDrawerComponent.severityFor(p.performance),
      hasCampaigns: p.campaigns.length > 0,
      expanded: expanded.has(p.projectName),
      campaignRows: p.campaigns.map((c) => ({
        ...c,
        formattedSpend: `$${PaidSocialReachDrawerComponent.compact(c.spend)}`,
        formattedRevenue: `$${PaidSocialReachDrawerComponent.compact(c.revenue)}`,
        formattedConversions: PaidSocialReachDrawerComponent.compact(c.conversions),
      })),
    }));
  });

  /** Conversions summed across every project. */
  protected readonly totalConversions: Signal<string> = computed(() => {
    const projects = this.drawerData().projectBreakdown ?? [];
    return formatNumber(projects.reduce((sum, p) => sum + p.conversions, 0));
  });

  /** Sessions summed across every project. */
  protected readonly totalSessions: Signal<string> = computed(() => {
    const projects = this.drawerData().projectBreakdown ?? [];
    return formatNumber(projects.reduce((sum, p) => sum + p.sessions, 0));
  });

  // === Paid media breakdown (from the revenueImpact input) ===
  protected readonly paidMediaTrendChartData: Signal<ChartData<'bar'>> = this.initPaidMediaTrendChartData();
  protected readonly projectBreakdownLegend: Signal<RevenueImpactChannelLegendView[]> = this.initProjectBreakdownLegend();
  protected readonly sortedProjectBreakdown: Signal<RevenueImpactProjectBreakdownView[]> = this.initSortedProjectBreakdown();
  protected readonly attributionChannelsView: Signal<RevenueImpactAttributionChannelView[]> = computed(() =>
    this.data().attributionChannels.map((c) => ({
      ...c,
      label: PaidSocialReachDrawerComponent.formatChannelLabel(c.channel),
      formattedPercentage: c.percentage.toFixed(1),
    }))
  );

  // === Protected Methods ===
  protected toggleProject(projectName: string): void {
    const current = this.expandedProjects();
    const next = new Set(current);
    if (next.has(projectName)) {
      next.delete(projectName);
    } else {
      next.add(projectName);
    }
    this.expandedProjects.set(next);
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  /** Compact number for dense table cells — 1.2K / 3.4M. */
  private static compact(value: number): string {
    if (value >= 999_950) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    // Locale pinned for SSR: an unpinned toLocaleString renders different separators
    // server-side vs client-side and trips hydration text mismatches.
    return value.toLocaleString('en-US');
  }

  private static severityFor(performance: string): 'danger' | 'warn' | 'success' | 'secondary' {
    if (performance === 'LOW OPENS' || performance === 'LOW CLICKS' || performance === 'POOR' || performance === 'NO REVENUE') return 'danger';
    if (performance === 'GOOD') return 'warn';
    if (performance === 'EXCELLENT' || performance === 'STRONG') return 'success';
    return 'secondary';
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<SocialReachResponse> {
    const defaultValue: SocialReachResponse = {
      totalReach: 0,
      roas: 0,
      totalSpend: 0,
      totalRevenue: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      monthlyRoas: [],
      channelGroups: [],
    };

    const visible$ = toObservable(this.visible);
    // Match the parent's fallback: the ED overview loads this card's data with 'tlf'
    // when no foundation is selected, so an empty slug here would filter the request
    // out and render an empty drawer behind a populated card.
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || 'tlf'));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.drawerLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getSocialReach(foundationSlug, undefined, 'last-6').pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load paid social reach details.',
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
      const { roas, totalSpend, totalRevenue, monthlyRoas, monthlyData, monthlySpend } = this.drawerData();
      // changePercentage from the API is ROAS MoM — impressions MoM must come
      // from the impressions series itself, or reach texts report the wrong metric.
      // The series is calendar zero-filled: a month is ACTIVE when it had spend
      // OR impressions — an active month that delivered zero impressions is a
      // real observation (its ~-100% MoM is a genuine alert), while a month
      // with neither is a spend gap that must not read as a reach decline.
      const monthActive = monthlyData.map((v, i) => v > 0 || (monthlySpend?.[i] ?? 0) > 0);
      const impressionsMomPct = (monthActive.at(-1) ?? false) ? computeMomPct(monthlyData) : null;
      const actions: MarketingRecommendedAction[] = [];

      // Losing money — the most urgent signal (includes 0.00x — spend with no attributed revenue)
      if (totalSpend > 0 && roas < 0.8) {
        const lost = totalSpend - totalRevenue;
        actions.push({
          title: 'Cut or pause losing campaigns',
          description: `ROAS is ${roas.toFixed(2)}x — ${formatCurrency(lost)} spent above revenue earned. Pause bottom-performing campaigns before next cycle`,
          priority: 'high',

          actionType: 'decline',
        });
      } else if (totalSpend > 0 && roas >= 0.8 && roas < 1) {
        actions.push({
          title: 'Campaigns at break-even',
          description: `ROAS is ${roas.toFixed(2)}x on ${formatCurrency(totalSpend)} spend — not yet profitable. Fix creative and targeting before scaling budget`,
          priority: 'medium',

          actionType: 'investigate',
        });
      }

      // ROAS trending down — separate from absolute level. All three months
      // must be ACTIVE (spend or impressions): inactive months are spend gaps
      // that must not fabricate a "3 months straight" streak, while a measured
      // 0x ROAS in an active month is a legitimate trend point.
      if (monthlyRoas && monthlyRoas.length >= 3 && monthActive.length === monthlyRoas.length) {
        const recent3 = monthlyRoas.slice(-3);
        const allActive = monthActive.slice(-3).every(Boolean);
        const falling = allActive && recent3[0] > recent3[1] && recent3[1] > recent3[2];
        const drop = recent3[0] - recent3[2];
        if (falling && drop >= 0.5) {
          actions.push({
            title: 'ROAS trending down 3 months straight',
            description: `ROAS fell from ${recent3[0].toFixed(2)}x to ${recent3[2].toFixed(2)}x over 3 months — investigate audience saturation and creative fatigue`,
            priority: 'medium',

            actionType: 'investigate',
          });
        }
      }

      // Reach drop — separate from ROAS
      if (impressionsMomPct !== null && impressionsMomPct <= -10) {
        actions.push({
          title: 'Investigate reach decline',
          description: `Impressions dropped ${Math.abs(impressionsMomPct).toFixed(1)}% MoM — review targeting, bid strategy, and platform algorithm changes`,
          priority: 'high',

          actionType: 'investigate',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { roas, totalReach, totalSpend, totalRevenue, monthlyRoas, monthlyData, monthlySpend } = this.drawerData();
      // changePercentage from the API is ROAS MoM — impressions texts must use
      // the impressions series' own MoM. A month is ACTIVE when it had spend
      // OR impressions; only an inactive trailing month (a spend gap) blocks
      // the MoM claim — active-but-zero-impression months are real data.
      const monthActive = monthlyData.map((v, i) => v > 0 || (monthlySpend?.[i] ?? 0) > 0);
      const impressionsMomPct = (monthActive.at(-1) ?? false) ? computeMomPct(monthlyData) : null;
      const insights: MarketingKeyInsight[] = [];

      if (totalReach === 0) {
        return insights;
      }

      // ROAS tiers
      if (roas >= 3) {
        insights.push({
          text: `Strong ROAS at ${roas.toFixed(2)}x — ${formatCurrency(totalRevenue)} revenue on ${formatCurrency(totalSpend)} spend`,
          type: 'driver',
        });
      } else if (roas >= 2) {
        insights.push({ text: `Healthy ROAS at ${roas.toFixed(2)}x — room to scale top campaigns`, type: 'driver' });
      } else if (roas >= 1 && totalSpend > 0) {
        insights.push({ text: `Profitable at ${roas.toFixed(2)}x ROAS — fix underperformers before scaling`, type: 'info' });
      }

      // Impressions trend
      // "grew to" must quote the latest MONTH's impressions — totalReach is the
      // whole window's cumulative figure, a different window than the MoM claim.
      // A prior ACTIVE month with zero impressions is a real baseline, but a
      // percentage from zero is undefined — report the rebound in absolute
      // terms instead of dropping the insight.
      const latestMonthImpressions = monthlyData.at(-1) ?? 0;
      const reboundFromActiveZero = (monthActive.at(-2) ?? false) && (monthlyData.at(-2) ?? 0) === 0 && latestMonthImpressions > 0;
      if (impressionsMomPct !== null && impressionsMomPct >= 10) {
        insights.push({ text: `Impressions grew ${impressionsMomPct.toFixed(1)}% MoM to ${formatNumber(latestMonthImpressions)}`, type: 'driver' });
      } else if (impressionsMomPct !== null && impressionsMomPct <= -5) {
        insights.push({ text: `Impressions declined ${Math.abs(impressionsMomPct).toFixed(1)}% MoM`, type: 'warning' });
      } else if (reboundFromActiveZero) {
        insights.push({ text: `Impressions rebounded from zero to ${formatNumber(latestMonthImpressions)} last month`, type: 'driver' });
      }

      // ROAS trend — streak claims require all three months to be ACTIVE
      // (spend or impressions): inactive months are spend gaps, while a
      // measured 0x ROAS in an active month is a real trend point.
      if (monthlyRoas && monthlyRoas.length >= 3 && monthActive.length === monthlyRoas.length) {
        const recent3 = monthlyRoas.slice(-3);
        const allActive = monthActive.slice(-3).every(Boolean);
        const isDecreasing = allActive && recent3[0] > recent3[1] && recent3[1] > recent3[2];
        const isIncreasing = allActive && recent3[0] < recent3[1] && recent3[1] < recent3[2];
        if (isIncreasing) {
          insights.push({ text: `ROAS improving 3 months straight — now at ${recent3[2].toFixed(2)}x`, type: 'driver' });
        } else if (isDecreasing) {
          insights.push({ text: `ROAS declining 3 months straight — now at ${recent3[2].toFixed(2)}x`, type: 'warning' });
        }
      }

      return insights;
    });
  }

  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyData, monthlyLabels } = this.drawerData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyData,
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
          },
        ],
      };
    });
  }

  private initRoasChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyRoas, monthlyLabels } = this.drawerData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyRoas || [],
            backgroundColor: lfxColors.emerald[500],
            borderRadius: 4,
          },
        ],
      };
    });
  }

  private initProjectBreakdownLegend(): Signal<RevenueImpactChannelLegendView[]> {
    return computed(() => {
      const channelTotals = new Map<string, number>();
      for (const r of this.data().projectBreakdown) {
        for (const [channel, impressions] of Object.entries(r.channelImpressions)) {
          channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + (impressions ?? 0));
        }
      }
      return Array.from(channelTotals.keys())
        .sort((a, b) => (channelTotals.get(b) ?? 0) - (channelTotals.get(a) ?? 0))
        .map((channel) => ({
          channel,
          label: PaidSocialReachDrawerComponent.formatChannelLabel(channel),
          bgClass: PaidSocialReachDrawerComponent.bgClassFor(channel),
        }));
    });
  }

  private initSortedProjectBreakdown(): Signal<RevenueImpactProjectBreakdownView[]> {
    return computed(() => {
      const legend = this.projectBreakdownLegend();
      return [...this.data().projectBreakdown]
        .sort((a, b) => b.totalImpressions - a.totalImpressions)
        .map((project) => {
          const segments = legend
            .map(({ channel, label, bgClass }) => {
              const impressions = project.channelImpressions[channel] ?? 0;
              const sharePercent = project.totalImpressions > 0 ? (impressions / project.totalImpressions) * 100 : 0;
              return {
                channel,
                bgClass,
                sharePercent,
                title: `${label}: ${PaidSocialReachDrawerComponent.formatImpressionsShort(impressions)}`,
              };
            })
            .filter((s) => s.sharePercent > 0);
          return {
            ...project,
            formattedTotalImpressions: PaidSocialReachDrawerComponent.formatImpressionsShort(project.totalImpressions),
            segments,
          };
        });
    });
  }

  private initPaidMediaTrendChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const trend = this.data().paidMedia.monthlyTrend;
      const labels = trend.map((r) => PaidSocialReachDrawerComponent.formatYearMonthLabel(r.month));
      return {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Spend',
            data: trend.map((r) => r.spend),
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
          },
          {
            type: 'bar',
            label: 'Revenue',
            data: trend.map((r) => r.revenue),
            backgroundColor: lfxColors.emerald[600],
            borderRadius: 4,
          },
        ],
      };
    });
  }

  private static formatChannelLabel(channel: string): string {
    return channel
      .split('_')
      .map((word) => (word === 'ads' ? 'Ads' : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  }

  private static formatImpressionsShort(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    // Locale pinned: this value is rendered into markup, so an unpinned call
    // produces different separators under SSR and trips hydration.
    return n.toLocaleString('en-US');
  }

  private static bgClassFor(channel: string): string {
    return PaidSocialReachDrawerComponent.channelBgClass[channel] ?? PaidSocialReachDrawerComponent.channelBgFallback;
  }

  private static formatYearMonthLabel(yearMonth: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
    if (!match) return yearMonth;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  }
}
