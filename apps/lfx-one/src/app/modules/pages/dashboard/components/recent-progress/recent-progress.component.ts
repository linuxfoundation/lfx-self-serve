// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';

import type { ProgressItemWithChart } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recent-progress',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  templateUrl: './recent-progress.component.html',
  styleUrl: './recent-progress.component.scss',
})
export class RecentProgressComponent {
  @ViewChild('progressScroll') protected progressScrollContainer!: ElementRef;

  protected readonly progressItems: ProgressItemWithChart[] = [
    {
      label: 'Code Commits',
      value: '47',
      trend: 'up',
      subtitle: 'Last 30 days',
      chartData: {
        labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
        datasets: [
          {
            data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 6)),
            borderColor: '#0094FF',
            backgroundColor: 'rgba(0, 148, 255, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    },
    {
      label: 'Pull Requests Merged',
      value: '12',
      trend: 'up',
      subtitle: 'Last 30 days',
      chartData: {
        labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
        datasets: [
          {
            data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 3)),
            borderColor: '#0094FF',
            backgroundColor: 'rgba(0, 148, 255, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    },
    {
      label: 'Issues Resolved & Comments Added',
      value: '34',
      trend: 'up',
      subtitle: 'Combined activity last 30 days',
      chartData: {
        labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
        datasets: [
          {
            data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 5)),
            borderColor: '#0094FF',
            backgroundColor: 'rgba(0, 148, 255, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    },
    {
      label: 'Active Weeks Streak',
      value: '12',
      trend: 'up',
      subtitle: 'Current streak',
      chartData: {
        labels: Array.from({ length: 20 }, (_, i) => `Week ${i + 1}`),
        datasets: [
          {
            data: Array.from({ length: 20 }, (_, i) => {
              if (i >= 8) {
                return 1;
              }
              return Math.random() > 0.5 ? 1 : 0;
            }),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    },
    {
      label: 'Learning Hours',
      value: '8.5',
      trend: 'up',
      subtitle: 'Last 30 days',
      chartData: {
        labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
        datasets: [
          {
            data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 3)),
            borderColor: '#93c5fd',
            backgroundColor: 'rgba(147, 197, 253, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    },
  ];

  protected scrollLeft(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: -300, behavior: 'smooth' });
  }

  protected scrollRight(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: 300, behavior: 'smooth' });
  }
}
