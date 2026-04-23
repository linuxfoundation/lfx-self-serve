// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, Signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ChartComponent } from '@components/chart/chart.component';
import { SelectComponent } from '@components/select/select.component';
import { DEFAULT_FOUNDATION_TOTAL_MEMBERS, lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { FoundationTotalMembersResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-total-members-drawer',
  imports: [DrawerModule, ChartComponent, SelectComponent, ReactiveFormsModule],
  templateUrl: './total-members-drawer.component.html',
})
export class TotalMembersDrawerComponent {
  // === Services ===
  private readonly fb = inject(FormBuilder);

  // === Static Options ===
  protected readonly timeRangeOptions = [{ label: 'Last 12 months', value: 'last-12-months' }];

  // === Forms ===
  protected readonly headerForm: FormGroup = this.fb.group({
    timeRange: [{ value: 'last-12-months', disabled: true }],
  });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<FoundationTotalMembersResponse>(DEFAULT_FOUNDATION_TOTAL_MEMBERS);

  // === Computed Signals ===
  protected readonly hasData: Signal<boolean> = computed(() => this.data().monthlyData.length > 0);
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

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
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4 },
      },
    },
    datasets: { bar: { barPercentage: 0.7, categoryPercentage: 0.8 } },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
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
            backgroundColor: lfxColors.blue[400],
            borderRadius: 4,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
