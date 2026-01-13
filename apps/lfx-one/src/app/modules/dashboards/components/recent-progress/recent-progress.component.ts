// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import {
  BAR_CHART_WITH_FOOTER_OPTIONS,
  BASE_BAR_CHART_OPTIONS,
  BASE_LINE_CHART_OPTIONS,
  CORE_DEVELOPER_PROGRESS_METRICS,
  DUAL_LINE_CHART_OPTIONS,
  lfxColors,
  MAINTAINER_PROGRESS_METRICS,
} from '@lfx-one/shared/constants';
import { hexToRgba, parseLocalDateString } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { catchError, of, switchMap, tap } from 'rxjs';

import type {
  ActiveWeeksStreakResponse,
  CodeCommitsDailyResponse,
  DashboardMetricCard,
  FoundationContributorsMentoredResponse,
  HealthMetricsAggregatedRow,
  HealthMetricsDailyResponse,
  ProjectHealthMetricsDailyRow,
  ProjectIssuesResolutionResponse,
  ProjectPullRequestsWeeklyResponse,
  UniqueContributorsWeeklyResponse,
  UserCodeCommitsResponse,
  UserPullRequestsResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recent-progress',
  imports: [FilterPillsComponent, MetricCardComponent, ScrollShadowDirective],
  templateUrl: './recent-progress.component.html',
  styleUrl: './recent-progress.component.scss',
})
export class RecentProgressComponent {
  @ViewChild(ScrollShadowDirective) protected scrollShadowDirective!: ScrollShadowDirective;

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
    healthMetricsDaily: true,
    codeCommitsDaily: true,
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
  private readonly healthMetricsDailyData = this.initializeHealthMetricsDailyData();
  private readonly codeCommitsDailyData = this.initializeCodeCommitsDailyData();
  private readonly issuesTooltipData = this.initializeIssuesTooltipData();
  private readonly prVelocityTooltipData = this.initializePrVelocityTooltipData();
  private readonly uniqueContributorsTooltipData = this.initializeUniqueContributorsTooltipData();
  protected readonly isLoading = this.initializeIsLoading();
  protected readonly selectedFilter = signal<string>('all');

  // Individual computed signals for each card - each only depends on its own data
  // Core Developer metrics
  private readonly activeWeeksStreakCard = this.initializeActiveWeeksStreakCard();
  private readonly pullRequestsMergedCard = this.initializePullRequestsMergedCard();
  private readonly codeCommitsCard = this.initializeCodeCommitsCard();

  // Maintainer metrics
  private readonly issuesTrendCard = this.initializeIssuesTrendCard();
  private readonly prVelocityCard = this.initializePrVelocityCard();
  private readonly contributorsMentoredCard = this.initializeContributorsMentoredCard();
  private readonly uniqueContributorsCard = this.initializeUniqueContributorsCard();
  private readonly healthScoreCard = this.initializeHealthScoreCard();
  private readonly codeCommitsDailyCard = this.initializeCodeCommitsDailyCard();

  // Filtered cards - materializes card values while benefiting from individual signal memoization
  protected readonly filteredProgressItems = this.initializeFilteredProgressItems();

  protected readonly currentPersona = computed(() => this.personaService.currentPersona());
  protected readonly showFilterPills = computed(() => this.currentPersona() === 'maintainer');
  protected readonly filterOptions: FilterOption[] = [
    { id: 'all', label: 'All' },
    { id: 'code', label: 'Code' },
    { id: 'projectHealth', label: 'Project Health' },
  ];

  protected setFilter(filter: string): void {
    this.selectedFilter.set(filter);
  }

  private getMetricConfig(title: string): DashboardMetricCard {
    const persona = this.personaService.currentPersona();
    const baseMetrics = persona === 'maintainer' ? MAINTAINER_PROGRESS_METRICS : CORE_DEVELOPER_PROGRESS_METRICS;
    return baseMetrics.find((m) => m.title === title) || MAINTAINER_PROGRESS_METRICS.find((m) => m.title === title)!;
  }

  private transformActiveWeeksStreak(data: ActiveWeeksStreakResponse, metric: DashboardMetricCard): DashboardMetricCard {
    const chartData = data.data;

    return {
      ...metric,
      loading: this.loadingState().activeWeeksStreak,
      value: data.currentStreak.toString(),
      trend: data.currentStreak > 0 ? 'up' : 'down',
      chartData: {
        labels: chartData.map((row) => `Week ${row.WEEKS_AGO}`),
        datasets: [
          {
            data: chartData.map((row) => row.IS_ACTIVE),
            borderColor: lfxColors.emerald[500],
            backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...BASE_BAR_CHART_OPTIONS,
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 1, grace: '5%' },
        },
        plugins: {
          ...BASE_BAR_CHART_OPTIONS.plugins,
          tooltip: {
            ...(BASE_BAR_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => context[0].label,
              label: (context) => {
                const isActive = context.parsed.y === 1;
                return isActive ? 'Active' : 'Inactive';
              },
            },
          },
        },
      },
    };
  }

  private transformPullRequestsMerged(data: UserPullRequestsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    const chartData = data.data;

    return {
      ...metric,
      loading: this.loadingState().pullRequestsMerged,
      value: data.totalPullRequests.toString(),
      trend: data.totalPullRequests > 0 ? 'up' : 'down',
      chartData: {
        labels: chartData.map((row) => row.ACTIVITY_DATE),
        datasets: [
          {
            data: chartData.map((row) => row.DAILY_COUNT),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...BASE_LINE_CHART_OPTIONS,
        plugins: {
          ...BASE_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const count = context.parsed.y ?? 0;
                return `PRs Merged: ${count}`;
              },
            },
          },
        },
      },
    };
  }

  private transformCodeCommits(data: UserCodeCommitsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    const chartData = data.data;

    return {
      ...metric,
      loading: this.loadingState().codeCommits,
      value: data.totalCommits.toString(),
      trend: data.totalCommits > 0 ? 'up' : 'down',
      chartData: {
        labels: chartData.map((row) => row.ACTIVITY_DATE),
        datasets: [
          {
            data: chartData.map((row) => row.DAILY_COUNT),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...BASE_LINE_CHART_OPTIONS,
        plugins: {
          ...BASE_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const count = context.parsed.y ?? 0;
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
    tooltipData: { opened: string; closed: string; median: string } | null,
    metric: DashboardMetricCard
  ): DashboardMetricCard {
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
      ...metric,
      loading: this.loadingState().projectIssuesResolution,
      value: `${resolutionRate}%`,
      trend: resolutionRate >= 50 ? 'up' : 'down',
      tooltipText,
      chartData: {
        labels: chartData.map((row) => row.METRIC_DATE),
        datasets: [
          {
            label: 'Opened Issues',
            data: chartData.map((row) => row.OPENED_ISSUES_COUNT),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
          {
            label: 'Closed Issues',
            data: chartData.map((row) => row.CLOSED_ISSUES_COUNT),
            borderColor: lfxColors.emerald[500],
            backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...DUAL_LINE_CHART_OPTIONS,
        plugins: {
          ...DUAL_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(DUAL_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const datasetLabel = context.dataset?.label || '';
                const count = context.parsed.y ?? 0;
                return `${datasetLabel}: ${count.toLocaleString()}`;
              },
              labelPointStyle: () => ({
                pointStyle: 'circle' as const,
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
    tooltipData: { total: string; reviewers: string; pending: string } | null,
    metric: DashboardMetricCard
  ): DashboardMetricCard {
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
      ...metric,
      loading: this.loadingState().projectPullRequestsWeekly,
      value: `${avgMergeTime}`,
      tooltipText,
      chartData: {
        labels: chartData.map((row) => row.WEEK_START_DATE),
        datasets: [
          {
            label: 'Avg Days to Merge',
            data: chartData.map((row) => row.AVG_MERGED_IN_DAYS),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.5),
            borderRadius: 2,
            barPercentage: 0.95,
            categoryPercentage: 0.95,
          },
        ],
      },
      chartOptions: {
        ...BAR_CHART_WITH_FOOTER_OPTIONS,
        plugins: {
          ...BAR_CHART_WITH_FOOTER_OPTIONS.plugins,
          tooltip: {
            ...(BAR_CHART_WITH_FOOTER_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
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
              label: (context) => {
                try {
                  const dataIndex = context.dataIndex;
                  const weekData = chartData[dataIndex];
                  return `Avg days to merge: ${Math.round(weekData.AVG_MERGED_IN_DAYS * 10) / 10}`;
                } catch (e) {
                  console.error('Error in label callback:', e);
                  return '';
                }
              },
              footer: (context) => {
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

  private transformContributorsMentored(data: FoundationContributorsMentoredResponse, metric: DashboardMetricCard): DashboardMetricCard {
    // Reverse the data to show oldest week on the left
    const chartData = [...data.data].reverse();

    // Format labels to match Active Contributors format
    const chartLabels = chartData.map((row) => {
      const date = parseLocalDateString(row.WEEK_START_DATE);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    });

    return {
      ...metric,
      loading: this.loadingState().contributorsMentored,
      value: data.totalMentored.toString(),
      trend: data.avgWeeklyNew > 0 ? 'up' : undefined,
      chartData: {
        labels: chartLabels,
        datasets: [
          {
            label: 'Total Contributors Mentored',
            data: chartData.map((row) => row.MENTORED_CONTRIBUTOR_COUNT),
            borderColor: lfxColors.violet[500],
            backgroundColor: hexToRgba(lfxColors.violet[500], 0.1),
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...BASE_LINE_CHART_OPTIONS,
        plugins: {
          ...BASE_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => context[0].label,
              label: (context) => {
                const count = context.parsed.y ?? 0;
                return `Contributors mentored: ${count.toLocaleString()}`;
              },
            },
          },
        },
      },
    };
  }

  private transformUniqueContributorsWeekly(
    data: UniqueContributorsWeeklyResponse,
    tooltipData: { total: string; avgNew: string; avgReturning: string } | null,
    metric: DashboardMetricCard
  ): DashboardMetricCard {
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
      ...metric,
      loading: this.loadingState().uniqueContributorsWeekly,
      value: avgUniqueContributors.toString(),
      trend: avgUniqueContributors > 0 ? 'up' : 'down',
      tooltipText,
      chartData: {
        labels: chartData.map((row) => row.WEEK_START_DATE),
        datasets: [
          {
            label: 'Unique Contributors',
            data: chartData.map((row) => row.UNIQUE_CONTRIBUTORS),
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.5),
            borderColor: lfxColors.blue[500],
            borderRadius: 2,
            barPercentage: 0.95,
            categoryPercentage: 0.95,
          },
        ],
      },
      chartOptions: {
        ...BAR_CHART_WITH_FOOTER_OPTIONS,
        plugins: {
          ...BAR_CHART_WITH_FOOTER_OPTIONS.plugins,
          tooltip: {
            ...(BAR_CHART_WITH_FOOTER_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
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
              label: (context) => {
                try {
                  const dataIndex = context.dataIndex;
                  const weekData = chartData[dataIndex];
                  return `Unique contributors: ${weekData.UNIQUE_CONTRIBUTORS}`;
                } catch (e) {
                  console.error('Error in label callback:', e);
                  return '';
                }
              },
              footer: (context) => {
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

  private transformHealthMetricsDaily(
    data: HealthMetricsDailyResponse,
    metric: DashboardMetricCard,
    entityType: 'foundation' | 'project'
  ): DashboardMetricCard {
    // Reverse the data to show oldest date on the left
    const chartData = [...data.data].reverse();

    // Current average health score from the API
    const currentAvgHealthScore = data.currentAvgHealthScore || 0;

    // Determine trend based on health score
    const trend = currentAvgHealthScore >= 50 ? 'up' : 'down';

    // Helper to extract health score based on entity type
    const getHealthScore = (row: HealthMetricsAggregatedRow | ProjectHealthMetricsDailyRow): number => {
      if (entityType === 'foundation') {
        return (row as HealthMetricsAggregatedRow).AVG_HEALTH_SCORE;
      }
      return (row as ProjectHealthMetricsDailyRow).HEALTH_SCORE;
    };

    // Tooltip label based on entity type
    const tooltipLabel = entityType === 'foundation' ? 'Avg Health Score' : 'Health Score';

    return {
      ...metric,
      loading: this.loadingState().healthMetricsDaily,
      value: currentAvgHealthScore.toString(),
      trend,
      chartData: {
        labels: chartData.map((row) => row.METRIC_DATE),
        datasets: [
          {
            label: 'Health Score',
            data: chartData.map((row) => getHealthScore(row)),
            borderColor: lfxColors.emerald[500],
            backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...BASE_LINE_CHART_OPTIONS,
        plugins: {
          ...BASE_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
                const dateStr = context[0].label;
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const score = Math.round(context.parsed.y ?? 0);
                return `${tooltipLabel}: ${score}`;
              },
            },
          },
        },
      },
    };
  }

  private transformCodeCommitsDaily(data: CodeCommitsDailyResponse, metric: DashboardMetricCard): DashboardMetricCard {
    // Total commits from the API
    const totalCommits = data.totalCommits || 0;

    // Determine trend based on commit count
    const trend = totalCommits > 0 ? 'up' : 'down';

    return {
      ...metric,
      loading: this.loadingState().codeCommitsDaily,
      value: totalCommits.toLocaleString(),
      trend,
      chartData: {
        labels: data.data.map((row) => row.ACTIVITY_DATE),
        datasets: [
          {
            label: 'Daily Commits',
            data: data.data.map((row) => row.DAILY_COMMIT_COUNT),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: {
        ...BASE_LINE_CHART_OPTIONS,
        plugins: {
          ...BASE_LINE_CHART_OPTIONS.plugins,
          tooltip: {
            ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => {
                const dateStr = context[0]?.label || '';
                if (!dateStr) return '';
                const date = parseLocalDateString(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              },
              label: (context) => {
                const count = context.parsed.y ?? 0;
                return `Commits: ${count.toLocaleString()}`;
              },
            },
          },
        },
      },
    };
  }

  private initializeActiveWeeksStreakData() {
    return toSignal(
      toObservable(this.personaService.currentPersona).pipe(
        switchMap((persona) => {
          // Only fetch for core-developer persona
          if (persona === 'maintainer') {
            this.loadingState.update((state) => ({ ...state, activeWeeksStreak: false }));
            return [{ data: [], currentStreak: 0, totalWeeks: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, activeWeeksStreak: true }));
          return this.analyticsService.getActiveWeeksStreak().pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, activeWeeksStreak: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, activeWeeksStreak: false }));
              return of({ data: [], currentStreak: 0, totalWeeks: 0 });
            })
          );
        })
      ),
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
      toObservable(this.personaService.currentPersona).pipe(
        switchMap((persona) => {
          // Only fetch for core-developer persona
          if (persona === 'maintainer') {
            this.loadingState.update((state) => ({ ...state, pullRequestsMerged: false }));
            return [{ data: [], totalPullRequests: 0, totalDays: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, pullRequestsMerged: true }));
          return this.analyticsService.getPullRequestsMerged().pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, pullRequestsMerged: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, pullRequestsMerged: false }));
              return of({ data: [], totalPullRequests: 0, totalDays: 0 });
            })
          );
        })
      ),
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
    return toSignal(
      toObservable(this.personaService.currentPersona).pipe(
        switchMap((persona) => {
          // Only fetch for core-developer persona
          if (persona === 'maintainer') {
            this.loadingState.update((state) => ({ ...state, codeCommits: false }));
            return [{ data: [], totalCommits: 0, totalDays: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, codeCommits: true }));
          return this.analyticsService.getCodeCommits().pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, codeCommits: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, codeCommits: false }));
              return of({ data: [], totalCommits: 0, totalDays: 0 });
            })
          );
        })
      ),
      {
        initialValue: {
          data: [],
          totalCommits: 0,
          totalDays: 0,
        },
      }
    );
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
          return this.analyticsService.getProjectIssuesResolution(projectSlug, entityType).pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, projectIssuesResolution: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, projectIssuesResolution: false }));
              return of({ data: [], totalOpenedIssues: 0, totalClosedIssues: 0, resolutionRatePct: 0, medianDaysToClose: 0, totalDays: 0 });
            })
          );
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
          return this.analyticsService.getProjectPullRequestsWeekly(projectSlug, entityType).pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, projectPullRequestsWeekly: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, projectPullRequestsWeekly: false }));
              return of({ data: [], totalMergedPRs: 0, avgMergeTime: 0, totalWeeks: 0 });
            })
          );
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
          return this.analyticsService.getContributorsMentored(projectSlug).pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, contributorsMentored: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, contributorsMentored: false }));
              return of({ data: [], totalMentored: 0, avgWeeklyNew: 0, totalWeeks: 0 });
            })
          );
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
          return this.analyticsService.getUniqueContributorsWeekly(projectSlug, entityType).pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, uniqueContributorsWeekly: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, uniqueContributorsWeekly: false }));
              return of({ data: [], totalUniqueContributors: 0, avgUniqueContributors: 0, totalWeeks: 0 });
            })
          );
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

  private initializeHealthMetricsDailyData() {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (!projectSlug) {
            this.loadingState.update((state) => ({ ...state, healthMetricsDaily: false }));
            return [{ data: [], currentAvgHealthScore: 0, totalDays: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, healthMetricsDaily: true }));
          const entityType = this.entityType();
          return this.analyticsService.getHealthMetricsDaily(projectSlug, entityType).pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, healthMetricsDaily: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, healthMetricsDaily: false }));
              return of({ data: [], currentAvgHealthScore: 0, totalDays: 0 });
            })
          );
        })
      ),
      {
        initialValue: {
          data: [],
          currentAvgHealthScore: 0,
          totalDays: 0,
        },
      }
    );
  }

  private initializeCodeCommitsDailyData() {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (!projectSlug) {
            this.loadingState.update((state) => ({ ...state, codeCommitsDaily: false }));
            return [{ data: [], totalCommits: 0, totalDays: 0 }];
          }
          this.loadingState.update((state) => ({ ...state, codeCommitsDaily: true }));
          const entityType = this.entityType();
          return this.analyticsService.getCodeCommitsDaily(projectSlug, entityType).pipe(
            tap(() => this.loadingState.update((state) => ({ ...state, codeCommitsDaily: false }))),
            catchError(() => {
              this.loadingState.update((state) => ({ ...state, codeCommitsDaily: false }));
              return of({ data: [], totalCommits: 0, totalDays: 0 });
            })
          );
        })
      ),
      {
        initialValue: {
          data: [],
          totalCommits: 0,
          totalDays: 0,
        },
      }
    );
  }

  private initializeIsLoading() {
    return computed<boolean>(() => {
      const state = this.loadingState();
      const persona = this.personaService.currentPersona();

      if (persona === 'maintainer') {
        // For maintainer, only check maintainer-specific metrics
        return (
          state.projectIssuesResolution ||
          state.projectPullRequestsWeekly ||
          state.contributorsMentored ||
          state.uniqueContributorsWeekly ||
          state.healthMetricsDaily ||
          state.codeCommitsDaily
        );
      }

      // For core-developer, only check core-developer-specific metrics
      return state.activeWeeksStreak || state.pullRequestsMerged || state.codeCommits;
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

  // Card signal initialization methods
  private initializeActiveWeeksStreakCard() {
    return computed(() => this.transformActiveWeeksStreak(this.activeWeeksStreakData(), this.getMetricConfig('Active Weeks Streak')));
  }

  private initializePullRequestsMergedCard() {
    return computed(() => this.transformPullRequestsMerged(this.pullRequestsMergedData(), this.getMetricConfig('Pull Requests Merged')));
  }

  private initializeCodeCommitsCard() {
    return computed(() => this.transformCodeCommits(this.codeCommitsData(), this.getMetricConfig('Code Commits')));
  }

  private initializeIssuesTrendCard() {
    return computed(() =>
      this.transformProjectIssuesResolution(this.projectIssuesResolutionData(), this.issuesTooltipData(), this.getMetricConfig('Open vs Closed Issues Trend'))
    );
  }

  private initializePrVelocityCard() {
    return computed(() =>
      this.transformProjectPullRequestsWeekly(
        this.projectPullRequestsWeeklyData(),
        this.prVelocityTooltipData(),
        this.getMetricConfig('PR Review & Merge Velocity')
      )
    );
  }

  private initializeContributorsMentoredCard() {
    return computed(() => this.transformContributorsMentored(this.contributorsMentoredData(), this.getMetricConfig('Contributors Mentored')));
  }

  private initializeUniqueContributorsCard() {
    return computed(() =>
      this.transformUniqueContributorsWeekly(
        this.uniqueContributorsWeeklyData(),
        this.uniqueContributorsTooltipData(),
        this.getMetricConfig('Unique Contributors per Week')
      )
    );
  }

  private initializeHealthScoreCard() {
    return computed(() => this.transformHealthMetricsDaily(this.healthMetricsDailyData(), this.getMetricConfig('Health Score'), this.entityType()));
  }

  private initializeCodeCommitsDailyCard() {
    return computed(() => this.transformCodeCommitsDaily(this.codeCommitsDailyData(), this.getMetricConfig('Code Commits')));
  }

  private initializeFilteredProgressItems() {
    return computed<DashboardMetricCard[]>(() => {
      const persona = this.personaService.currentPersona();
      const filter = this.selectedFilter();

      if (persona === 'maintainer') {
        // Materialize maintainer card values
        const allCards = [
          { card: this.issuesTrendCard(), category: 'code' },
          { card: this.prVelocityCard(), category: 'code' },
          { card: this.codeCommitsDailyCard(), category: 'code' },
          { card: this.contributorsMentoredCard(), category: 'projectHealth' },
          { card: this.uniqueContributorsCard(), category: 'projectHealth' },
          { card: this.healthScoreCard(), category: 'projectHealth' },
        ];

        if (filter === 'all') {
          return allCards.map((item) => item.card);
        }
        return allCards.filter((item) => item.category === filter).map((item) => item.card);
      }

      // Core developer - no filtering, just materialize card values
      return [this.activeWeeksStreakCard(), this.pullRequestsMergedCard(), this.codeCommitsCard()];
    });
  }
}
