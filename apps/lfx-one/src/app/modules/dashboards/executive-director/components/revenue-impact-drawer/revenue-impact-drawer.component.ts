// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import { splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  EventRegistrationAttributionChannelView,
  MarketingKeyInsight,
  MarketingRecommendedAction,
  RevenueImpactAttributionChannelView,
  RevenueImpactChannelLegendView,
  RevenueImpactProjectBreakdownView,
  RevenueImpactResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-revenue-impact-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, ChartComponent, DecimalPipe, DrawerModule, TagComponent],
  templateUrl: './revenue-impact-drawer.component.html',
})
export class RevenueImpactDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
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

  // === Static Config ===
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

  protected readonly eventAttrChartOptions: ChartOptions<'bar'> = {
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
          label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y ?? 0).toLocaleString()} sessions`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
      },
      y: {
        stacked: true,
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        title: { display: true, text: 'Sessions', color: lfxColors.gray[500], font: { size: 11 } },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const n = Number(value);
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
            return n.toString();
          },
        },
      },
    },
  };

  // === WritableSignals ===
  protected readonly eventAttrSortBy = signal<'revenue' | 'sessions' | 'visitors'>('revenue');

  // === Computed Signals ===
  protected readonly paidMediaTrendChartData: Signal<ChartData<'bar'>> = this.initPaidMediaTrendChartData();
  protected readonly eventAttrChartData: Signal<ChartData<'bar'>> = this.initEventAttrChartData();
  protected readonly projectBreakdownLegend: Signal<RevenueImpactChannelLegendView[]> = this.initProjectBreakdownLegend();
  protected readonly sortedProjectBreakdown: Signal<RevenueImpactProjectBreakdownView[]> = this.initSortedProjectBreakdown();
  protected readonly sortedEventAttrChannels: Signal<EventRegistrationAttributionChannelView[]> = this.initSortedEventAttrChannels();
  protected readonly attributionChannelsView: Signal<RevenueImpactAttributionChannelView[]> = computed(() =>
    this.data().attributionChannels.map((c) => ({
      ...c,
      label: RevenueImpactDrawerComponent.formatChannelLabel(c.channel),
      formattedPercentage: c.percentage.toFixed(1),
    }))
  );
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);

  protected onClose(): void {
    this.visible.set(false);
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
          label: RevenueImpactDrawerComponent.formatChannelLabel(channel),
          bgClass: RevenueImpactDrawerComponent.bgClassFor(channel),
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
                title: `${label}: ${RevenueImpactDrawerComponent.formatImpressionsShort(impressions)}`,
              };
            })
            .filter((s) => s.sharePercent > 0);
          return {
            ...project,
            formattedTotalImpressions: RevenueImpactDrawerComponent.formatImpressionsShort(project.totalImpressions),
            segments,
          };
        });
    });
  }

  private initSortedEventAttrChannels(): Signal<EventRegistrationAttributionChannelView[]> {
    return computed(() => {
      const rows = [...this.data().eventRegistrationAttribution.channelBreakdown];
      const sortBy = this.eventAttrSortBy();
      return rows
        .sort((a, b) => {
          if (sortBy === 'revenue') return b.lastTouchRevenue - a.lastTouchRevenue;
          if (sortBy === 'visitors') return b.uniqueVisitors - a.uniqueVisitors;
          return b.sessions - a.sessions;
        })
        .map((row) => ({ ...row, formattedLastTouchRevenue: RevenueImpactDrawerComponent.formatLastTouchRevenue(row.lastTouchRevenue) }));
    });
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { attributionChannels, paidMedia, projectBreakdown, eventRegistrationAttribution } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (paidMedia.adSpend > 0 && paidMedia.roas > 0 && paidMedia.roas < 0.8) {
        const lost = paidMedia.adSpend - paidMedia.adRevenue;
        actions.push({
          title: 'Cut or pause losing paid campaigns',
          description: `Paid ROAS is ${paidMedia.roas.toFixed(2)}x — ${RevenueImpactDrawerComponent.formatRevenue(lost)} spent above revenue earned. Review top-spending campaigns and pause underperformers`,
          priority: 'high',

          actionType: 'decline',
        });
      } else if (paidMedia.adSpend > 0 && paidMedia.roas >= 0.8 && paidMedia.roas < 1) {
        actions.push({
          title: 'Paid media at break-even',
          description: `ROAS is ${paidMedia.roas.toFixed(2)}x on ${RevenueImpactDrawerComponent.formatRevenue(paidMedia.adSpend)} spend — optimize creative and targeting before scaling`,
          priority: 'medium',

          actionType: 'investigate',
        });
      }

      if (attributionChannels.length > 0) {
        const top = [...attributionChannels].sort((a, b) => b.percentage - a.percentage)[0];
        if (top.percentage > 70) {
          actions.push({
            title: 'Reduce channel concentration risk',
            description: `${RevenueImpactDrawerComponent.formatChannelLabel(top.channel)} drives ${top.percentage.toFixed(0)}% of paid impressions — one algorithm change could cut reach in half. Grow at least one alternate channel`,
            priority: 'high',

            actionType: 'decline',
          });
        } else if (top.percentage > 55) {
          actions.push({
            title: 'Watch channel concentration',
            description: `${RevenueImpactDrawerComponent.formatChannelLabel(top.channel)} is ${top.percentage.toFixed(0)}% of paid impressions — diversify before it crosses 70%`,
            priority: 'medium',

            actionType: 'engagement',
          });
        }
      }

      if (projectBreakdown.length >= 2) {
        const heavilyConcentrated = projectBreakdown.filter((p) => {
          if (!p.totalImpressions) return false;
          const max = Math.max(...Object.values(p.channelImpressions));
          return max / p.totalImpressions > 0.8;
        });
        if (heavilyConcentrated.length >= 2) {
          actions.push({
            title: 'Rebalance project-level channel mix',
            description: `${heavilyConcentrated.length} projects get 80%+ of their paid reach from a single channel — rebalance to reduce per-project platform dependency`,
            priority: 'medium',

            actionType: 'engagement',
          });
        }
      }

      if (eventRegistrationAttribution.channelBreakdown.length > 0) {
        const totalEventRev = eventRegistrationAttribution.channelBreakdown.reduce((s, c) => s + (c.lastTouchRevenue ?? 0), 0);
        if (totalEventRev > 0) {
          const topEvt = [...eventRegistrationAttribution.channelBreakdown].sort((a, b) => (b.lastTouchRevenue ?? 0) - (a.lastTouchRevenue ?? 0))[0];
          const topShare = ((topEvt.lastTouchRevenue ?? 0) / totalEventRev) * 100;
          if (topShare > 70) {
            actions.push({
              title: 'Event registration revenue over-concentrated',
              description: `${topEvt.channel} drove ${topShare.toFixed(0)}% of event-registration last-touch revenue (${RevenueImpactDrawerComponent.formatRevenue(topEvt.lastTouchRevenue ?? 0)}) — grow alternate acquisition paths for event revenue`,
              priority: 'medium',

              actionType: 'engagement',
            });
          }
        }
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { attributionChannels, paidMedia, eventRegistrationAttribution } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (paidMedia.adSpend > 0 && paidMedia.roas >= 3) {
        insights.push({
          text: `Paid media ROAS at ${paidMedia.roas.toFixed(1)}x — ${RevenueImpactDrawerComponent.formatRevenue(paidMedia.adRevenue)} revenue on ${RevenueImpactDrawerComponent.formatRevenue(paidMedia.adSpend)} spend`,
          type: 'driver',
        });
      } else if (paidMedia.adSpend > 0 && paidMedia.roas >= 1) {
        insights.push({
          text: `Paid media profitable at ${paidMedia.roas.toFixed(2)}x ROAS — room to optimize before scaling`,
          type: 'info',
        });
      }

      if (paidMedia.monthlyTrend.length >= 3) {
        const recent3 = paidMedia.monthlyTrend.slice(-3);
        const isRisingRev = recent3[0].revenue < recent3[1].revenue && recent3[1].revenue < recent3[2].revenue;
        const isFallingRev = recent3[0].revenue > recent3[1].revenue && recent3[1].revenue > recent3[2].revenue && recent3[0].revenue > 0;
        if (isRisingRev) {
          insights.push({ text: 'Paid-attributed revenue rising for 3 consecutive months', type: 'driver' });
        } else if (isFallingRev) {
          insights.push({ text: 'Paid-attributed revenue falling for 3 consecutive months', type: 'warning' });
        }
      }

      if (attributionChannels.length > 0) {
        const top = [...attributionChannels].sort((a, b) => b.percentage - a.percentage)[0];
        insights.push({
          text: `${RevenueImpactDrawerComponent.formatChannelLabel(top.channel)} leads paid impressions at ${top.percentage.toFixed(0)}%`,
          type: 'info',
        });
        if (attributionChannels.length >= 3 && attributionChannels.every((c) => c.percentage < 45)) {
          insights.push({ text: `Balanced paid mix — no channel above 45% across ${attributionChannels.length} channels`, type: 'driver' });
        }
      }

      if (eventRegistrationAttribution.channelBreakdown.length > 0) {
        const totalEventRev = eventRegistrationAttribution.channelBreakdown.reduce((s, c) => s + (c.lastTouchRevenue ?? 0), 0);
        if (totalEventRev > 0) {
          const topEvt = [...eventRegistrationAttribution.channelBreakdown].sort((a, b) => (b.lastTouchRevenue ?? 0) - (a.lastTouchRevenue ?? 0))[0];
          insights.push({
            text: `${topEvt.channel} drove ${RevenueImpactDrawerComponent.formatRevenue(topEvt.lastTouchRevenue ?? 0)} in event-registration last-touch revenue`,
            type: 'info',
          });
        }
      }

      return insights;
    });
  }

  private initPaidMediaTrendChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const trend = this.data().paidMedia.monthlyTrend;
      const labels = trend.map((r) => RevenueImpactDrawerComponent.formatYearMonthLabel(r.month));
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

  private initEventAttrChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const rows = this.data().eventRegistrationAttribution.monthlyTrend;
      if (rows.length === 0) {
        return { labels: [], datasets: [] };
      }

      const palette: Record<string, string> = {
        'Paid Search': lfxColors.blue[500],
        'Email/HubSpot': lfxColors.emerald[600],
        'Organic Search': lfxColors.blue[700],
        'Direct/Unknown': lfxColors.gray[500],
        Social: lfxColors.emerald[400],
        'Other Tracked': lfxColors.amber[500],
        'Internal/Banner': lfxColors.gray[700],
      };
      const fallbackColor = lfxColors.gray[400];

      const channelTotals = new Map<string, number>();
      const monthChannelSessions = new Map<string, number>();
      const monthSetRaw = new Set<string>();
      for (const r of rows) {
        monthSetRaw.add(r.month);
        channelTotals.set(r.channel, (channelTotals.get(r.channel) ?? 0) + r.sessions);
        monthChannelSessions.set(`${r.month}|${r.channel}`, r.sessions);
      }

      const monthSet = Array.from(monthSetRaw).sort();
      const channels = Array.from(channelTotals.keys()).sort((a, b) => (channelTotals.get(b) ?? 0) - (channelTotals.get(a) ?? 0));

      const labels = monthSet.map((m) => RevenueImpactDrawerComponent.formatYearMonthLabel(m));

      const datasets = channels.map((channel) => ({
        label: channel,
        data: monthSet.map((m) => monthChannelSessions.get(`${m}|${channel}`) ?? 0),
        backgroundColor: palette[channel] ?? fallbackColor,
        borderRadius: 2,
        borderSkipped: false,
      }));

      return { labels, datasets };
    });
  }

  private static formatRevenue(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toLocaleString()}`;
  }

  private static formatLastTouchRevenue(value: number): string {
    if (value <= 0) return '—';
    return RevenueImpactDrawerComponent.formatRevenue(value);
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
    return n.toLocaleString();
  }

  private static bgClassFor(channel: string): string {
    return RevenueImpactDrawerComponent.channelBgClass[channel] ?? RevenueImpactDrawerComponent.channelBgFallback;
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
