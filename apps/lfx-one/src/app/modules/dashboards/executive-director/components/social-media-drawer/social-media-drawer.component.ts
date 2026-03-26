// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { SocialMediaResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-social-media-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './social-media-drawer.component.html',
})
export class SocialMediaDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<SocialMediaResponse>({
    totalFollowers: 0,
    totalPlatforms: 0,
    changePercentage: 0,
    trend: 'up',
    platforms: [],
    monthlyData: [],
  });

  // === Computed Signals ===
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly followerTrendChartData: Signal<ChartData<'line'>> = this.initFollowerTrendChartData();
  protected readonly platformChartData: Signal<ChartData<'bar'>> = this.initPlatformChartData();

  protected readonly followerTrendChartOptions: ChartOptions<'line'> = {
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
          label: (ctx) => {
            const val = ctx.parsed.y ?? 0;
            return ` ${this.formatNumber(val)} followers`;
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
            if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
  };

  protected readonly platformChartOptions: ChartOptions<'bar'> = {
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
          label: (ctx) => {
            const val = ctx.parsed.x ?? 0;
            return ` ${this.formatNumber(val)} followers`;
          },
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
      const { platforms, changePercentage, totalFollowers } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (platforms.length === 0 && totalFollowers === 0) {
        return actions;
      }

      // Find platform with high engagement but low posting
      const highEngageLowPost = [...platforms]
        .filter((p) => p.engagementRate > 0 && p.postsLast30Days > 0)
        .sort((a, b) => b.engagementRate - a.engagementRate)
        .find((p) => {
          const avgPosts = platforms.reduce((s, pl) => s + pl.postsLast30Days, 0) / platforms.length;
          return p.postsLast30Days < avgPosts * 0.7;
        });

      if (highEngageLowPost) {
        actions.push({
          title: `Increase posting on ${highEngageLowPost.platform}`,
          description: `${highEngageLowPost.engagementRate.toFixed(1)}% engagement rate but only ${highEngageLowPost.postsLast30Days} posts in 30 days`,
          priority: 'high',
          dueLabel: 'This week',
          iconClass: 'fa-light fa-calendar-plus',
        });
      }

      if (changePercentage < -5) {
        actions.push({
          title: 'Address follower decline',
          description: `Followers dropped ${Math.abs(changePercentage)}% — review content strategy and posting cadence`,
          priority: 'high',
          dueLabel: 'This week',
          iconClass: 'fa-light fa-user-minus',
        });
      }

      // Find low-engagement platform with many followers
      if (platforms.length > 1) {
        const sorted = [...platforms].sort((a, b) => a.engagementRate - b.engagementRate);
        const lowest = sorted[0];
        if (lowest.engagementRate > 0 && lowest.followers > totalFollowers * 0.2) {
          actions.push({
            title: `Boost engagement on ${lowest.platform}`,
            description: `${this.formatNumber(lowest.followers)} followers but only ${lowest.engagementRate.toFixed(1)}% engagement — try interactive content`,
            priority: 'medium',
            dueLabel: 'This month',
            iconClass: 'fa-light fa-comments',
          });
        }
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue growth strategy',
          description: `${this.formatNumber(totalFollowers)} followers across ${platforms.length} platforms${changePercentage > 0 ? ` — growing ${changePercentage}%` : ''}`,
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
      const { totalFollowers, changePercentage, platforms, monthlyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (totalFollowers === 0 && platforms.length === 0) {
        return insights;
      }

      // Follower trend
      if (changePercentage > 5) {
        insights.push({ text: `Followers grew ${changePercentage}% month-over-month`, type: 'driver' });
      } else if (changePercentage < -5) {
        insights.push({ text: `Followers declined ${Math.abs(changePercentage)}% month-over-month`, type: 'warning' });
      } else if (changePercentage !== 0) {
        insights.push({ text: `Followers ${changePercentage > 0 ? 'up' : 'down'} ${Math.abs(changePercentage)}% — relatively stable`, type: 'info' });
      }

      // Best engagement platform
      if (platforms.length > 0) {
        const byEngagement = [...platforms].filter((p) => p.engagementRate > 0).sort((a, b) => b.engagementRate - a.engagementRate);
        if (byEngagement.length > 0) {
          insights.push({ text: `${byEngagement[0].platform} leads engagement at ${byEngagement[0].engagementRate.toFixed(1)}%`, type: 'driver' });
        }
      }

      // Platform concentration
      if (platforms.length > 1 && totalFollowers > 0) {
        const sorted = [...platforms].sort((a, b) => b.followers - a.followers);
        const topShare = (sorted[0].followers / totalFollowers) * 100;
        if (topShare > 70) {
          insights.push({ text: `${topShare.toFixed(0)}% of followers on ${sorted[0].platform} — audience concentration risk`, type: 'warning' });
        } else {
          insights.push({ text: `Audience spread across ${platforms.length} platforms — healthy diversification`, type: 'info' });
        }
      }

      // Monthly trend
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].totalFollowers < recent3[1].totalFollowers && recent3[1].totalFollowers < recent3[2].totalFollowers;
        const isShrinking = recent3[0].totalFollowers > recent3[1].totalFollowers && recent3[1].totalFollowers > recent3[2].totalFollowers;
        if (isGrowing) {
          insights.push({ text: 'Follower count growing for 3 consecutive months', type: 'driver' });
        } else if (isShrinking) {
          insights.push({ text: 'Follower count declining for 3 consecutive months', type: 'warning' });
        }
      }

      return insights;
    });
  }

  private initFollowerTrendChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { monthlyData } = this.data();
      return {
        labels: monthlyData.map((d) => d.month),
        datasets: [
          {
            data: monthlyData.map((d) => d.totalFollowers),
            borderColor: lfxColors.blue[500],
            backgroundColor: `${lfxColors.blue[500]}1A`,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: lfxColors.blue[500],
          },
        ],
      };
    });
  }

  private initPlatformChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { platforms } = this.data();
      const sorted = [...platforms].sort((a, b) => b.followers - a.followers);
      return {
        labels: sorted.map((p) => p.platform),
        datasets: [
          {
            data: sorted.map((p) => p.followers),
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[400], lfxColors.blue[300], lfxColors.blue[200]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
