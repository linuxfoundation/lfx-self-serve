// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { createHorizontalBarChartOptions, createLineChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import { formatNumber, hexToRgba, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { BrandReachResponse, EngagedCommunitySizeResponse, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-engaged-community-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, TagComponent, MarketingActionIconPipe],
  templateUrl: './engaged-community-drawer.component.html',
  styleUrl: './engaged-community-drawer.component.scss',
})
export class EngagedCommunityDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<EngagedCommunitySizeResponse>({
    totalMembers: 0,
    changePercentage: 0,
    trend: 'up',
    breakdown: {
      newsletterSubscribers: 0,
      communityMembers: 0,
      workingGroupMembers: 0,
      certifiedIndividuals: 0,
      webVisitors: 0,
      codeContributors: 0,
      trainingEnrollees: 0,
    },
    monthlyData: [],
  });
  public readonly brandReachData = input<BrandReachResponse>({
    totalSocialFollowers: 0,
    totalMonthlySessions: 0,
    activePlatforms: 0,
    changePercentage: 0,
    trend: 'up',
    socialPlatforms: [],
    websiteDomains: [],
    weeklyTrend: [],
  });
  // === Computed Signals ===
  protected readonly formattedTotalMembers: Signal<string> = computed(() => formatNumber(this.data().totalMembers));
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly breakdownChartData: Signal<ChartData<'bar'>> = this.initBreakdownChartData();
  protected readonly dailyTrendData: Signal<ChartData<'line'>> = this.initDailyTrendData();

  protected readonly trendChartOptions: ChartOptions<'line'> = createLineChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${formatNumber(ctx.parsed.y ?? 0)} members`,
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
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
  });

  protected readonly breakdownChartOptions: ChartOptions<'bar'> = createHorizontalBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => {
            const raw = ctx.raw as number;
            // Sentinel 0.5 = original 0 (clamped for log scale); real 1s stay at 1
            return ` ${formatNumber(raw < 1 ? 0 : raw)} members`;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'logarithmic',
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (!Number.isFinite(num) || num <= 0) return '';
            // Only label powers of 10 to avoid overlap on log scale
            const log = Math.log10(num);
            if (Math.abs(log - Math.round(log)) > 0.01) return '';
            if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(0)}M`;
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

  protected readonly dailyTrendOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true, mode: 'index', intersect: false },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          maxTicksLimit: 6,
        },
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
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
  };

  protected readonly formatNumber = formatNumber;

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { totalMembers, changePercentage, breakdown, monthlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (totalMembers === 0 && monthlyData.length === 0) {
        return actions;
      }

      // MoM drop — actionable when large
      if (changePercentage <= -5) {
        actions.push({
          title: 'Address community decline',
          description: `Engaged community dropped ${Math.abs(changePercentage).toFixed(1)}% vs last month — review engagement programs and onboarding flow`,
          priority: 'high',
          dueLabel: 'This month',
          actionType: 'decline',
        });
      }

      // Working group is the deepest engagement signal — flag floor
      if (totalMembers > 0) {
        const wgShare = (breakdown.workingGroupMembers / totalMembers) * 100;
        if (wgShare < 10) {
          actions.push({
            title: 'Grow working group participation',
            description: `Working groups hold only ${wgShare.toFixed(0)}% of engaged members (${formatNumber(breakdown.workingGroupMembers)}) — convert passive community members into active contributors`,
            priority: 'medium',
            dueLabel: 'This quarter',
            actionType: 'engagement',
          });
        }
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { totalMembers, changePercentage, breakdown, monthlyData } = this.data();
      const brand = this.brandReachData();
      const insights: MarketingKeyInsight[] = [];

      if (totalMembers === 0 && monthlyData.length === 0) {
        return insights;
      }

      // MoM headline
      if (changePercentage >= 5) {
        insights.push({ text: `Engaged community grew ${changePercentage.toFixed(1)}% MoM to ${formatNumber(totalMembers)}`, type: 'driver' });
      } else if (changePercentage <= -2) {
        insights.push({ text: `Engaged community declined ${Math.abs(changePercentage).toFixed(1)}% MoM`, type: 'warning' });
      }

      // 3-month consistent growth
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].value < recent3[1].value && recent3[1].value < recent3[2].value;
        if (isGrowing) {
          insights.push({ text: 'Engaged community growing for 3 consecutive months', type: 'driver' });
        }
      }

      // Segment composition — keep in sync with initBreakdownChartData (all 7 engagement channels)
      if (totalMembers > 0) {
        const segments = [
          { name: 'Community members', value: breakdown.communityMembers },
          { name: 'Working group members', value: breakdown.workingGroupMembers },
          { name: 'Certified individuals', value: breakdown.certifiedIndividuals },
          { name: 'Web visitors', value: breakdown.webVisitors },
          { name: 'Code contributors', value: breakdown.codeContributors },
          { name: 'Training enrollees', value: breakdown.trainingEnrollees },
          { name: 'Newsletter subscribers', value: breakdown.newsletterSubscribers },
        ].sort((a, b) => b.value - a.value);
        const top = segments[0];
        const topShare = (top.value / totalMembers) * 100;
        insights.push({ text: `${top.name} are the largest segment (${formatNumber(top.value)}, ${topShare.toFixed(0)}%)`, type: 'info' });
      }

      // Weekly sessions — drawer renders 6-month weekly chart, compare recent 4 weeks vs prior 4
      if (brand.weeklyTrend.length >= 8) {
        const recent4 = brand.weeklyTrend.slice(-4).reduce((s, d) => s + d.sessions, 0);
        const prior4 = brand.weeklyTrend.slice(-8, -4).reduce((s, d) => s + d.sessions, 0);
        if (prior4 === 0 && recent4 > 0) {
          insights.push({
            text: `Weekly sessions started growing from a zero baseline (${formatNumber(recent4)} last 4 weeks)`,
            type: 'driver',
          });
        } else if (prior4 > 0) {
          const monthDelta = ((recent4 - prior4) / prior4) * 100;
          if (monthDelta >= 10) {
            insights.push({ text: `Weekly sessions up ${monthDelta.toFixed(0)}% vs prior month (${formatNumber(recent4)} last 4 weeks)`, type: 'driver' });
          } else if (monthDelta <= -10) {
            insights.push({
              text: `Weekly sessions down ${Math.abs(monthDelta).toFixed(0)}% vs prior month — investigate content or promotion changes`,
              type: 'warning',
            });
          }
        }
      }

      return insights;
    });
  }

  private initTrendChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { monthlyData } = this.data();
      return {
        labels: monthlyData.map((d) => d.month),
        datasets: [
          {
            data: monthlyData.map((d) => d.value),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
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

  private initDailyTrendData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { weeklyTrend } = this.brandReachData();
      return {
        labels: weeklyTrend.map((d) => d.week),
        datasets: [
          {
            data: weeklyTrend.map((d) => d.sessions),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      };
    });
  }

  private initBreakdownChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { breakdown } = this.data();
      return {
        labels: ['Community', 'Working Groups', 'Newsletter', 'Training', 'Code', 'Web', 'Certified'],
        datasets: [
          {
            // Clamp to 0.5 (not 1) for log scale rendering so original 0s
            // are distinguishable from real 1s. Tooltip uses raw < 1 to
            // map the sentinel back to 0.
            data: [
              breakdown.communityMembers,
              breakdown.workingGroupMembers,
              breakdown.newsletterSubscribers,
              breakdown.trainingEnrollees,
              breakdown.codeContributors,
              breakdown.webVisitors,
              breakdown.certifiedIndividuals,
            ].map((v) => Math.max(v, 0.5)),
            backgroundColor: [
              lfxColors.blue[700],
              lfxColors.blue[500],
              lfxColors.blue[400],
              lfxColors.blue[300],
              lfxColors.emerald[600],
              lfxColors.emerald[500],
              lfxColors.emerald[400],
            ],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
