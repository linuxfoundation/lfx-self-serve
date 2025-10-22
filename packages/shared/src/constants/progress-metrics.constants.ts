// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProgressItemWithChart } from '../interfaces';

/**
 * Helper function to generate random data for spark line charts
 */
const generateMockData = (length: number, min: number, max: number): number[] => {
  return Array.from({ length }, () => Math.floor(Math.random() * (max - min + 1)) + min);
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
          data: generateMockData(30, 75, 95),
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
