// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { FoundationHealthScoreDistributionResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-project-health-scores-drawer',
  imports: [DrawerModule, ChartComponent, InsightsHandoffSectionComponent],
  templateUrl: './project-health-scores-drawer.component.html',
})
export class ProjectHealthScoresDrawerComponent {
  // === Static Options ===
  protected readonly legendColors = {
    critical: lfxColors.red[500],
    unsteady: lfxColors.amber[400],
    stable: lfxColors.violet[500],
    healthy: lfxColors.blue[500],
    excellent: lfxColors.emerald[500],
  };

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
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} projects`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300], width: 1 },
        ticks: { color: lfxColors.gray[600], font: { size: 12 }, padding: 4 },
      },
      y: {
        display: true,
        title: { display: true, text: 'Projects', color: lfxColors.gray[500], font: { size: 11 } },
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => (v as number).toLocaleString() },
        beginAtZero: true,
      },
    },
    datasets: { bar: { barPercentage: 0.55, categoryPercentage: 0.7, borderRadius: 4 } },
  };

  // === Inputs ===
  public readonly data = input<FoundationHealthScoreDistributionResponse>({
    excellent: 0,
    healthy: 0,
    stable: 0,
    unsteady: 0,
    critical: 0,
  });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Computed Signals ===
  protected readonly totalProjects: Signal<number> = computed(() => {
    const d = this.data();
    return d.excellent + d.healthy + d.stable + d.unsteady + d.critical;
  });

  protected readonly hasData: Signal<boolean> = computed(() => this.totalProjects() > 0);

  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const d = this.data();
      return {
        labels: ['Critical', 'Unsteady', 'Stable', 'Healthy', 'Excellent'],
        datasets: [
          {
            data: [d.critical, d.unsteady, d.stable, d.healthy, d.excellent],
            backgroundColor: [
              this.legendColors.critical,
              this.legendColors.unsteady,
              this.legendColors.stable,
              this.legendColors.healthy,
              this.legendColors.excellent,
            ],
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      };
    });
  }
}
