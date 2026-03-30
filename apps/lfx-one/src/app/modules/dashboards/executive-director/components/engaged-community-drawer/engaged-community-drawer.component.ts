// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
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
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EngagedCommunitySizeResponse, MarketingActionType, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-engaged-community-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DrawerModule, ChartComponent, TagComponent],
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
    breakdown: { newsletterSubscribers: 0, communityMembers: 0, workingGroupMembers: 0, certifiedIndividuals: 0 },
    monthlyData: [],
  });
  // === Computed Signals ===
  protected readonly formattedTotalMembers: Signal<string> = computed(() => formatNumber(this.data().totalMembers));
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() =>
    this.recommendedActions().filter((a) => a.priority === 'high' || a.priority === 'medium')
  );
  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.keyInsights().filter((i) => i.type === 'warning'));
  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.recommendedActions().filter((a) => a.priority === 'low'));
  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() =>
    this.keyInsights().filter((i) => i.type === 'driver' || i.type === 'info')
  );
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly breakdownChartData: Signal<ChartData<'bar'>> = this.initBreakdownChartData();

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
          label: (ctx) => ` ${formatNumber(ctx.parsed.x ?? 0)} members`,
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
          description: `Working group members are only ${((breakdown.workingGroupMembers / totalMembers) * 100).toFixed(0)}% of total — improve outreach to convert community members into active participants`,
          priority: 'high',
          dueLabel: 'This quarter',
          actionType: 'engagement',
        });
      }

      // Check for declining community
      if (changePercentage < -5) {
        actions.push({
          title: 'Address community decline',
          description: `Community size dropped ${Math.abs(changePercentage)}% — review engagement programs and onboarding flow`,
          priority: 'high',
          dueLabel: 'This month',
          actionType: 'decline',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue community growth strategy',
          description: `${formatNumber(totalMembers)} engaged members${changePercentage > 0 ? ` — growing ${changePercentage}%` : ''}`,
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
          { name: 'Community members', value: breakdown.communityMembers },
          { name: 'Working group members', value: breakdown.workingGroupMembers },
          { name: 'Certified individuals', value: breakdown.certifiedIndividuals },
        ].sort((a, b) => b.value - a.value);
        const topShare = (segments[0].value / totalMembers) * 100;
        insights.push({ text: `${segments[0].name} are the largest segment at ${topShare.toFixed(0)}% of total`, type: 'info' });
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

  private initBreakdownChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { breakdown } = this.data();
      return {
        labels: ['Community', 'Working Groups', 'Certified'],
        datasets: [
          {
            data: [breakdown.communityMembers, breakdown.workingGroupMembers, breakdown.certifiedIndividuals],
            backgroundColor: [lfxColors.blue[500], lfxColors.blue[300], lfxColors.blue[200]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
