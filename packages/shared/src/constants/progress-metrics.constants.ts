// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ChartOptions } from 'chart.js';
import type { ProgressItemWithChart } from '../interfaces';

/**
 * Helper function to generate random data for spark line charts
 */
const generateMockData = (length: number, min: number, max: number): number[] => {
  return Array.from({ length }, () => Math.floor(Math.random() * (max - min + 1)) + min);
};

/**
 * Base chart options for progress metrics - no tooltips
 * Used for simple sparkline visualizations
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
 * Chart options for line charts with simple tooltips
 * Used for single-dataset line charts (commits, PRs, etc.)
 */
export const PROGRESS_LINE_CHART_OPTIONS: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: true,
      yAlign: 'bottom',
      position: 'nearest',
    },
  },
  scales: {
    x: { display: false },
    y: { display: false },
  },
};

/**
 * Chart options for bar charts with simple tooltips
 * Used for Active Weeks Streak and similar metrics
 */
export const PROGRESS_BAR_CHART_OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: true,
      yAlign: 'bottom',
      position: 'nearest',
    },
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, max: 1 },
  },
};

/**
 * Chart options for dual-line charts with enhanced tooltips
 * Used for Issues Trend (opened vs closed) with styled tooltips
 */
export const PROGRESS_DUAL_LINE_CHART_OPTIONS: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  hover: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: true,
      mode: 'index',
      intersect: false,
      yAlign: 'bottom',
      position: 'nearest',
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      titleColor: '#1f2937',
      bodyColor: '#4b5563',
      footerColor: '#6b7280',
      borderColor: 'rgba(209, 213, 219, 0.8)',
      borderWidth: 1,
      padding: 12,
      displayColors: true,
      bodySpacing: 6,
      footerSpacing: 4,
      footerMarginTop: 8,
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
      footerFont: {
        size: 11,
        weight: 'normal',
      },
      boxPadding: 6,
      callbacks: {
        labelPointStyle: () => ({
          pointStyle: 'circle',
          rotation: 0,
        }),
      },
    },
  },
  scales: {
    x: { display: false },
    y: { display: false },
  },
};

/**
 * Chart options for bar charts with footer tooltips
 * Used for PR Velocity with additional footer information
 */
export const PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  layout: {
    padding: {
      top: 5,
      bottom: 5,
    },
  },
  interaction: {
    mode: 'index',
    intersect: false,
  },
  hover: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: true,
      mode: 'index',
      intersect: false,
      position: 'nearest',
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      titleColor: '#1f2937',
      bodyColor: '#4b5563',
      footerColor: '#6b7280',
      borderColor: 'rgba(209, 213, 219, 0.8)',
      borderWidth: 1,
      padding: 12,
      displayColors: false,
      bodySpacing: 6,
      footerSpacing: 4,
      footerMarginTop: 8,
      cornerRadius: 8,
      caretSize: 6,
      caretPadding: 8,
      titleFont: {
        size: 13,
        weight: 'bold',
      },
      bodyFont: {
        size: 12,
      },
      footerFont: {
        size: 11,
        weight: 'normal',
      },
    },
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
    chartType: 'line',
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
    chartType: 'line',
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
    chartType: 'line',
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

/**
 * Maintainer progress metrics
 */
export const MAINTAINER_PROGRESS_METRICS: ProgressItemWithChart[] = [
  {
    label: 'Code Commits',
    value: '19',
    trend: 'up',
    subtitle: 'Last 30 days',
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 0, 3),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
    value: '2.8 days',
    trend: 'up',
    subtitle: 'Average time to merge',
    chartType: 'bar',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 1, 5),
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
    label: 'Open vs Closed Issues Trend',
    value: '89%',
    trend: 'up',
    subtitle: 'Issue resolution rate',
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          label: 'Opened Issues',
          data: generateMockData(30, 5, 15),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: false,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverBackgroundColor: '#ef4444',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
        },
        {
          label: 'Closed Issues',
          data: generateMockData(30, 8, 18),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: false,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverBackgroundColor: '#10b981',
          pointHoverBorderColor: '#fff',
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
          titleColor: '#1f2937',
          bodyColor: '#4b5563',
          borderColor: 'rgba(209, 213, 219, 0.8)',
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
    value: '6',
    trend: 'up',
    subtitle: 'Active mentorship relationships',
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 4, 8),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
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
    value: '24',
    trend: 'up',
    subtitle: 'Active contributors',
    chartType: 'bar',
    chartData: {
      labels: Array.from({ length: 12 }, (_, i) => `Week ${i + 1}`),
      datasets: [
        {
          data: generateMockData(12, 18, 30),
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
    label: 'Health Score',
    value: '85',
    trend: 'up',
    subtitle: 'Overall project health',
    chartType: 'line',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: generateMockData(30, 80, 90),
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
];
