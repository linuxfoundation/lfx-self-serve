// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, lfxColors, PRIMARY_FOUNDATION_HEALTH_METRICS } from '@lfx-one/shared/constants';
import { DashboardDrawerType, FilterPillOption } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

import { ActiveContributorsDrawerComponent } from '../active-contributors-drawer/active-contributors-drawer.component';
import { EventsDrawerComponent } from '../events-drawer/events-drawer.component';
import { MaintainersDrawerComponent } from '../maintainers-drawer/maintainers-drawer.component';
import { OrgDependencyDrawerComponent } from '../org-dependency-drawer/org-dependency-drawer.component';
import { ProjectHealthScoresDrawerComponent } from '../project-health-scores-drawer/project-health-scores-drawer.component';
import { ProjectStaffCardComponent } from '../project-staff-card/project-staff-card.component';
import { TotalMembersDrawerComponent } from '../total-members-drawer/total-members-drawer.component';
import { TotalProjectsDrawerComponent } from '../total-projects-drawer/total-projects-drawer.component';
import { TotalValueDrawerComponent } from '../total-value-drawer/total-value-drawer.component';

import type {
  CompanyBusFactor,
  DashboardMetricCard,
  FoundationCompanyBusFactorResponse,
  FoundationValueConcentrationResponse,
  HealthEventsMonthlyResponse,
  UniqueContributorsDailyResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-foundation-health',
  imports: [
    FilterPillsComponent,
    MetricCardComponent,
    DataCopilotComponent,
    ScrollShadowDirective,
    ProjectStaffCardComponent,
    TotalValueDrawerComponent,
    TotalProjectsDrawerComponent,
    TotalMembersDrawerComponent,
    ActiveContributorsDrawerComponent,
    MaintainersDrawerComponent,
    EventsDrawerComponent,
    ProjectHealthScoresDrawerComponent,
    OrgDependencyDrawerComponent,
  ],
  templateUrl: './foundation-health.component.html',
  styleUrl: './foundation-health.component.scss',
})
export class FoundationHealthComponent {
  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly title = input<string>('Foundation Health');

  // Loading signals for each data source
  protected readonly totalProjectsLoading = signal(true);
  private readonly totalMembersLoading = signal(true);
  private readonly softwareValueLoading = signal(true);
  private readonly companyBusFactorLoading = signal(true);
  private readonly maintainersLoading = signal(true);
  private readonly healthScoresLoading = signal(true);
  private readonly activeContributorsLoading = signal(true);
  private readonly eventsLoading = signal(true);

  private readonly selectedFoundationSlug$ = toObservable(this.projectContextService.selectedFoundation).pipe(
    map((foundation) => foundation?.slug || ''),
    filter((slug) => !!slug)
  );
  public readonly hasFoundationSelected = computed<boolean>(() => !!this.projectContextService.selectedFoundation());

  // Data signals - each fetches its own data independently
  protected readonly totalProjectsData = this.initializeTotalProjectsData();
  protected readonly totalMembersData = this.initializeTotalMembersData();
  protected readonly softwareValueData = this.initializeSoftwareValueData();
  protected readonly companyBusFactorData = this.initializeCompanyBusFactorData();
  protected readonly maintainersData = this.initializeMaintainersData();
  protected readonly healthScoresData = this.initializeHealthScoresData();
  protected readonly activeContributorsData = this.initializeActiveContributorsData();
  protected readonly eventsData = this.initializeEventsData();

  public readonly selectedFilter = signal<string>('all');

  public readonly filterOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributors', label: 'Contribution' },
    { id: 'projects', label: 'Project' },
    { id: 'events', label: 'Event' },
    { id: 'staff', label: 'Staff' },
  ];

  // The Staff card sits in the same carousel as the metric cards. It renders on 'all' (alongside
  // everything else) and on 'staff' (as the only card). Other filters hide it.
  public readonly showStaffCard = computed(() => {
    const filter = this.selectedFilter();
    return filter === 'all' || filter === 'staff';
  });
  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());

  public readonly sparklineOptions = BASE_LINE_CHART_OPTIONS;
  public readonly barChartOptions = BASE_BAR_CHART_OPTIONS;

  // Individual computed signals for each card - each only depends on its own data
  private readonly totalProjectsCard = this.initializeTotalProjectsCard();
  private readonly totalMembersCard = this.initializeTotalMembersCard();
  private readonly softwareValueCard = this.initializeSoftwareValueCard();
  private readonly companyBusFactorCard = this.initializeCompanyBusFactorCard();
  private readonly activeContributorsCard = this.initializeActiveContributorsCard();
  private readonly maintainersCard = this.initializeMaintainersCard();
  private readonly eventsCard = this.initializeEventsCard();
  private readonly projectHealthScoresCard = this.initializeProjectHealthScoresCard();

  // Filtered cards - materializes card values while benefiting from individual signal memoization
  public readonly metricCards = this.initializeMetricCards();
  public readonly healthScoreDistribution = this.initializeHealthScoreDistribution();

  public readonly activeDrawer = signal<DashboardDrawerType | null>(null);
  protected readonly DashboardDrawerType = DashboardDrawerType;

  public handleFilterChange(filter: string): void {
    this.selectedFilter.set(filter);
  }

  public handleCardClick(drawerType: DashboardDrawerType): void {
    this.activeDrawer.set(drawerType);
  }

  public handleDrawerClose(): void {
    this.activeDrawer.set(null);
  }

  private initializeTotalProjectsCard() {
    return computed(() => this.transformTotalProjects(this.getMetricConfig('Total Projects')));
  }

  private initializeTotalMembersCard() {
    return computed(() => this.transformTotalMembers(this.getMetricConfig('Total Members')));
  }

  private initializeSoftwareValueCard() {
    return computed(() => this.transformSoftwareValue(this.getMetricConfig('Total Value of Projects')));
  }

  private initializeCompanyBusFactorCard() {
    return computed(() => this.transformCompanyBusFactor(this.getMetricConfig('Organization Dependency')));
  }

  private initializeActiveContributorsCard() {
    return computed(() => this.transformActiveContributors(this.getMetricConfig('Active Contributors')));
  }

  private initializeMaintainersCard() {
    return computed(() => this.transformMaintainers(this.getMetricConfig('Maintainers')));
  }

  private initializeEventsCard() {
    return computed(() => this.transformEvents(this.getMetricConfig('Events')));
  }

  private initializeProjectHealthScoresCard() {
    return computed(() => this.transformProjectHealthScores(this.getMetricConfig('Project Health Scores')));
  }

  private initializeMetricCards() {
    return computed(() => {
      const filter = this.selectedFilter();

      // Staff is a first-class filter with no backing metric-card — render the Project Staff card
      // alone (handled by the template's `showStaffCard` branch). Returning [] explicitly avoids
      // relying on the filter-by-category fallthrough below, which would silently re-break if a
      // new card ever got the 'staff' category.
      if (filter === 'staff') {
        return [];
      }

      const allCards = [
        { card: this.softwareValueCard(), category: 'projects' },
        { card: this.totalProjectsCard(), category: 'projects' },
        { card: this.totalMembersCard(), category: 'projects' },
        { card: this.companyBusFactorCard(), category: 'contributors' },
        { card: this.activeContributorsCard(), category: 'contributors' },
        { card: this.maintainersCard(), category: 'contributors' },
        { card: this.eventsCard(), category: 'events' },
        { card: this.projectHealthScoresCard(), category: 'projects' },
      ];

      if (filter === 'all') {
        return allCards.map((item) => item.card);
      }
      return allCards.filter((item) => item.category === filter).map((item) => item.card);
    });
  }

  private initializeHealthScoreDistribution() {
    return computed(() => {
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
        heightPx: maxCount > 0 ? Math.round((item.count / maxCount) * 64) : 0,
      }));
    });
  }

  private getMetricConfig(title: string): DashboardMetricCard {
    return PRIMARY_FOUNDATION_HEALTH_METRICS.find((m) => m.title === title)!;
  }

  private formatSoftwareValue(valueInMillions: number): string {
    if (valueInMillions >= 1000) {
      const billions = valueInMillions / 1000;
      return `${billions.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`;
    }
    return `${valueInMillions.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  }

  private transformTotalProjects(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.totalProjectsData();

    return {
      ...metric,
      loading: this.totalProjectsLoading(),
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
              title: (context) => context[0]?.label ?? '',
              label: (context) => {
                const count = context.parsed.y ?? 0;
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
      loading: this.totalMembersLoading(),
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
              title: (context) => context[0]?.label ?? '',
              label: (context) => {
                const count = context.parsed.y ?? 0;
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

    // Incremental bucket values: top1, top2-3, top4-5, all others
    const bucketValues = [data.top1Value, data.top3Value - data.top1Value, data.top5Value - data.top3Value, data.allOtherValue];

    return {
      ...metric,
      loading: this.softwareValueLoading(),
      value: `$${this.formatSoftwareValue(data.totalValue)}`,
      subtitle: "Estimated total value of all foundation's projects",
      chartData: {
        labels: ['Top 1', 'Top 2-3', 'Top 4-5', 'All Others'],
        datasets: [
          {
            data: bucketValues,
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
        ...this.sparklineOptions,
        plugins: {
          ...this.sparklineOptions.plugins,
          tooltip: {
            ...(this.sparklineOptions.plugins?.tooltip ?? {}),
            callbacks: {
              title: (context) => context[0]?.label ?? '',
              label: (context) => {
                const value = context.parsed.y ?? 0;
                return `Value: $${this.formatSoftwareValue(value)}`;
              },
            },
          },
        },
      },
    };
  }

  private transformCompanyBusFactor(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.companyBusFactorData();

    const busFactor: CompanyBusFactor = {
      topCompaniesCount: data.topCompaniesCount,
      topCompaniesPercentage: data.topCompaniesPercentage,
      otherCompaniesCount: data.otherCompaniesCount,
      otherCompaniesPercentage: data.otherCompaniesPercentage,
    };

    return {
      ...metric,
      loading: this.companyBusFactorLoading(),
      value: data.topCompaniesCount.toString(),
      subtitle: 'Contribution concentration across organizations',
      busFactor,
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
      loading: this.activeContributorsLoading(),
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
              title: (context) => context[0]?.label ?? '',
              label: (context) => {
                const count = context.parsed.y ?? 0;
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
      loading: this.maintainersLoading(),
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
              title: (context) => context[0]?.label ?? '',
              label: (context) => {
                const count = context.parsed.y ?? 0;
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
      loading: this.eventsLoading(),
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
              title: (context) => context[0]?.label ?? '',
              label: (context) => {
                const count = context.parsed.y ?? 0;
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
      loading: this.healthScoresLoading(),
      value: '',
      subtitle: '',
      healthScores: data,
    };
  }

  private initializeTotalProjectsData() {
    const defaultValue = {
      totalProjects: 0,
      monthlyData: [] as number[],
      monthlyLabels: [] as string[],
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.totalProjectsLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationTotalProjects(foundationSlug).pipe(
            tap(() => this.totalProjectsLoading.set(false)),
            catchError(() => {
              this.totalProjectsLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeTotalMembersData() {
    const defaultValue = {
      totalMembers: 0,
      monthlyData: [] as number[],
      monthlyLabels: [] as string[],
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.totalMembersLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationTotalMembers(foundationSlug).pipe(
            tap(() => this.totalMembersLoading.set(false)),
            catchError(() => {
              this.totalMembersLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeSoftwareValueData() {
    const defaultValue: FoundationValueConcentrationResponse = {
      totalValue: 0,
      top1Value: 0,
      top3Value: 0,
      top5Value: 0,
      allOtherValue: 0,
      totalProjectsCount: 0,
      top1Percentage: 0,
      top3Percentage: 0,
      top5Percentage: 0,
      allOtherPercentage: 0,
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.softwareValueLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationValueConcentration(foundationSlug).pipe(
            tap(() => this.softwareValueLoading.set(false)),
            catchError(() => {
              this.softwareValueLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeCompanyBusFactorData() {
    const defaultValue: FoundationCompanyBusFactorResponse = {
      topCompaniesCount: 0,
      topCompaniesPercentage: 0,
      otherCompaniesCount: 0,
      otherCompaniesPercentage: 0,
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.companyBusFactorLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getCompanyBusFactor(foundationSlug).pipe(
            tap(() => this.companyBusFactorLoading.set(false)),
            catchError(() => {
              this.companyBusFactorLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeMaintainersData() {
    const defaultValue = {
      avgMaintainers: 0,
      trendData: [] as number[],
      trendLabels: [] as string[],
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.maintainersLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationMaintainers(foundationSlug).pipe(
            tap(() => this.maintainersLoading.set(false)),
            catchError(() => {
              this.maintainersLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeHealthScoresData() {
    const defaultValue = {
      excellent: 0,
      healthy: 0,
      stable: 0,
      unsteady: 0,
      critical: 0,
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.healthScoresLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationHealthScoreDistribution(foundationSlug).pipe(
            tap(() => this.healthScoresLoading.set(false)),
            catchError(() => {
              this.healthScoresLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeActiveContributorsData() {
    const defaultValue: UniqueContributorsDailyResponse = {
      data: [],
      avgContributors: 0,
      totalDays: 0,
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.activeContributorsLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getUniqueContributorsDaily(foundationSlug, 'foundation').pipe(
            tap(() => this.activeContributorsLoading.set(false)),
            catchError(() => {
              this.activeContributorsLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeEventsData() {
    const defaultValue: HealthEventsMonthlyResponse = {
      data: [],
      totalEvents: 0,
      totalMonths: 0,
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.eventsLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getHealthEventsMonthly(foundationSlug, 'foundation').pipe(
            tap(() => this.eventsLoading.set(false)),
            catchError(() => {
              this.eventsLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }
}
