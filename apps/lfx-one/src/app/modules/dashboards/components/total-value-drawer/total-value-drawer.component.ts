// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { buildInsightsUrl } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { FoundationValueConcentrationResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-total-value-drawer',
  imports: [DrawerModule, ChartComponent, InsightsHandoffSectionComponent],
  templateUrl: './total-value-drawer.component.html',
})
export class TotalValueDrawerComponent {
  // === Static Data ===
  protected readonly insightsUrl = buildInsightsUrl();

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly summaryData = input<FoundationValueConcentrationResponse>({
    totalValue: 0,
    top1Value: 0,
    top3Value: 0,
    top5Value: 0,
    allOtherValue: 0,
    totalProjectsCount: 0,
    top1Percentage: 0,
    top3Percentage: 0,
    top5Percentage: 0,
    allOtherPercentage: 0,
  });

  // === Computed Signals ===
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

  protected readonly chartOptions: ChartOptions<'bar'> = {
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
          label: (ctx) => ` ${ctx.parsed.x}% of total value`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        min: 0,
        grid: {
          color: lfxColors.gray[200],
          lineWidth: 1,
        },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 12 },
          stepSize: 20,
          callback: (value) => `${value}%`,
        },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[600],
          font: { size: 12 },
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.92, categoryPercentage: 1.0 },
    },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { top1Percentage, top3Percentage, top5Percentage, allOtherPercentage } = this.summaryData();
      return {
        labels: ['Top 1 project', 'Top 3 projects', 'Top 5 projects', 'All other projects'],
        datasets: [
          {
            data: [top1Percentage, top3Percentage, top5Percentage, allOtherPercentage],
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[300], lfxColors.gray[300]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
