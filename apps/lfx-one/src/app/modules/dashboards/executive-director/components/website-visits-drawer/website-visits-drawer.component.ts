// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { WebActivitiesSummaryResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-website-visits-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './website-visits-drawer.component.html',
})
export class WebsiteVisitsDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<WebActivitiesSummaryResponse>({
    totalSessions: 0,
    totalPageViews: 0,
    domainGroups: [],
    dailyData: [],
    dailyLabels: [],
  });

  // === Computed Signals ===
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly domainChartData: Signal<ChartData<'bar'>> = this.initDomainChartData();

  protected readonly trendChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
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
            if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
  };

  protected readonly domainChartOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
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
            if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
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
    datasets: {
      bar: { barPercentage: 0.8, categoryPercentage: 1.0 },
    },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected formatNumber(num: number): string {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  }

  // === Private Initializers ===
  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { totalSessions, totalPageViews, domainGroups, dailyData } = this.data();
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
            iconClass: 'fa-light fa-chart-line-down',
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
            iconClass: 'fa-light fa-diagram-project',
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
            iconClass: 'fa-light fa-link',
          });
        }
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue current strategy',
          description: `${this.formatNumber(totalSessions)} sessions with healthy traffic distribution`,
          priority: 'low',
          dueLabel: 'Ongoing',
          iconClass: 'fa-light fa-chart-line-up',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { totalSessions, totalPageViews, domainGroups, dailyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (totalSessions === 0 && dailyData.length === 0) {
        return insights;
      }

      // Pages per session
      if (totalSessions > 0) {
        const pagesPerSession = totalPageViews / totalSessions;
        insights.push({
          text: `${pagesPerSession.toFixed(1)} pages per session across ${this.formatNumber(totalSessions)} visits`,
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
      const { dailyData, dailyLabels } = this.data();
      return {
        labels: dailyLabels,
        datasets: [
          {
            data: dailyData,
            borderColor: lfxColors.blue[500],
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
      const { domainGroups } = this.data();
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
