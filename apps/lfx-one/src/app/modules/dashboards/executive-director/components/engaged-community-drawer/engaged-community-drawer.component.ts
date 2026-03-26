// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EngagedCommunitySizeResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-engaged-community-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './engaged-community-drawer.component.html',
})
export class EngagedCommunityDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<EngagedCommunitySizeResponse>({
    totalMembers: 0,
    changePercentage: 0,
    trend: 'up',
    breakdown: { newsletterSubscribers: 0, communityMembers: 0, workingGroupMembers: 0 },
    monthlyData: [],
  });

  // === Computed Signals ===
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly breakdownChartData: Signal<ChartData<'bar'>> = this.initBreakdownChartData();

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
          label: (ctx) => ` ${this.formatNumber(ctx.parsed.y ?? 0)} members`,
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
  };

  protected readonly breakdownChartOptions: ChartOptions<'bar'> = {
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
          label: (ctx) => ` ${this.formatNumber(ctx.parsed.x ?? 0)} members`,
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
      const { totalMembers, changePercentage, breakdown, monthlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (totalMembers === 0 && monthlyData.length === 0) {
        return actions;
      }

      // Check if working groups are underrepresented
      if (totalMembers > 0 && breakdown.workingGroupMembers < totalMembers * 0.1) {
        actions.push({
          title: 'Increase working group participation',
          description: `Working group members are only ${((breakdown.workingGroupMembers / totalMembers) * 100).toFixed(0)}% of total — convert newsletter subscribers through targeted outreach`,
          priority: 'high',
          dueLabel: 'This quarter',
          iconClass: 'fa-light fa-user-group',
        });
      }

      // Check for declining community
      if (changePercentage < -5) {
        actions.push({
          title: 'Address community decline',
          description: `Community size dropped ${Math.abs(changePercentage)}% — review engagement programs and onboarding flow`,
          priority: 'high',
          dueLabel: 'This month',
          iconClass: 'fa-light fa-chart-line-down',
        });
      }

      // Check if newsletter dominates (concentration risk)
      if (totalMembers > 0 && breakdown.newsletterSubscribers > totalMembers * 0.7) {
        actions.push({
          title: 'Diversify engagement beyond newsletter',
          description: `${((breakdown.newsletterSubscribers / totalMembers) * 100).toFixed(0)}% of community is newsletter-only — create pathways to deeper participation`,
          priority: 'medium',
          dueLabel: 'Next quarter',
          iconClass: 'fa-light fa-arrows-split-up-and-left',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue community growth strategy',
          description: `${this.formatNumber(totalMembers)} engaged members${changePercentage > 0 ? ` — growing ${changePercentage}%` : ''}`,
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
      const { totalMembers, changePercentage, breakdown, monthlyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (totalMembers === 0 && monthlyData.length === 0) {
        return insights;
      }

      // Growth trend
      if (changePercentage > 5) {
        insights.push({ text: `Community grew ${changePercentage}% month-over-month`, type: 'driver' });
      } else if (changePercentage < -5) {
        insights.push({ text: `Community declined ${Math.abs(changePercentage)}% month-over-month`, type: 'warning' });
      } else if (changePercentage !== 0) {
        insights.push({ text: `Community ${changePercentage > 0 ? 'up' : 'down'} ${Math.abs(changePercentage)}% — relatively stable`, type: 'info' });
      }

      // Largest segment
      if (totalMembers > 0) {
        const segments = [
          { name: 'Newsletter subscribers', value: breakdown.newsletterSubscribers },
          { name: 'Community members', value: breakdown.communityMembers },
          { name: 'Working group members', value: breakdown.workingGroupMembers },
        ].sort((a, b) => b.value - a.value);
        const topShare = (segments[0].value / totalMembers) * 100;
        insights.push({ text: `${segments[0].name} are the largest segment at ${topShare.toFixed(0)}% of total`, type: topShare > 70 ? 'warning' : 'info' });
      }

      // Monthly trend consistency
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].value < recent3[1].value && recent3[1].value < recent3[2].value;
        const isShrinking = recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
        if (isGrowing) {
          insights.push({ text: 'Community growing for 3 consecutive months', type: 'driver' });
        } else if (isShrinking) {
          insights.push({ text: 'Community declining for 3 consecutive months', type: 'warning' });
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

  private initBreakdownChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { breakdown } = this.data();
      return {
        labels: ['Newsletter', 'Community', 'Working Groups'],
        datasets: [
          {
            data: [breakdown.newsletterSubscribers, breakdown.communityMembers, breakdown.workingGroupMembers],
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[300]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
