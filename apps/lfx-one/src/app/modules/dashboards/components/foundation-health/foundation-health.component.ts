// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, input, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, COMPANY_BUS_FACTOR, lfxColors, PRIMARY_FOUNDATION_HEALTH_METRICS } from '@lfx-one/shared/constants';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { finalize, map, switchMap } from 'rxjs';

import type { DashboardMetricCard, HealthEventsMonthlyResponse, TopProjectDisplay, UniqueContributorsDailyResponse } from '@lfx-one/shared/interfaces';
import type { TooltipItem } from 'chart.js';
@Component({
  selector: 'lfx-foundation-health',
  standalone: true,
  imports: [CommonModule, FilterPillsComponent, MetricCardComponent, DataCopilotComponent],
  templateUrl: './foundation-health.component.html',
  styleUrl: './foundation-health.component.scss',
})
export class FoundationHealthComponent {
  @ViewChild('carouselScroll') public carouselScrollContainer!: ElementRef;

  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly title = input<string>('Foundation Health');

  private readonly totalProjectsLoading = signal(true);
  private readonly totalMembersLoading = signal(true);
  private readonly softwareValueLoading = signal(true);
  private readonly maintainersLoading = signal(true);
  private readonly healthScoresLoading = signal(true);
  private readonly activeContributorsLoading = signal(true);
  private readonly eventsLoading = signal(true);
  private readonly selectedFoundationSlug$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((foundation) => foundation?.slug || ''));
  public readonly hasFoundationSelected = computed<boolean>(() => !!this.projectContextService.selectedFoundation());
  private readonly totalProjectsData = this.initializeTotalProjectsData();
  private readonly totalMembersData = this.initializeTotalMembersData();
  private readonly softwareValueData = this.initializeSoftwareValueData();
  private readonly maintainersData = this.initializeMaintainersData();
  private readonly healthScoresData = this.initializeHealthScoresData();
  private readonly activeContributorsData = this.initializeActiveContributorsData();
  private readonly eventsData = this.initializeEventsData();
  public readonly isLoading = computed<boolean>(
    () =>
      this.totalProjectsLoading() ||
      this.totalMembersLoading() ||
      this.softwareValueLoading() ||
      this.maintainersLoading() ||
      this.healthScoresLoading() ||
      this.activeContributorsLoading() ||
      this.eventsLoading()
  );

  public readonly selectedFilter = signal<string>('all');

  public readonly filterOptions: FilterOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributors', label: 'Contribution' },
    { id: 'projects', label: 'Project' },
    { id: 'events', label: 'Event' },
  ];

  public readonly sparklineOptions = BASE_LINE_CHART_OPTIONS;

  public readonly barChartOptions = BASE_BAR_CHART_OPTIONS;

  public readonly metricCards = computed<DashboardMetricCard[]>(() => {
    const filter = this.selectedFilter();
    const allCards = this.allMetricCards();

    if (filter === 'all') {
      return allCards;
    }

    return allCards.filter((card) => card.category === filter);
  });

  private readonly allMetricCards = computed<DashboardMetricCard[]>(() => {
    return PRIMARY_FOUNDATION_HEALTH_METRICS.map((metric) => {
      if (metric.title === 'Total Projects') {
        return this.transformTotalProjects(metric);
      }
      if (metric.title === 'Total Members') {
        return this.transformTotalMembers(metric);
      }
      if (metric.title === 'Software Value') {
        return this.transformSoftwareValue(metric);
      }
      if (metric.title === 'Company Bus Factor') {
        return this.transformCompanyBusFactor(metric);
      }
      if (metric.title === 'Active Contributors') {
        return this.transformActiveContributors(metric);
      }
      if (metric.title === 'Maintainers') {
        return this.transformMaintainers(metric);
      }
      if (metric.title === 'Events') {
        return this.transformEvents(metric);
      }
      if (metric.title === 'Project Health Scores') {
        return this.transformProjectHealthScores(metric);
      }
      return this.transformDefault(metric);
    });
  });

  public readonly healthScoreDistribution = computed(() => {
    const distribution = this.healthScoresData();

    const data = [
      { category: 'Critical', count: distribution.critical, color: lfxColors.red[500] },
      { category: 'Unsteady', count: distribution.unsteady, color: lfxColors.amber[400] },
      { category: 'Stable', count: distribution.stable, color: lfxColors.amber[500] },
      { category: 'Healthy', count: distribution.healthy, color: lfxColors.blue[500] },
      { category: 'Excellent', count: distribution.excellent, color: lfxColors.emerald[500] },
    ];

    const maxCount = Math.max(...data.map((d) => d.count));

    return data.map((item) => ({
      ...item,
      heightPx: Math.round((item.count / maxCount) * 64),
    }));
  });

  public handleFilterChange(filter: string): void {
    this.selectedFilter.set(filter);
  }

  public scrollLeft(): void {
    if (!this.carouselScrollContainer?.nativeElement) return;
    const container = this.carouselScrollContainer.nativeElement;
    container.scrollBy({ left: -320, behavior: 'smooth' });
  }

  public scrollRight(): void {
    if (!this.carouselScrollContainer?.nativeElement) return;
    const container = this.carouselScrollContainer.nativeElement;
    container.scrollBy({ left: 320, behavior: 'smooth' });
  }

  private formatSoftwareValue(valueInMillions: number): string {
    if (valueInMillions >= 1000) {
      const billions = valueInMillions / 1000;
      return `${billions.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`;
    }
    return `${valueInMillions.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  }

  private formatTopProjects(projects: { name: string; value: number }[]): TopProjectDisplay[] {
    return projects.map((project) => ({
      name: project.name,
      formattedValue: this.formatSoftwareValue(project.value),
    }));
  }

  private transformTotalProjects(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.totalProjectsData();

    return {
      ...metric,
      value: data.totalProjects.toLocaleString(),
      subtitle: `Total ${this.projectContextService.selectedFoundation()?.name} projects`,
      chartData: {
        labels: data.monthlyLabels,
        datasets: [
          {
            data: data.monthlyData,
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
        ...this.sparklineOptions,
        plugins: {
          ...this.sparklineOptions.plugins,
          tooltip: {
            ...(this.sparklineOptions.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => context[0].label,
              label: (context: TooltipItem<'line'>) => {
                const count = context.parsed.y;
                return `Total projects: ${count}`;
              },
            },
          },
        },
      },
    };
  }

  private transformTotalMembers(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.totalMembersData();

    return {
      ...metric,
      value: data.totalMembers.toLocaleString(),
      subtitle: `Total ${this.projectContextService.selectedFoundation()?.name} members`,
      chartData: {
        labels: data.monthlyLabels,
        datasets: [
          {
            data: data.monthlyData,
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
        ...this.sparklineOptions,
        plugins: {
          ...this.sparklineOptions.plugins,
          tooltip: {
            ...(this.sparklineOptions.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => context[0].label,
              label: (context: TooltipItem<'line'>) => {
                const count = context.parsed.y;
                return `Total members: ${count}`;
              },
            },
          },
        },
      },
    };
  }

  private transformSoftwareValue(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.softwareValueData();

    return {
      ...metric,
      value: this.formatSoftwareValue(data.totalValue),
      subtitle: 'Estimated total value of software managed',
      topProjects: this.formatTopProjects(data.topProjects),
    };
  }

  private transformCompanyBusFactor(metric: DashboardMetricCard): DashboardMetricCard {
    // TODO: Replace with real API data when endpoint is available
    return {
      ...metric,
      value: COMPANY_BUS_FACTOR.topCompaniesCount.toString(),
      subtitle: 'Companies account for >50% code contributions',
      busFactor: COMPANY_BUS_FACTOR,
    };
  }

  private transformActiveContributors(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.activeContributorsData();

    // Reverse the data to show oldest to newest for chart rendering
    const chartData = [...data.data].reverse();
    const contributorValues = chartData.map((row) => row.DAILY_UNIQUE_CONTRIBUTORS);
    const chartLabels = chartData.map((row) => {
      const date = new Date(row.ACTIVITY_DATE);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    });

    return {
      ...metric,
      value: data.avgContributors.toLocaleString(),
      subtitle: 'Average active contributors over the past year',
      chartData: {
        labels: chartLabels,
        datasets: [
          {
            data: contributorValues,
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
        ...this.sparklineOptions,
        plugins: {
          ...this.sparklineOptions.plugins,
          tooltip: {
            ...(this.sparklineOptions.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => context[0].label,
              label: (context: TooltipItem<'line'>) => {
                const count = context.parsed.y;
                return `Active contributors: ${count.toLocaleString()}`;
              },
            },
          },
        },
      },
    };
  }

  private transformMaintainers(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.maintainersData();

    return {
      ...metric,
      value: data.avgMaintainers.toString(),
      subtitle: 'Average maintainers over the past year',
      chartData: {
        labels: data.trendLabels,
        datasets: [
          {
            data: data.trendData,
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
        ...this.sparklineOptions,
        plugins: {
          ...this.sparklineOptions.plugins,
          tooltip: {
            ...(this.sparklineOptions.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'line'>[]) => context[0].label,
              label: (context: TooltipItem<'line'>) => {
                const count = context.parsed.y;
                return `Active maintainers: ${count}`;
              },
            },
          },
        },
      },
    };
  }

  private transformEvents(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.eventsData();

    // Reverse the data to show oldest to newest for chart rendering
    const chartData = [...data.data].reverse();
    const eventCounts = chartData.map((row) => row.EVENT_COUNT);
    const chartLabels = chartData.map((row) => {
      const date = new Date(row.MONTH_START_DATE);
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    });

    return {
      ...metric,
      value: data.totalEvents.toLocaleString(),
      subtitle: `Total events over ${data.totalMonths} months`,
      chartData: {
        labels: chartLabels,
        datasets: [
          {
            data: eventCounts,
            backgroundColor: metric.chartColor || lfxColors.blue[500],
            borderColor: metric.chartColor || lfxColors.blue[500],
            borderWidth: 0,
          },
        ],
      },
      chartOptions: {
        ...this.barChartOptions,
        plugins: {
          ...this.barChartOptions.plugins,
          tooltip: {
            ...(this.barChartOptions.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context: TooltipItem<'bar'>[]) => context[0].label,
              label: (context: TooltipItem<'bar'>) => {
                const count = context.parsed.y;
                return `Events: ${count.toLocaleString()}`;
              },
            },
          },
        },
      },
    };
  }

  private transformProjectHealthScores(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.healthScoresData();

    return {
      ...metric,
      value: '',
      subtitle: '',
      healthScores: data,
    };
  }

  private transformDefault(metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      value: 'N/A',
      subtitle: 'No data available',
    };
  }

  private initializeTotalProjectsData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.totalProjectsLoading.set(true);

          return this.analyticsService.getFoundationTotalProjects(foundationSlug).pipe(finalize(() => this.totalProjectsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          totalProjects: 0,
          monthlyData: [],
          monthlyLabels: [],
        },
      }
    );
  }

  private initializeTotalMembersData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.totalMembersLoading.set(true);

          return this.analyticsService.getFoundationTotalMembers(foundationSlug).pipe(finalize(() => this.totalMembersLoading.set(false)));
        })
      ),
      {
        initialValue: {
          totalMembers: 0,
          monthlyData: [],
          monthlyLabels: [],
        },
      }
    );
  }

  private initializeSoftwareValueData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.softwareValueLoading.set(true);

          return this.analyticsService.getFoundationSoftwareValue(foundationSlug).pipe(finalize(() => this.softwareValueLoading.set(false)));
        })
      ),
      {
        initialValue: {
          totalValue: 0,
          topProjects: [],
        },
      }
    );
  }

  private initializeMaintainersData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.maintainersLoading.set(true);

          return this.analyticsService.getFoundationMaintainers(foundationSlug).pipe(finalize(() => this.maintainersLoading.set(false)));
        })
      ),
      {
        initialValue: {
          avgMaintainers: 0,
          trendData: [],
          trendLabels: [],
        },
      }
    );
  }

  private initializeHealthScoresData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.healthScoresLoading.set(true);

          return this.analyticsService.getFoundationHealthScoreDistribution(foundationSlug).pipe(finalize(() => this.healthScoresLoading.set(false)));
        })
      ),
      {
        initialValue: {
          excellent: 0,
          healthy: 0,
          stable: 0,
          unsteady: 0,
          critical: 0,
        },
      }
    );
  }

  private initializeActiveContributorsData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.activeContributorsLoading.set(true);

          return this.analyticsService.getUniqueContributorsDaily(foundationSlug, 'foundation').pipe(finalize(() => this.activeContributorsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          data: [],
          avgContributors: 0,
          totalDays: 0,
        } as UniqueContributorsDailyResponse,
      }
    );
  }

  private initializeEventsData() {
    return toSignal(
      this.selectedFoundationSlug$.pipe(
        switchMap((foundationSlug) => {
          this.eventsLoading.set(true);

          return this.analyticsService.getHealthEventsMonthly(foundationSlug, 'foundation').pipe(finalize(() => this.eventsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          data: [],
          totalEvents: 0,
          totalMonths: 0,
        } as HealthEventsMonthlyResponse,
      }
    );
  }
}
