// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@app/shared/components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TableComponent } from '@components/table/table.component';
import { hexToRgba, lfxColors } from '@lfx-one/shared';
import { AnalyticsService } from '@services/analytics.service';
import { finalize, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { ProjectItemWithCharts } from '@lfx-one/shared/interfaces';
@Component({
  selector: 'lfx-my-projects',
  imports: [ChartComponent, TableComponent, CardComponent],
  templateUrl: './my-projects.component.html',
  styleUrl: './my-projects.component.scss',
})
export class MyProjectsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  protected readonly loading = signal(true);

  public readonly chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false },
    },
  };

  private readonly projectsResponse = toSignal(
    this.analyticsService.getMyProjects().pipe(
      tap(() => this.loading.set(true)),
      finalize(() => this.loading.set(false))
    ),
    {
      initialValue: { data: [], totalProjects: 0 },
    }
  );

  public readonly projects = computed<ProjectItemWithCharts[]>(() => {
    const response = this.projectsResponse();
    return response.data.map((project) => ({
      ...project,
      codeActivitiesChartData: this.createChartData(project.codeActivities, lfxColors.blue[500], hexToRgba(lfxColors.blue[500], 0.1)),
      nonCodeActivitiesChartData: this.createChartData(project.nonCodeActivities, lfxColors.emerald[500], hexToRgba(lfxColors.emerald[500], 0.1)),
    }));
  });

  public readonly totalRecords = computed(() => this.projectsResponse().totalProjects);

  private createChartData(data: number[], borderColor: string, backgroundColor: string): ChartData<'line'> {
    return {
      labels: Array.from({ length: data.length }, () => ''),
      datasets: [
        {
          data,
          borderColor,
          backgroundColor,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  }
}
