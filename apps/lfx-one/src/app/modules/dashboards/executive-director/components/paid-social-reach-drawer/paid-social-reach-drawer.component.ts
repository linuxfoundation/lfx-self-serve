// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { SocialReachResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-paid-social-reach-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './paid-social-reach-drawer.component.html',
})
export class PaidSocialReachDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<SocialReachResponse>({
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
  });

  // === Dummy Data ===
  protected readonly recommendedActions: MarketingRecommendedAction[] = [
    {
      title: 'Reallocate budget to top channels',
      description: 'Shift spend toward LinkedIn and Twitter where CPM is lowest',
      priority: 'high',
      dueLabel: 'Next campaign',
      iconClass: 'fa-light fa-chart-pie',
    },
    {
      title: 'A/B test ad creatives',
      description: 'Test 3 new visual formats across paid channels',
      priority: 'medium',
      dueLabel: 'This quarter',
      iconClass: 'fa-light fa-flask',
    },
  ];

  protected readonly keyInsights: MarketingKeyInsight[] = [
    { text: 'Driver: LinkedIn impressions up 25%', type: 'driver' },
    { text: 'Twitter/X reach declining 8% MoM', type: 'warning' },
    { text: 'Cost per impression down across all channels', type: 'info' },
  ];

  // === Computed Signals ===
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();
  protected readonly roasChartData: Signal<ChartData<'bar'>> = this.initRoasChartData();
  protected readonly channelChartData: Signal<ChartData<'bar'>> = this.initChannelChartData();

  protected readonly chartOptions: ChartOptions<'bar'> = {
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
            if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.7, categoryPercentage: 0.9 },
    },
  };

  protected readonly roasChartOptions: ChartOptions<'bar'> = {
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
  };

  protected readonly channelChartOptions: ChartOptions<'bar'> = {
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

  protected formatCurrency(num: number): string {
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toLocaleString()}`;
  }

  protected formatChannelName(name: string): string {
    return name
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // === Private Initializers ===
  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyData, monthlyLabels } = this.data();
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
      const { monthlyRoas, monthlyLabels } = this.data();
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

  private initChannelChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { channelGroups } = this.data();
      const sorted = [...channelGroups].sort((a, b) => b.totalImpressions - a.totalImpressions);
      return {
        labels: sorted.map((c) => this.formatChannelName(c.channel)),
        datasets: [
          {
            data: sorted.map((c) => c.totalImpressions),
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[400], lfxColors.blue[300], lfxColors.blue[200]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
