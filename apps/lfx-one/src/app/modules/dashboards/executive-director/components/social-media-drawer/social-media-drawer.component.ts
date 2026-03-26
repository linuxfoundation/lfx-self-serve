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

  // === Dummy Data ===
  protected readonly recommendedActions: MarketingRecommendedAction[] = [
    {
      title: 'Increase posting frequency on Bluesky',
      description: 'Bluesky has highest engagement rate (6.1%) but fewest posts',
      priority: 'high',
      dueLabel: 'This week',
      iconClass: 'fa-light fa-calendar-plus',
    },
    {
      title: 'Cross-post video content to YouTube Shorts',
      description: 'Repurpose top-performing social content as short-form video',
      priority: 'medium',
      dueLabel: 'This month',
      iconClass: 'fa-light fa-video',
    },
  ];

  protected readonly keyInsights: MarketingKeyInsight[] = [
    { text: 'Driver: LinkedIn engagement rate highest at 4.8%', type: 'driver' },
    { text: 'YouTube growth stalled — only 8 posts in 30 days', type: 'warning' },
    { text: 'Mastodon and Bluesky growing fastest among new platforms', type: 'info' },
  ];

  // === Computed Signals ===
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
