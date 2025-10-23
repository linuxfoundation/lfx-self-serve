// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { TableComponent } from '@components/table/table.component';

import type { ChartData, ChartOptions } from 'chart.js';
import type { ProjectItem } from '@lfx-one/shared/interfaces';

/**
 * Extended project item with pre-generated chart data
 */
interface ProjectItemWithCharts extends ProjectItem {
  codeActivitiesChartData: ChartData<'line'>;
  nonCodeActivitiesChartData: ChartData<'line'>;
}

@Component({
  selector: 'lfx-my-projects',
  standalone: true,
  imports: [CommonModule, ChartComponent, TableComponent],
  templateUrl: './my-projects.component.html',
  styleUrl: './my-projects.component.scss',
})
export class MyProjectsComponent {
  /**
   * Chart options for activity charts
   */
  protected readonly chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false },
    },
  };

  /**
   * Projects with pre-generated chart data
   */
  protected readonly projects: ProjectItemWithCharts[];

  public constructor() {
    // Initialize projects with randomized chart data
    const baseProjects: ProjectItem[] = [
      {
        name: 'Kubernetes',
        logo: 'https://avatars.githubusercontent.com/u/13455738?s=280&v=4',
        role: 'Maintainer',
        affiliations: ['CNCF', 'Google'],
        codeActivities: this.generateRandomData(7, 25, 45),
        nonCodeActivities: this.generateRandomData(7, 8, 16),
        status: 'active',
      },
      {
        name: 'Linux Kernel',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg',
        role: 'Contributor',
        affiliations: ['Linux Foundation'],
        codeActivities: this.generateRandomData(7, 12, 30),
        nonCodeActivities: this.generateRandomData(7, 3, 9),
        status: 'active',
      },
      {
        name: 'Node.js',
        logo: 'https://nodejs.org/static/logos/nodejsHex.svg',
        role: 'Reviewer',
        affiliations: ['OpenJS Foundation'],
        codeActivities: this.generateRandomData(7, 10, 20),
        nonCodeActivities: this.generateRandomData(7, 4, 10),
        status: 'archived',
      },
    ];

    // Generate chart data for each project
    this.projects = baseProjects.map((project) => ({
      ...project,
      codeActivitiesChartData: this.createChartData(project.codeActivities, '#009AFF', 'rgba(0, 154, 255, 0.1)'),
      nonCodeActivitiesChartData: this.createChartData(project.nonCodeActivities, '#10b981', 'rgba(16, 185, 129, 0.1)'),
    }));
  }

  /**
   * Generates random data array
   * @param length - Number of data points
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns Array of random numbers
   */
  private generateRandomData(length: number, min: number, max: number): number[] {
    return Array.from({ length }, () => Math.floor(Math.random() * (max - min + 1)) + min);
  }

  /**
   * Creates chart data configuration
   * @param data - Array of values
   * @param borderColor - Chart border color
   * @param backgroundColor - Chart background color
   * @returns Chart.js data configuration
   */
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
