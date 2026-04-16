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
import type { FlywheelConversionResponse, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-flywheel-conversion-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, TagComponent, MarketingActionIconPipe],
  templateUrl: './flywheel-conversion-drawer.component.html',
  styleUrl: './flywheel-conversion-drawer.component.scss',
})
export class FlywheelConversionDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<FlywheelConversionResponse>({
    conversionRate: 0,
    changePercentage: 0,
    trend: 'up',
    funnel: {
      eventAttendees: 0,
      convertedToNewsletter: 0,
      convertedToCommunity: 0,
      convertedToWorkingGroup: 0,
      convertedToTraining: 0,
      convertedToCode: 0,
      convertedToWeb: 0,
    },
    reengagement: {
      totalReengaged: 0,
      reengagementRate: 0,
      reengagementMomChange: 0,
      reengagedToNewsletter: 0,
      reengagedToCommunity: 0,
      reengagedToWorkingGroup: 0,
      reengagedToTraining: 0,
      reengagedToCode: 0,
      reengagedToWeb: 0,
    },
    monthlyData: [],
  });

  private readonly defaultReengagement: NonNullable<FlywheelConversionResponse['reengagement']> = {
    totalReengaged: 0,
    reengagementRate: 0,
    reengagementMomChange: 0,
    reengagedToNewsletter: 0,
    reengagedToCommunity: 0,
    reengagedToWorkingGroup: 0,
    reengagedToTraining: 0,
    reengagedToCode: 0,
    reengagedToWeb: 0,
  };

  // === Computed Signals ===
  protected readonly formattedEventAttendees: Signal<string> = computed(() => formatNumber(this.data().funnel.eventAttendees));
  protected readonly reengagement: Signal<NonNullable<FlywheelConversionResponse['reengagement']>> = computed(
    () => this.data().reengagement ?? this.defaultReengagement
  );
  protected readonly reengagementRate: Signal<string> = computed(() => `${this.reengagement().reengagementRate.toFixed(1)}%`);
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly funnelChartData: Signal<ChartData<'bar'>> = this.initFunnelChartData();

  protected readonly trendChartOptions: ChartOptions<'line'> = createLineChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${formatNumber(ctx.parsed.y ?? 0)} re-engaged`,
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
          callback: (value) => formatNumber(Number(value)),
        },
      },
    },
  });

  protected readonly funnelChartOptions: ChartOptions<'bar'> = createHorizontalBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${formatNumber(ctx.parsed.x ?? 0)} people`,
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

  // === Private Initializers ===
  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { conversionRate, funnel, monthlyData } = this.data();
      const reengagement = this.reengagement();
      const actions: MarketingRecommendedAction[] = [];

      if (conversionRate === 0 && funnel.eventAttendees === 0 && monthlyData.length === 0) {
        return actions;
      }

      // Low WG re-engagement relative to community re-engagement
      if (funnel.eventAttendees > 0 && reengagement.reengagedToWorkingGroup > 0 && reengagement.reengagedToCommunity > 0) {
        const wgRate = (reengagement.reengagedToWorkingGroup / funnel.eventAttendees) * 100;
        const communityRate = (reengagement.reengagedToCommunity / funnel.eventAttendees) * 100;
        if (wgRate < communityRate * 0.5) {
          actions.push({
            title: 'Improve working group re-engagement path',
            description: `WG re-engagement at ${wgRate.toFixed(1)}% vs ${communityRate.toFixed(1)}% for community — attendees need clearer path to participate`,
            priority: 'high',
            dueLabel: 'This quarter',
            actionType: 'conversion',
          });
        }
      }

      // Declining re-engagement rate
      if (reengagement.reengagementMomChange < -5) {
        actions.push({
          title: 'Address re-engagement rate decline',
          description: `Re-engagement dropped ${Math.abs(reengagement.reengagementMomChange).toFixed(1)}% MoM — review post-event follow-up effectiveness`,
          priority: 'high',
          dueLabel: 'This month',
          actionType: 'decline',
        });
      }

      // Low overall re-engagement
      if (reengagement.reengagementRate > 0 && reengagement.reengagementRate < 10 && funnel.eventAttendees > 0) {
        actions.push({
          title: 'Add post-event engagement CTAs',
          description: `Only ${reengagement.reengagementRate.toFixed(1)}% re-engagement — add community join and working group prompts to event follow-ups`,
          priority: 'medium',
          dueLabel: 'Next event',
          actionType: 'content',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue flywheel optimization',
          description: `${reengagement.reengagementRate.toFixed(1)}% re-engagement rate${reengagement.reengagementMomChange > 0 ? ` — improving ${reengagement.reengagementMomChange.toFixed(1)}%` : ''} across ${formatNumber(funnel.eventAttendees)} attendees`,
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
      const { conversionRate, funnel, monthlyData } = this.data();
      const reengagement = this.reengagement();
      const insights: MarketingKeyInsight[] = [];

      if (conversionRate === 0 && funnel.eventAttendees === 0 && monthlyData.length === 0) {
        return insights;
      }

      // Best re-engagement path
      if (funnel.eventAttendees > 0) {
        const paths = [
          { name: 'Community', value: reengagement.reengagedToCommunity },
          { name: 'Working group', value: reengagement.reengagedToWorkingGroup },
          { name: 'Newsletter', value: reengagement.reengagedToNewsletter },
          { name: 'Training', value: reengagement.reengagedToTraining },
          { name: 'Code', value: reengagement.reengagedToCode },
          { name: 'Web', value: reengagement.reengagedToWeb },
        ]
          .filter((p) => p.value > 0)
          .sort((a, b) => b.value - a.value);

        if (paths.length > 0) {
          const bestRate = (paths[0].value / funnel.eventAttendees) * 100;
          insights.push({ text: `${paths[0].name} is the highest re-engagement path at ${bestRate.toFixed(1)}% of attendees`, type: 'driver' });
        }

        // Weakest path
        if (paths.length > 1) {
          const worstRate = (paths[paths.length - 1].value / funnel.eventAttendees) * 100;
          insights.push({ text: `${paths[paths.length - 1].name} re-engagement lowest at ${worstRate.toFixed(1)}%`, type: 'warning' });
        }
      }

      // Re-engagement MoM trend
      if (reengagement.reengagementMomChange > 3) {
        insights.push({ text: `Re-engagement rate trending up ${reengagement.reengagementMomChange.toFixed(1)}% — flywheel is accelerating`, type: 'driver' });
      } else if (reengagement.reengagementMomChange < -3) {
        insights.push({
          text: `Re-engagement rate dropped ${Math.abs(reengagement.reengagementMomChange).toFixed(1)}% — flywheel is slowing`,
          type: 'warning',
        });
      }

      // Re-engaged count trend (monthlyData.value = TOTAL_REENGAGED)
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].value < recent3[1].value && recent3[1].value < recent3[2].value;
        const isShrinking = recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
        if (isGrowing) {
          insights.push({ text: `Re-engaged members growing for 3 consecutive months — ${formatNumber(recent3[2].value)} this month`, type: 'driver' });
        } else if (isShrinking) {
          insights.push({ text: `Re-engaged members declining for 3 consecutive months — ${formatNumber(recent3[2].value)} this month`, type: 'warning' });
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

  private initFunnelChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { funnel } = this.data();
      const reengagement = this.reengagement();
      return {
        labels: [
          'Event Attendees',
          'Re-engaged to Community',
          'Re-engaged to WG',
          'Re-engaged to Newsletter',
          'Re-engaged to Training',
          'Re-engaged to Code',
          'Re-engaged to Web',
        ],
        datasets: [
          {
            data: [
              funnel.eventAttendees,
              reengagement.reengagedToCommunity,
              reengagement.reengagedToWorkingGroup,
              reengagement.reengagedToNewsletter,
              reengagement.reengagedToTraining,
              reengagement.reengagedToCode,
              reengagement.reengagedToWeb,
            ],
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
