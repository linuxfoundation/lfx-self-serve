// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import {
  CORE_DEVELOPER_PROGRESS_METRICS,
  MAINTAINER_PROGRESS_METRICS,
  PROGRESS_BAR_CHART_OPTIONS,
  PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS,
  PROGRESS_DUAL_LINE_CHART_OPTIONS,
  PROGRESS_LINE_CHART_OPTIONS,
} from '@lfx-one/shared/constants';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { TooltipModule } from 'primeng/tooltip';
import { finalize, switchMap } from 'rxjs';

import type {
  ActiveWeeksStreakResponse,
  FoundationContributorsMentoredResponse,
  ProgressItemWithChart,
  ProjectIssuesResolutionResponse,
  ProjectPullRequestsWeeklyResponse,
  UniqueContributorsWeeklyResponse,
  UserCodeCommitsResponse,
  UserPullRequestsResponse,
} from '@lfx-one/shared/interfaces';
import type { TooltipItem } from 'chart.js';

@Component({
  selector: 'lfx-recent-progress',
  standalone: true,
  imports: [CommonModule, ChartComponent, TooltipModule, FilterPillsComponent],
  templateUrl: './recent-progress.component.html',
  styleUrl: './recent-progress.component.scss',
})
export class RecentProgressComponent {
  @ViewChild('progressScroll') protected progressScrollContainer!: ElementRef;

  private readonly personaService = inject(PersonaService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  // Get project ID from context service

  private readonly loadingState = signal({
    activeWeeksStreak: true,
    pullRequestsMerged: true,
    codeCommits: true,
    projectIssuesResolution: true,
    projectPullRequestsWeekly: true,
    contributorsMentored: true,
    uniqueContributorsWeekly: true,
  });
  public readonly projectSlug = computed(() => this.projectContextService.selectedFoundation()?.slug || this.projectContextService.selectedProject()?.slug);
  private readonly entityType = computed<'foundation' | 'project'>(() => (this.projectContextService.selectedFoundation() ? 'foundation' : 'project'));
  private readonly activeWeeksStreakData = this.initializeActiveWeeksStreakData();
  private readonly pullRequestsMergedData = this.initializePullRequestsMergedData();
  private readonly codeCommitsData = this.initializeCodeCommitsData();
  private readonly projectIssuesResolutionData = this.initializeProjectIssuesResolutionData();
  private readonly projectPullRequestsWeeklyData = this.initializeProjectPullRequestsWeeklyData();
  private readonly contributorsMentoredData = this.initializeContributorsMentoredData();
  private readonly uniqueContributorsWeeklyData = this.initializeUniqueContributorsWeeklyData();
  private readonly issuesTooltipData = this.initializeIssuesTooltipData();
  private readonly prVelocityTooltipData = this.initializePrVelocityTooltipData();
  private readonly uniqueContributorsTooltipData = this.initializeUniqueContributorsTooltipData();
  protected readonly isLoading = this.initializeIsLoading();
  protected readonly progressItems = this.initializeProgressItems();
  protected readonly selectedFilter = signal<string>('all');
  protected readonly filteredProgressItems = computed(() => {
    const items = this.progressItems();
    const filter = this.selectedFilter();
    const persona = this.personaService.currentPersona();

    // Only apply filtering for maintainer persona
    if (persona !== 'maintainer') {
      return items;
    }

    if (filter === 'all') {
      return items;
    }

    return items.filter((item) => item.category === filter);
  });

  protected readonly currentPersona = computed(() => this.personaService.currentPersona());
  protected readonly showFilterPills = computed(() => this.currentPersona() === 'maintainer');
  protected readonly filterOptions: FilterOption[] = [
    { id: 'all', label: 'All' },
    { id: 'code', label: 'Code' },
    { id: 'projectHealth', label: 'Project Health' },
  ];

  protected setFilter(filter: string): void {
    this.selectedFilter.set(filter);
    // Reset scroll position when filter changes
    if (this.progressScrollContainer) {
      this.progressScrollContainer.nativeElement.scrollLeft = 0;
    }
  }

  protected scrollLeft(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: -300, behavior: 'smooth' });
  }

  protected scrollRight(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: 300, behavior: 'smooth' });
  }

  private transformActiveWeeksStreak(data: ActiveWeeksStreakResponse): ProgressItemWithChart {
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
        ...PROGRESS_BAR_CHART_OPTIONS,
        plugins: {
          ...PROGRESS_BAR_CHART_OPTIONS.plugins,
          tooltip: {
            ...(PROGRESS_BAR_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'bar'>[]) => context[0].label,
              label: (context: TooltipItem<'bar'>) => {
                const isActive = context.parsed.y === 1;
                return isActive ? 'Active' : 'Inactive';
              },
            },
          },
        },
      },
    };
  }

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
        ...PROGRESS_LINE_CHART_OPTIONS,
        plugins: {
          ...PROGRESS_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(PROGRESS_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context: TooltipItem<'line'>) => {
                const count = context.parsed.y;
                return `PRs Merged: ${count}`;
              },
            },
          },
        },
      },
    };
  }

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
        ...PROGRESS_LINE_CHART_OPTIONS,
        plugins: {
          ...PROGRESS_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(PROGRESS_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context: TooltipItem<'line'>) => {
                const count = context.parsed.y;
                return `Commits: ${count}`;
              },
            },
          },
        },
      },
    };
  }

  private transformProjectIssuesResolution(
    data: ProjectIssuesResolutionResponse,
    tooltipData: { opened: string; closed: string; median: string } | null
  ): ProgressItemWithChart {
    // Reverse the data to show oldest date on the left
    const chartData = [...data.data].reverse();

    // Use values directly from database (round resolution rate to integer, median to 1 decimal)
    const resolutionRate = data.resolutionRatePct ? Math.round(data.resolutionRatePct) : 0;

    const tooltipText = tooltipData
      ? `<div class="flex flex-col">
        <div>Opened: ${tooltipData.opened}</div>
        <div>Closed: ${tooltipData.closed}</div>
        <div>Median time to close: ${tooltipData.median}</div>
      </div>`
      : undefined;

    return {
      label: 'Open vs Closed Issues Trend',
      icon: 'fa-light fa-chart-line',
      value: `${resolutionRate}%`,
      trend: resolutionRate >= 50 ? 'up' : 'down',
      subtitle: 'Issue resolution rate',
      tooltipText,
      isConnected: true,
      chartType: 'line',
      category: 'code',
      chartData: {
        labels: chartData.map((row) => row.METRIC_DATE),
        datasets: [
          {
            label: 'Opened Issues',
            data: chartData.map((row) => row.OPENED_ISSUES_COUNT),
            borderColor: '#0094FF',
            backgroundColor: 'rgba(0, 148, 255, 0.1)',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
          {
            label: 'Closed Issues',
            data: chartData.map((row) => row.CLOSED_ISSUES_COUNT),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...PROGRESS_DUAL_LINE_CHART_OPTIONS,
        plugins: {
          ...PROGRESS_DUAL_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(PROGRESS_DUAL_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context: TooltipItem<'line'>) => {
                const datasetLabel = context.dataset?.label || '';
                const count = context.parsed.y;
                return `${datasetLabel}: ${count.toLocaleString()}`;
              },
              labelPointStyle: () => ({
                pointStyle: 'circle',
                rotation: 0,
              }),
            },
          },
        },
      },
    };
  }

  private transformProjectPullRequestsWeekly(
    data: ProjectPullRequestsWeeklyResponse,
    tooltipData: { total: string; reviewers: string; pending: string } | null
  ): ProgressItemWithChart {
    // Reverse the data to show oldest week on the left
    const chartData = [...data.data].reverse();

    // Calculate average merge time and round to 1 decimal place
    const avgMergeTime = data.avgMergeTime ? Math.round(data.avgMergeTime * 10) / 10 : 0;

    const tooltipText = tooltipData
      ? `<div class="flex flex-col">
        <div>Total PRs merged: ${tooltipData.total}</div>
        <div>Avg reviewers per PR: ${tooltipData.reviewers}</div>
        <div>Pending PRs: ${tooltipData.pending}</div>
      </div>`
      : undefined;

    return {
      label: 'PR Review & Merge Velocity',
      value: `${avgMergeTime}`,
      subtitle: 'Avg days to merge',
      tooltipText,
      isConnected: true,
      chartType: 'bar',
      chartData: {
        labels: chartData.map((row) => row.WEEK_START_DATE),
        datasets: [
          {
            label: 'Avg Days to Merge',
            data: chartData.map((row) => row.AVG_MERGED_IN_DAYS),
            borderColor: '#0094FF',
            backgroundColor: 'rgba(0, 148, 255, 0.5)',
            borderWidth: 0,
            borderRadius: 2,
            barPercentage: 0.95,
            categoryPercentage: 0.95,
          },
        ],
      },
      chartOptions: {
        ...PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS,
        plugins: {
          ...PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS.plugins,
          tooltip: {
            ...(PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'bar'>[]) => {
                try {
                  const dateStr = context[0]?.label || '';
                  if (!dateStr) return '';
                  const date = parseLocalDateString(dateStr);
                  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return `Week of ${formattedDate}`;
                } catch (e) {
                  console.error('Error in title callback:', e);
                  return context[0]?.label || '';
                }
              },
              label: (context: TooltipItem<'bar'>) => {
                try {
                  const dataIndex = context.dataIndex;
                  const weekData = chartData[dataIndex];
                  return `Avg days to merge: ${Math.round(weekData.AVG_MERGED_IN_DAYS * 10) / 10}`;
                } catch (e) {
                  console.error('Error in label callback:', e);
                  return '';
                }
              },
              footer: (context: TooltipItem<'bar'>[]) => {
                try {
                  const dataIndex = context[0]?.dataIndex;
                  if (dataIndex === undefined) return '';
                  const weekData = chartData[dataIndex];
                  return [`PRs merged: ${weekData.MERGED_PR_COUNT}`, `Avg reviewers: ${Math.round(weekData.AVG_REVIEWERS_PER_PR * 10) / 10}`];
                } catch (e) {
                  console.error('Error in footer callback:', e);
                  return '';
                }
              },
            },
          },
        },
      },
    };
  }

  private transformContributorsMentored(data: FoundationContributorsMentoredResponse): ProgressItemWithChart {
    // Reverse the data to show oldest week on the left
    const chartData = [...data.data].reverse();

    return {
      label: 'Contributors Mentored',
      icon: 'fa-light fa-user-graduate',
      value: data.totalMentored.toString(),
      trend: data.avgWeeklyNew > 0 ? 'up' : undefined,
      subtitle: 'Total contributors mentored',
      chartType: 'line',
      category: 'projectHealth',
      isConnected: true,
      chartData: {
        labels: chartData.map((row) => row.WEEK_START_DATE),
        datasets: [
          {
            label: 'Total Contributors Mentored',
            data: chartData.map((row) => row.MENTORED_CONTRIBUTOR_COUNT),
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: PROGRESS_LINE_CHART_OPTIONS,
    };
  }

  private transformUniqueContributorsWeekly(
    data: UniqueContributorsWeeklyResponse,
    tooltipData: { total: string; avgNew: string; avgReturning: string } | null
  ): ProgressItemWithChart {
    // Reverse the data to show oldest week on the left
    const chartData = [...data.data].reverse();

    // Round average to whole number for display
    const avgUniqueContributors = Math.round(data.avgUniqueContributors || 0);

    const tooltipText = tooltipData
      ? `<div class="flex flex-col">
        <div>Total unique contributors: ${tooltipData.total}</div>
        <div>Avg new per week: ${tooltipData.avgNew}</div>
        <div>Avg returning per week: ${tooltipData.avgReturning}</div>
      </div>`
      : undefined;

    return {
      label: 'Unique Contributors per Week',
      icon: 'fa-light fa-users',
      value: avgUniqueContributors.toString(),
      trend: avgUniqueContributors > 0 ? 'up' : 'down',
      subtitle: 'Active contributors',
      tooltipText,
      isConnected: true,
      chartType: 'bar',
      category: 'code',
      chartData: {
        labels: chartData.map((row) => row.WEEK_START_DATE),
        datasets: [
          {
            label: 'Unique Contributors',
            data: chartData.map((row) => row.UNIQUE_CONTRIBUTORS),
            backgroundColor: 'rgba(0, 148, 255, 0.5)',
            borderColor: '#0094FF',
            borderWidth: 0,
            borderRadius: 2,
            barPercentage: 0.95,
            categoryPercentage: 0.95,
          },
        ],
      },
      chartOptions: {
        ...PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS,
        plugins: {
          ...PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS.plugins,
          tooltip: {
            ...(PROGRESS_BAR_CHART_WITH_FOOTER_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'bar'>[]) => {
                try {
                  const dateStr = context[0]?.label || '';
                  if (!dateStr) return '';
                  const date = parseLocalDateString(dateStr);
                  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return `Week of ${formattedDate}`;
                } catch (e) {
                  console.error('Error in title callback:', e);
                  return context[0]?.label || '';
                }
              },
              label: (context: TooltipItem<'bar'>) => {
                try {
                  const dataIndex = context.dataIndex;
                  const weekData = chartData[dataIndex];
                  return `Unique contributors: ${weekData.UNIQUE_CONTRIBUTORS}`;
                } catch (e) {
                  console.error('Error in label callback:', e);
                  return '';
                }
              },
              footer: (context: TooltipItem<'bar'>[]) => {
                try {
                  const dataIndex = context[0].dataIndex;
                  const weekData = chartData[dataIndex];
                  return [
                    `New: ${weekData.NEW_CONTRIBUTORS}`,
                    `Returning: ${weekData.RETURNING_CONTRIBUTORS}`,
                    `Total active: ${weekData.TOTAL_ACTIVE_CONTRIBUTORS}`,
                  ];
                } catch (e) {
                  console.error('Error in footer callback:', e);
                  return [];
                }
              },
            },
          },
        },
      },
    };
  }

  private initializeActiveWeeksStreakData() {
    return toSignal(
      this.analyticsService.getActiveWeeksStreak().pipe(finalize(() => this.loadingState.update((state) => ({ ...state, activeWeeksStreak: false })))),
      {
        initialValue: {
          data: [],
          currentStreak: 0,
          totalWeeks: 0,
        },
      }
    );
  }

  private initializePullRequestsMergedData() {
    return toSignal(
      this.analyticsService.getPullRequestsMerged().pipe(finalize(() => this.loadingState.update((state) => ({ ...state, pullRequestsMerged: false })))),
      {
        initialValue: {
          data: [],
          totalPullRequests: 0,
          totalDays: 0,
        },
      }
    );
  }

  private initializeCodeCommitsData() {
    return toSignal(this.analyticsService.getCodeCommits().pipe(finalize(() => this.loadingState.update((state) => ({ ...state, codeCommits: false })))), {
      initialValue: {
        data: [],
        totalCommits: 0,
        totalDays: 0,
      },
    });
  }

  private initializeProjectIssuesResolutionData() {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (!projectSlug) {
            this.loadingState.update((state) => ({ ...state, projectIssuesResolution: false }));
            return [{ data: [], totalOpenedIssues: 0, totalClosedIssues: 0, resolutionRatePct: 0, medianDaysToClose: 0, totalDays: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, projectIssuesResolution: true }));
          const entityType = this.entityType();
          return this.analyticsService
            .getProjectIssuesResolution(projectSlug, entityType)
            .pipe(finalize(() => this.loadingState.update((state) => ({ ...state, projectIssuesResolution: false }))));
        })
      ),
      {
        initialValue: {
          data: [],
          totalOpenedIssues: 0,
          totalClosedIssues: 0,
          resolutionRatePct: 0,
          medianDaysToClose: 0,
          totalDays: 0,
        },
      }
    );
  }

  private initializeProjectPullRequestsWeeklyData() {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (!projectSlug) {
            this.loadingState.update((state) => ({ ...state, projectPullRequestsWeekly: false }));
            return [{ data: [], totalMergedPRs: 0, avgMergeTime: 0, totalWeeks: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, projectPullRequestsWeekly: true }));
          const entityType = this.entityType();
          return this.analyticsService
            .getProjectPullRequestsWeekly(projectSlug, entityType)
            .pipe(finalize(() => this.loadingState.update((state) => ({ ...state, projectPullRequestsWeekly: false }))));
        })
      ),
      {
        initialValue: {
          data: [],
          totalMergedPRs: 0,
          avgMergeTime: 0,
          totalWeeks: 0,
        },
      }
    );
  }

  private initializeContributorsMentoredData() {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (!projectSlug) {
            this.loadingState.update((state) => ({ ...state, contributorsMentored: false }));
            return [{ data: [], totalMentored: 0, avgWeeklyNew: 0, totalWeeks: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, contributorsMentored: true }));
          return this.analyticsService
            .getContributorsMentored(projectSlug)
            .pipe(finalize(() => this.loadingState.update((state) => ({ ...state, contributorsMentored: false }))));
        })
      ),
      {
        initialValue: {
          data: [],
          totalMentored: 0,
          avgWeeklyNew: 0,
          totalWeeks: 0,
        },
      }
    );
  }

  private initializeUniqueContributorsWeeklyData() {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (!projectSlug) {
            this.loadingState.update((state) => ({ ...state, uniqueContributorsWeekly: false }));
            return [{ data: [], totalUniqueContributors: 0, avgUniqueContributors: 0, totalWeeks: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, uniqueContributorsWeekly: true }));
          const entityType = this.entityType();
          return this.analyticsService
            .getUniqueContributorsWeekly(projectSlug, entityType)
            .pipe(finalize(() => this.loadingState.update((state) => ({ ...state, uniqueContributorsWeekly: false }))));
        })
      ),
      {
        initialValue: {
          data: [],
          totalUniqueContributors: 0,
          avgUniqueContributors: 0,
          totalWeeks: 0,
        },
      }
    );
  }

  private initializeIsLoading() {
    return computed<boolean>(() => {
      const state = this.loadingState();
      return Object.values(state).some((loading) => loading);
    });
  }

  private initializeProgressItems() {
    return computed<ProgressItemWithChart[]>(() => {
      const persona = this.personaService.currentPersona();
      const activeWeeksData = this.activeWeeksStreakData();
      const pullRequestsData = this.pullRequestsMergedData();
      const codeCommitsDataValue = this.codeCommitsData();
      const issuesResolutionData = this.projectIssuesResolutionData();
      const prWeeklyData = this.projectPullRequestsWeeklyData();
      const contributorsMentoredData = this.contributorsMentoredData();
      const uniqueContributorsData = this.uniqueContributorsWeeklyData();
      const issuesTooltip = this.issuesTooltipData();
      const prVelocityTooltip = this.prVelocityTooltipData();
      const uniqueContributorsTooltip = this.uniqueContributorsTooltipData();

      const baseMetrics = persona === 'maintainer' ? MAINTAINER_PROGRESS_METRICS : CORE_DEVELOPER_PROGRESS_METRICS;

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
        if (metric.label === 'Open vs Closed Issues Trend') {
          return this.transformProjectIssuesResolution(issuesResolutionData, issuesTooltip);
        }
        if (metric.label === 'PR Review & Merge Velocity') {
          return this.transformProjectPullRequestsWeekly(prWeeklyData, prVelocityTooltip);
        }
        if (metric.label === 'Contributors Mentored') {
          return this.transformContributorsMentored(contributorsMentoredData);
        }
        if (metric.label === 'Unique Contributors per Week') {
          return this.transformUniqueContributorsWeekly(uniqueContributorsData, uniqueContributorsTooltip);
        }
        return metric;
      });
    });
  }

  private initializeIssuesTooltipData() {
    return computed(() => {
      const issuesData = this.projectIssuesResolutionData();
      if (!issuesData || issuesData.data.length === 0) {
        return null;
      }
      const totalOpened = issuesData.totalOpenedIssues || 0;
      const totalClosed = issuesData.totalClosedIssues || 0;
      const medianDays = issuesData.medianDaysToClose ? Math.round(issuesData.medianDaysToClose * 10) / 10 : 0;

      return {
        opened: totalOpened.toLocaleString(),
        closed: totalClosed.toLocaleString(),
        median: `${medianDays} days`,
      };
    });
  }

  private initializePrVelocityTooltipData() {
    return computed(() => {
      const prData = this.projectPullRequestsWeeklyData();
      if (!prData || prData.data.length === 0) {
        return null;
      }
      const chartData = [...prData.data].reverse();
      const totalMergedPRs = prData.totalMergedPRs || 0;
      const avgPendingPRs = chartData.length > 0 ? Math.round(chartData.reduce((sum, row) => sum + row.PENDING_PR_COUNT, 0) / chartData.length) : 0;
      const avgReviewers =
        chartData.length > 0 ? Math.round((chartData.reduce((sum, row) => sum + row.AVG_REVIEWERS_PER_PR, 0) / chartData.length) * 10) / 10 : 0;

      return {
        total: totalMergedPRs.toLocaleString(),
        reviewers: avgReviewers.toString(),
        pending: avgPendingPRs.toString(),
      };
    });
  }

  private initializeUniqueContributorsTooltipData() {
    return computed(() => {
      const contributorsData = this.uniqueContributorsWeeklyData();
      if (!contributorsData || contributorsData.data.length === 0) {
        return null;
      }
      const chartData = [...contributorsData.data].reverse();
      const totalUnique = contributorsData.totalUniqueContributors || 0;
      const avgNew = chartData.length > 0 ? Math.round(chartData.reduce((sum, row) => sum + row.NEW_CONTRIBUTORS, 0) / chartData.length) : 0;
      const avgReturning = chartData.length > 0 ? Math.round(chartData.reduce((sum, row) => sum + row.RETURNING_CONTRIBUTORS, 0) / chartData.length) : 0;

      return {
        total: totalUnique.toLocaleString(),
        avgNew: avgNew.toString(),
        avgReturning: avgReturning.toString(),
      };
    });
  }
}
