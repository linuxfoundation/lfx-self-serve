// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { createHorizontalBarChartOptions, createLineChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import {
  buildFlywheelKeyInsights,
  buildFlywheelRecommendedActions,
  formatNumber,
  getFlywheelReengagement,
  hexToRgba,
  splitByPriority,
  type MarketingSplitByPriority,
} from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { FlywheelConversionResponse, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-flywheel-conversion-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, TagComponent],
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

  // === Computed Signals ===
  protected readonly formattedEventAttendees: Signal<string> = computed(() => formatNumber(this.data().funnel.eventAttendees));
  protected readonly reengagement: Signal<NonNullable<FlywheelConversionResponse['reengagement']>> = computed(() => getFlywheelReengagement(this.data()));
  protected readonly reengagementRate: Signal<string> = computed(() => `${this.reengagement().reengagementRate.toFixed(1)}%`);
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = computed(() => buildFlywheelRecommendedActions(this.data()));
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = computed(() => buildFlywheelKeyInsights(this.data()));
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
