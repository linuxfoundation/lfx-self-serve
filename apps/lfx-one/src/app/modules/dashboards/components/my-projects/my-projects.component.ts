// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { TableComponent } from '@components/table/table.component';
import { AnalyticsService } from '@services/analytics.service';
import { BehaviorSubject, finalize, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { LazyLoadEvent } from 'primeng/api';
import type { ProjectItemWithCharts } from '@lfx-one/shared/interfaces';
import { hexToRgba, lfxColors } from '@lfx-one/shared';

@Component({
  selector: 'lfx-my-projects',
  standalone: true,
  imports: [CommonModule, ChartComponent, TableComponent],
  templateUrl: './my-projects.component.html',
  styleUrl: './my-projects.component.scss',
})
export class MyProjectsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly paginationState$ = new BehaviorSubject({ page: 1, limit: 10 });
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

  public readonly rows = signal(10);

  private readonly projectsResponse = toSignal(
    this.paginationState$.pipe(
      tap(() => this.loading.set(true)),
      switchMap(({ page, limit }) => this.analyticsService.getMyProjects(page, limit).pipe(finalize(() => this.loading.set(false))))
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

  public onPageChange(event: LazyLoadEvent): void {
    const page = Math.floor((event.first ?? 0) / (event.rows ?? 10)) + 1;
    this.rows.set(event.rows ?? 10);
    this.paginationState$.next({ page, limit: event.rows ?? 10 });
  }

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
