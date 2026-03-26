// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { FlywheelConversionResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-flywheel-conversion-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './flywheel-conversion-drawer.component.html',
})
export class FlywheelConversionDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<FlywheelConversionResponse>({
    conversionRate: 0,
    changePercentage: 0,
    trend: 'up',
    funnel: { eventAttendees: 0, convertedToNewsletter: 0, convertedToCommunity: 0, convertedToWorkingGroup: 0 },
    monthlyData: [],
  });

  // === Computed Signals ===
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly funnelChartData: Signal<ChartData<'bar'>> = this.initFunnelChartData();

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
          label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(1)}% conversion rate`,
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
          callback: (value) => `${value}%`,
        },
      },
    },
  };

  protected readonly funnelChartOptions: ChartOptions<'bar'> = {
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
          label: (ctx) => ` ${this.formatNumber(ctx.parsed.x ?? 0)} people`,
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
      const { conversionRate, changePercentage, funnel, monthlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (conversionRate === 0 && funnel.eventAttendees === 0 && monthlyData.length === 0) {
        return actions;
      }

      // Low WG conversion
      if (funnel.eventAttendees > 0 && funnel.convertedToWorkingGroup > 0) {
        const wgRate = (funnel.convertedToWorkingGroup / funnel.eventAttendees) * 100;
        const nlRate = funnel.convertedToNewsletter > 0 ? (funnel.convertedToNewsletter / funnel.eventAttendees) * 100 : 0;
        if (wgRate < nlRate * 0.5 && nlRate > 0) {
          actions.push({
            title: 'Improve working group conversion path',
            description: `WG conversion at ${wgRate.toFixed(1)}% vs ${nlRate.toFixed(1)}% for newsletter — attendees need clearer path to participate`,
            priority: 'high',
            dueLabel: 'This quarter',
            iconClass: 'fa-light fa-arrow-progress',
          });
        }
      }

      // Declining conversion rate
      if (changePercentage < -5) {
        actions.push({
          title: 'Address conversion rate decline',
          description: `Flywheel conversion dropped ${Math.abs(changePercentage)}% — review post-event follow-up effectiveness`,
          priority: 'high',
          dueLabel: 'This month',
          iconClass: 'fa-light fa-chart-line-down',
        });
      }

      // Low overall conversion
      if (conversionRate > 0 && conversionRate < 10 && funnel.eventAttendees > 0) {
        actions.push({
          title: 'Add post-event engagement CTAs',
          description: `Only ${conversionRate}% overall conversion — add newsletter signup and community join prompts to event follow-ups`,
          priority: 'medium',
          dueLabel: 'Next event',
          iconClass: 'fa-light fa-envelope-circle-check',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue flywheel optimization',
          description: `${conversionRate}% conversion rate${changePercentage > 0 ? ` — improving ${changePercentage}%` : ''} across ${this.formatNumber(funnel.eventAttendees)} attendees`,
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
      const { conversionRate, changePercentage, funnel, monthlyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (conversionRate === 0 && funnel.eventAttendees === 0 && monthlyData.length === 0) {
        return insights;
      }

      // Best conversion path
      if (funnel.eventAttendees > 0) {
        const paths = [
          { name: 'Newsletter', value: funnel.convertedToNewsletter },
          { name: 'Community', value: funnel.convertedToCommunity },
          { name: 'Working group', value: funnel.convertedToWorkingGroup },
        ]
          .filter((p) => p.value > 0)
          .sort((a, b) => b.value - a.value);

        if (paths.length > 0) {
          const bestRate = (paths[0].value / funnel.eventAttendees) * 100;
          insights.push({ text: `${paths[0].name} is the highest conversion path at ${bestRate.toFixed(1)}% of attendees`, type: 'driver' });
        }

        // Weakest path
        if (paths.length > 1) {
          const worstRate = (paths[paths.length - 1].value / funnel.eventAttendees) * 100;
          insights.push({ text: `${paths[paths.length - 1].name} conversion lowest at ${worstRate.toFixed(1)}%`, type: 'warning' });
        }
      }

      // Conversion trend
      if (changePercentage > 3) {
        insights.push({ text: `Conversion rate trending up ${changePercentage}% — flywheel is accelerating`, type: 'driver' });
      } else if (changePercentage < -3) {
        insights.push({ text: `Conversion rate dropped ${Math.abs(changePercentage)}% — flywheel is slowing`, type: 'warning' });
      }

      // Monthly trend consistency
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].value < recent3[1].value && recent3[1].value < recent3[2].value;
        const isShrinking = recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
        if (isGrowing) {
          insights.push({ text: 'Conversion rate growing for 3 consecutive months', type: 'driver' });
        } else if (isShrinking) {
          insights.push({ text: 'Conversion rate declining for 3 consecutive months', type: 'warning' });
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

  private initFunnelChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { funnel } = this.data();
      return {
        labels: ['Event Attendees', 'Converted to Newsletter', 'Converted to Community', 'Converted to WG'],
        datasets: [
          {
            data: [funnel.eventAttendees, funnel.convertedToNewsletter, funnel.convertedToCommunity, funnel.convertedToWorkingGroup],
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[400], lfxColors.blue[300]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
