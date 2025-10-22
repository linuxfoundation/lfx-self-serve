// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { TableComponent } from '@components/table/table.component';

import type { ProjectItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-my-projects',
  standalone: true,
  imports: [CommonModule, ChartComponent, TableComponent],
  templateUrl: './my-projects.component.html',
  styleUrl: './my-projects.component.scss',
})
export class MyProjectsComponent {
  protected readonly projects: ProjectItem[] = [
    {
      name: 'Kubernetes',
      logo: 'https://avatars.githubusercontent.com/u/13455738?s=280&v=4',
      role: 'Maintainer',
      affiliations: ['CNCF', 'Google'],
      codeActivities: [28, 32, 30, 35, 38, 40, 42],
      nonCodeActivities: [8, 10, 12, 11, 13, 14, 15],
      status: 'active',
    },
    {
      name: 'Linux Kernel',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg',
      role: 'Contributor',
      affiliations: ['Linux Foundation'],
      codeActivities: [15, 18, 20, 22, 24, 26, 28],
      nonCodeActivities: [3, 4, 5, 6, 7, 7, 8],
      status: 'active',
    },
    {
      name: 'Node.js',
      logo: 'https://nodejs.org/static/logos/nodejsHex.svg',
      role: 'Reviewer',
      affiliations: ['OpenJS Foundation'],
      codeActivities: [18, 16, 15, 14, 13, 12, 12],
      nonCodeActivities: [8, 7, 6, 6, 5, 5, 5],
      status: 'archived',
    },
  ];

  /**
   * Generates labels for chart based on data length
   * @param length - Number of data points
   * @returns Array of empty strings for chart labels
   */
  protected generateLabels(length: number): string[] {
    return Array.from({ length }, () => '');
  }
}
