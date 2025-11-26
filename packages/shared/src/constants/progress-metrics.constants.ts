// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ChartOptions } from 'chart.js';
import type { ProgressItemWithChart } from '../interfaces';
import { hexToRgba } from '../utils';
import { lfxColors } from './colors.constants';

/**
 * Helper function to generate random data for spark line charts
 */
const generateMockData = (length: number, min: number, max: number): number[] => {
  return Array.from({ length }, () => Math.floor(Math.random() * (max - min + 1)) + min);
};

/**
 * Base chart options for progress metrics - no tooltips
 * Used for simple sparkline visualizations where tooltips are not needed
 */
export const PROGRESS_BASE_CHART_OPTIONS: ChartOptions<'line' | 'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: { display: false },
    y: { display: false },
  },
};

/**
 * Core Developer progress metrics
 */
export const CORE_DEVELOPER_PROGRESS_METRICS: ProgressItemWithChart[] = [
  {
    label: 'Code Commits',
    value: '47',
    trend: 'up',
    subtitle: 'Last 30 days',
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 6)),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
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
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 3)),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
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
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 5)),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
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
    chartType: 'bar',
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
          borderColor: lfxColors.emerald[500],
          backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
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
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 3)),
          borderColor: lfxColors.blue[300],
          backgroundColor: hexToRgba(lfxColors.blue[300], 0.1),
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

/**
 * Maintainer progress metrics
 */
export const MAINTAINER_PROGRESS_METRICS: ProgressItemWithChart[] = [
  {
    label: 'Critical Security Issues',
    icon: 'fa-light fa-shield-halved',
    value: '19',
    trend: 'down',
    subtitle: 'Open critical security vulnerabilities',
    chartType: 'line',
    category: 'projectHealth',
    chartData: {
      labels: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 12 }, (_, i) => {
            const base = 28 - i * 0.75;
            return Math.max(15, Math.floor(base + (Math.random() * 4 - 2)));
          }),
          borderColor: lfxColors.red[500],
          backgroundColor: hexToRgba(lfxColors.red[500], 0.1),
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
    label: 'PR Review & Merge Velocity',
    icon: 'fa-light fa-clock',
    value: '2.8 days',
    trend: 'up',
    subtitle: 'Average time to merge',
    chartType: 'bar',
    category: 'code',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 1, 5),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
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
    label: 'Open vs Closed Issues Trend',
    icon: 'fa-light fa-chart-line',
    value: '89%',
    trend: 'up',
    subtitle: 'Issue resolution rate',
    chartType: 'line',
    category: 'code',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          label: 'Opened Issues',
          data: generateMockData(30, 5, 15),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
          fill: false,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverBackgroundColor: lfxColors.blue[500],
          pointHoverBorderColor: lfxColors.white,
          pointHoverBorderWidth: 2,
        },
        {
          label: 'Closed Issues',
          data: generateMockData(30, 8, 18),
          borderColor: lfxColors.emerald[500],
          backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
          fill: false,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverBackgroundColor: lfxColors.emerald[500],
          pointHoverBorderColor: lfxColors.white,
          pointHoverBorderWidth: 2,
        },
      ],
    },
    chartOptions: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          titleColor: lfxColors.gray[900],
          bodyColor: lfxColors.gray[600],
          borderColor: `${lfxColors.gray[300]}CC`,
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          bodySpacing: 6,
          cornerRadius: 8,
          caretSize: 6,
          caretPadding: 8,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          titleFont: {
            size: 13,
            weight: 'bold',
          },
          bodyFont: {
            size: 12,
          },
          boxPadding: 6,
          callbacks: {
            labelPointStyle: () => {
              return {
                pointStyle: 'circle',
                rotation: 0,
              };
            },
          },
        },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  },
  {
    label: 'Contributors Mentored',
    icon: 'fa-light fa-user-graduate',
    value: '6',
    trend: 'up',
    subtitle: 'Active mentorship relationships',
    chartType: 'line',
    category: 'projectHealth',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 4, 8),
          borderColor: lfxColors.violet[500],
          backgroundColor: hexToRgba(lfxColors.violet[500], 0.1),
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
    label: 'Unique Contributors per Week',
    icon: 'fa-light fa-users',
    value: '24',
    trend: 'up',
    subtitle: 'Active contributors',
    chartType: 'bar',
    category: 'code',
    chartData: {
      labels: Array.from({ length: 4 }, (_, i) => `Week ${i + 1}`),
      datasets: [
        {
          data: generateMockData(4, 18, 30),
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.8),
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: 2,
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
    label: 'Health Score',
    icon: 'fa-light fa-heart-pulse',
    value: '85',
    trend: 'up',
    subtitle: 'Overall project health',
    chartType: 'line',
    category: 'projectHealth',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 80, 90),
          borderColor: lfxColors.emerald[500],
          backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
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
