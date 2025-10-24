// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AnalyticsService } from '@app/shared/services/analytics.service';
import { PersonaService } from '@app/shared/services/persona.service';
import { ChartComponent } from '@components/chart/chart.component';
import { CORE_DEVELOPER_PROGRESS_METRICS, MAINTAINER_PROGRESS_METRICS } from '@lfx-one/shared/constants';

import type { ActiveWeeksStreakResponse, ProgressItemWithChart, UserCodeCommitsResponse, UserPullRequestsResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recent-progress',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  templateUrl: './recent-progress.component.html',
  styleUrl: './recent-progress.component.scss',
})
export class RecentProgressComponent {
  @ViewChild('progressScroll') protected progressScrollContainer!: ElementRef;

  private readonly personaService = inject(PersonaService);
  private readonly analyticsService = inject(AnalyticsService);

  /**
   * Active weeks streak data from Snowflake
   */
  private readonly activeWeeksStreakData = toSignal(this.analyticsService.getActiveWeeksStreak(), {
    initialValue: {
      data: [],
      currentStreak: 0,
      totalWeeks: 0,
    },
  });

  /**
   * Pull requests merged data from Snowflake
   */
  private readonly pullRequestsMergedData = toSignal(this.analyticsService.getPullRequestsMerged(), {
    initialValue: {
      data: [],
      totalPullRequests: 0,
      totalDays: 0,
    },
  });

  /**
   * Code commits data from Snowflake
   */
  private readonly codeCommitsData = toSignal(this.analyticsService.getCodeCommits(), {
    initialValue: {
      data: [],
      totalCommits: 0,
      totalDays: 0,
    },
  });

  /**
   * Computed signal that returns progress metrics based on the current persona
   * Merges hardcoded metrics with real data from Snowflake
   */
  protected readonly progressItems = computed<ProgressItemWithChart[]>(() => {
    const persona = this.personaService.currentPersona();
    const activeWeeksData = this.activeWeeksStreakData();
    const pullRequestsData = this.pullRequestsMergedData();
    const codeCommitsDataValue = this.codeCommitsData();

    const baseMetrics = persona === 'maintainer' ? MAINTAINER_PROGRESS_METRICS : CORE_DEVELOPER_PROGRESS_METRICS;

    // Replace metrics with real data if available
    return baseMetrics.map((metric) => {
      if (metric.label === 'Active Weeks Streak') {
        return this.transformActiveWeeksStreak(activeWeeksData);
      }
      if (metric.label === 'Pull Requests Merged') {
        return this.transformPullRequestsMerged(pullRequestsData);
      }
      if (metric.label === 'Code Commits') {
        return this.transformCodeCommits(codeCommitsDataValue);
      }
      return metric;
    });
  });

  protected scrollLeft(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: -300, behavior: 'smooth' });
  }

  protected scrollRight(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: 300, behavior: 'smooth' });
  }

  /**
   * Transform Active Weeks Streak API response to chart format
   * API returns data in ascending order by WEEKS_AGO (0, 1, 2, 3...)
   * Display as-is with newest week (week 0) on the left
   */
  private transformActiveWeeksStreak(data: ActiveWeeksStreakResponse): ProgressItemWithChart {
    // Use data as-is: week 0 (newest) on the left, older weeks on the right
    const chartData = data.data;

    return {
      label: 'Active Weeks Streak',
      value: data.currentStreak.toString(),
      trend: data.currentStreak > 0 ? 'up' : 'down',
      subtitle: 'Current streak',
      chartType: 'bar',
      chartData: {
        labels: chartData.map((row) => `Week ${row.WEEKS_AGO}`),
        datasets: [
          {
            data: chartData.map((row) => row.IS_ACTIVE),
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
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (context) => context[0].label,
              label: (context) => {
                const isActive = context.parsed.y === 1;
                return isActive ? 'Active' : 'Inactive';
              },
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 1 },
        },
      },
    };
  }

  /**
   * Transform Pull Requests Merged API response to chart format
   * API returns data in ascending order by ACTIVITY_DATE
   * Display as-is with oldest date on the left, newest on the right
   */
  private transformPullRequestsMerged(data: UserPullRequestsResponse): ProgressItemWithChart {
    const chartData = data.data;

    return {
      label: 'Pull Requests Merged',
      value: data.totalPullRequests.toString(),
      trend: data.totalPullRequests > 0 ? 'up' : 'down',
      subtitle: 'Last 30 days',
      chartType: 'line',
      chartData: {
        labels: chartData.map((row) => row.ACTIVITY_DATE),
        datasets: [
          {
            data: chartData.map((row) => row.DAILY_COUNT),
            borderColor: '#0094FF',
            backgroundColor: 'rgba(0, 148, 255, 0.1)',
            fill: true,
            tension: 0,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (context) => {
                const date = new Date(context[0].label);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const count = context.parsed.y;
                return `PRs Merged: ${count}`;
              },
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    };
  }

  /**
   * Transform Code Commits API response to chart format
   * API returns data in ascending order by ACTIVITY_DATE
   * Display as-is with oldest date on the left, newest on the right
   */
  private transformCodeCommits(data: UserCodeCommitsResponse): ProgressItemWithChart {
    const chartData = data.data;

    return {
      label: 'Code Commits',
      value: data.totalCommits.toString(),
      trend: data.totalCommits > 0 ? 'up' : 'down',
      subtitle: 'Last 30 days',
      chartType: 'line',
      chartData: {
        labels: chartData.map((row) => row.ACTIVITY_DATE),
        datasets: [
          {
            data: chartData.map((row) => row.DAILY_COUNT),
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
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (context) => {
                const date = new Date(context[0].label);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const count = context.parsed.y;
                return `Commits: ${count}`;
              },
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    };
  }
}
