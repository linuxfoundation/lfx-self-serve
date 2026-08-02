// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import {
  BASE_BAR_CHART_OPTIONS,
  BASE_LINE_CHART_OPTIONS,
  DEFAULT_FOUNDATION_HEALTH_SCORE_DISTRIBUTION,
  DEFAULT_FOUNDATION_MAINTAINERS,
  lfxColors,
  PROJECT_HEALTH_CHART_CATEGORIES,
  PROJECT_HEALTH_CHART_CATEGORY_COLOR,
  PROJECT_HEALTH_CHART_CATEGORY_LABEL,
  PRIMARY_FOUNDATION_HEALTH_METRICS,
} from '@lfx-one/shared/constants';
import { DashboardDrawerType, FilterPillOption, ZeroStubBarDataset } from '@lfx-one/shared/interfaces';
import { hexToRgba, computePeriodChange, computeHealthyOrBetterPct, computeScoredCount } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

import { ActiveContributorsDrawerComponent } from '../active-contributors-drawer/active-contributors-drawer.component';
import { EventsDrawerComponent } from '../events-drawer/events-drawer.component';
import { MaintainersDrawerComponent } from '../maintainers-drawer/maintainers-drawer.component';
import { OrgDependencyDrawerComponent } from '../org-dependency-drawer/org-dependency-drawer.component';
import { ProjectHealthScoresDrawerComponent } from '../project-health-scores-drawer/project-health-scores-drawer.component';
import { TotalMembersDrawerComponent } from '../total-members-drawer/total-members-drawer.component';
import { TotalProjectsDrawerComponent } from '../total-projects-drawer/total-projects-drawer.component';
import { TotalValueDrawerComponent } from '../total-value-drawer/total-value-drawer.component';

import type {
  CompanyBusFactor,
  DashboardMetricCard,
  FoundationActiveContributorsMonthlyDistinctResponse,
  FoundationCompanyBusFactorResponse,
  FoundationEventsQuarterlyResponse,
  FoundationHealthScoreDistributionResponse,
  FoundationMaintainersMonthlyResponse,
  FoundationMaintainersResponse,
  FoundationValueConcentrationResponse,
  UniqueContributorsDailyResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-foundation-health',
  imports: [
    FilterPillsComponent,
    MetricCardComponent,
    DataCopilotComponent,
    ScrollShadowDirective,
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
  protected readonly totalMembersLoading = signal(true);
  private readonly softwareValueLoading = signal(true);
  private readonly companyBusFactorLoading = signal(true);
  private readonly maintainersLoading = signal(true);
  protected readonly maintainersMonthlyLoading = signal(true);
  protected readonly healthScoresLoading = signal(true);
  protected readonly activeContributorsMonthlyDistinctLoading = signal(true);
  private readonly activeContributorsLoading = signal(true);
  protected readonly eventsLoading = signal(true);

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
  protected readonly maintainersMonthlyData = this.initializeMaintainersMonthlyData();
  protected readonly healthScoresData = this.initializeHealthScoresData();
  protected readonly activeContributorsData = this.initializeActiveContributorsData();
  protected readonly activeContributorsMonthlyDistinctData = this.initializeActiveContributorsMonthlyDistinctData();
  protected readonly eventsQuarterlyData = this.initializeEventsQuarterlyData();

  // totalProjectsData retains the prior foundation's total until the next request
  // resolves; surface 0 while loading so the card and drawer never reconcile a
  // new scored count against a stale total.
  protected readonly reconciledTotalProjects = computed(() => (this.totalProjectsLoading() ? 0 : this.totalProjectsData().totalProjects));

  // healthScoresData likewise retains the prior foundation's distribution during a
  // switch; surface the zeroed default while loading so the drawer chart/badge
  // never renders the previous foundation's buckets for the newly selected one.
  protected readonly reconciledHealthScoresData = computed(() =>
    this.healthScoresLoading() ? DEFAULT_FOUNDATION_HEALTH_SCORE_DISTRIBUTION : this.healthScoresData()
  );

  // Surface a zeroed default while loading so the drawer headline never shows the prior foundation's average.
  protected readonly reconciledActiveContributorsData = computed<UniqueContributorsDailyResponse>(() =>
    this.activeContributorsLoading() ? { data: [], avgContributors: 0, totalDays: 0 } : this.activeContributorsData()
  );

  // Surface a zeroed default while loading so the drawer headline (currentMaintainers/asOfDate)
  // never renders the previous foundation's value during a switch.
  protected readonly reconciledMaintainersData = computed<FoundationMaintainersResponse>(() =>
    this.maintainersLoading() ? DEFAULT_FOUNDATION_MAINTAINERS : this.maintainersData()
  );

  public readonly selectedFilter = signal<string>('all');

  public readonly filterOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributors', label: 'Contribution' },
    { id: 'projects', label: 'Project' },
    { id: 'events', label: 'Event' },
  ];

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
    const { trend, changePercentage } = computePeriodChange(data.monthlyData);

    return {
      ...metric,
      loading: this.totalProjectsLoading(),
      value: data.totalProjects.toLocaleString(),
      subtitle: `Total ${this.projectContextService.selectedFoundation()?.name} projects`,
      trend,
      changePercentage,
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
    const { trend, changePercentage } = computePeriodChange(data.monthlyData);

    return {
      ...metric,
      loading: this.totalMembersLoading(),
      value: data.totalMembers.toLocaleString(),
      subtitle: `Total ${this.projectContextService.selectedFoundation()?.name} members`,
      trend,
      changePercentage,
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

    // Incremental bucket values: top1, top2-3, top4-5, all others.
    // Clamp to 0 so a non-monotonic API response can't render a negative segment.
    const bucketLabels = ['Top 1', 'Top 2-3', 'Top 4-5', 'All Others'];
    const bucketValues = [
      Math.max(0, data.top1Value),
      Math.max(0, data.top3Value - data.top1Value),
      Math.max(0, data.top5Value - data.top3Value),
      Math.max(0, data.allOtherValue),
    ];
    const bucketColors = [lfxColors.emerald[600], lfxColors.emerald[400], lfxColors.emerald[300], lfxColors.emerald[200]];

    return {
      ...metric,
      loading: this.softwareValueLoading(),
      value: `$${this.formatSoftwareValue(data.totalValue)}`,
      subtitle: "Estimated total value of all foundation's projects",
      chartData: {
        labels: [''],
        datasets: bucketLabels.map((label, i) => ({
          label,
          data: [bucketValues[i]],
          backgroundColor: bucketColors[i],
        })),
      },
      chartOptions: {
        ...this.barChartOptions,
        scales: {
          ...this.barChartOptions.scales,
          x: { ...this.barChartOptions.scales?.['x'], display: false, stacked: true },
          y: { ...this.barChartOptions.scales?.['y'], display: false, stacked: true, min: 0 },
        },
        datasets: {
          bar: {
            ...this.barChartOptions.datasets?.bar,
            borderRadius: 0,
          },
        },
        interaction: { mode: 'nearest' as const, intersect: true },
        hover: { mode: 'nearest' as const, intersect: true },
        plugins: {
          ...this.barChartOptions.plugins,
          legend: { display: false },
          tooltip: {
            ...(this.barChartOptions.plugins?.tooltip ?? {}),
            mode: 'nearest' as const,
            intersect: true,
            callbacks: {
              title: (context) => context[0]?.dataset?.label ?? '',
              label: (context) => `Value: $${this.formatSoftwareValue(context.parsed.y ?? 0)}`,
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
    const data = this.activeContributorsMonthlyDistinctData();
    const values = data.monthlyData;
    const labels = data.monthlyLabels;

    // MoM is server-validated for adjacent current months; render it directly.
    const trend: DashboardMetricCard['trend'] = data.momDirection === 'flat' ? 'neutral' : data.momDirection;
    let changePercentage: string | undefined;
    if (data.momDeltaPercent !== null) {
      const sign = data.momDeltaPercent > 0 ? '+' : '';
      let arrow = '';
      if (data.momDirection === 'up') {
        arrow = '▲';
      } else if (data.momDirection === 'down') {
        arrow = '▼';
      }
      const prefix = arrow ? `${arrow} ` : '';
      changePercentage = `${prefix}${sign}${data.momDeltaPercent.toFixed(1)}% vs last month`;
    }

    return {
      ...metric,
      loading: this.activeContributorsMonthlyDistinctLoading(),
      value: data.monthlyData.length > 0 ? data.latest.toLocaleString('en-US') : '',
      subtitle: 'Monthly distinct active contributors',
      trend,
      changePercentage,
      chartData: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            // A single-point line dataset has no segment, so the sole point
            // must be visible or the sparkline renders blank for new foundations.
            pointRadius: values.length === 1 ? 3 : 0,
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
    const asOfLabel = data.asOfDate
      ? new Date(`${data.asOfDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : null;
    const { trend, changePercentage } = computePeriodChange(this.maintainersMonthlyData().monthlyData);

    return {
      ...metric,
      loading: this.maintainersLoading() || this.maintainersMonthlyLoading(),
      value: data.currentMaintainers.toLocaleString(),
      subtitle: asOfLabel ? `As of ${asOfLabel}` : 'Distinct active maintainers',
      trend,
      changePercentage,
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
                return `Active maintainers: ${count.toLocaleString()}`;
              },
            },
          },
        },
      },
    };
  }

  private transformEvents(metric: DashboardMetricCard): DashboardMetricCard {
    const data = this.eventsQuarterlyData();
    const { trend, changePercentage } = computePeriodChange(data.quarterlyData, 'vs last quarter');
    const eventColor = metric.chartColor || lfxColors.blue[500];

    return {
      ...metric,
      loading: this.eventsLoading(),
      value: data.quarterlyData.length ? data.quarterlyData[data.quarterlyData.length - 1].toLocaleString('en-US') : '0',
      subtitle: 'Total events last quarter',
      trend,
      changePercentage,
      chartData: {
        labels: data.quarterlyLabels,
        datasets: [
          {
            data: data.quarterlyData,
            // Opt this dataset into the zero-bar stub plugin so empty quarters
            // render as a 4px gray stub instead of invisible zero-height bars.
            zeroStub: true,
            backgroundColor: eventColor,
            // Pin hover color to the bar fill so the active bar doesn't darken (matches the events drawer).
            hoverBackgroundColor: eventColor,
            borderColor: eventColor,
            borderWidth: 0,
          } as ZeroStubBarDataset,
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
    const scored = computeScoredCount(data);

    // "Healthy or better" is the card's health KPI; the distribution chart is the visualization,
    // parallel to the sparkline/bar chart on the other foundation-health cards.
    const value = scored > 0 ? `${computeHealthyOrBetterPct(data)}%` : '';

    // Same 6 bars the drawer draws (leading Unscored + 5 scored) so the card mini-chart
    // and the drawer's full chart never disagree on which buckets exist.
    const barColors = PROJECT_HEALTH_CHART_CATEGORIES.map((category) => PROJECT_HEALTH_CHART_CATEGORY_COLOR[category]);

    return {
      ...metric,
      loading: this.healthScoresLoading(),
      value,
      subtitle: 'Projects rated by their health score',
      chartData: {
        labels: PROJECT_HEALTH_CHART_CATEGORIES.map((category) => PROJECT_HEALTH_CHART_CATEGORY_LABEL[category]),
        datasets: [
          {
            data: PROJECT_HEALTH_CHART_CATEGORIES.map((category) => data[category] ?? 0),
            // Opt into the zero-bar stub plugin so empty buckets render as a 4px gray
            // stub instead of invisible zero-height bars (matches the events card).
            zeroStub: true,
            backgroundColor: barColors,
            // Pin hover color per-bar so the active bar doesn't darken and the rest don't read as ghosted.
            hoverBackgroundColor: barColors,
            borderRadius: 4,
            borderSkipped: 'start',
          } as ZeroStubBarDataset,
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
              label: (context) => `${(context.parsed.y ?? 0).toLocaleString('en-US')} projects`,
            },
          },
        },
      },
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
    const defaultValue = DEFAULT_FOUNDATION_MAINTAINERS;

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

  private initializeMaintainersMonthlyData() {
    const defaultValue: FoundationMaintainersMonthlyResponse = {
      monthlyData: [],
      monthlyLabels: [],
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.maintainersMonthlyLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationMaintainersMonthly(foundationSlug).pipe(
            tap(() => this.maintainersMonthlyLoading.set(false)),
            catchError(() => {
              this.maintainersMonthlyLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeHealthScoresData() {
    const defaultValue: FoundationHealthScoreDistributionResponse = {
      excellent: 0,
      healthy: 0,
      stable: 0,
      unsteady: 0,
      critical: 0,
      unscored: 0,
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

  private initializeActiveContributorsMonthlyDistinctData() {
    const defaultValue: FoundationActiveContributorsMonthlyDistinctResponse = {
      monthlyData: [],
      monthlyLabels: [],
      latest: 0,
      momDeltaPercent: null,
      momDirection: 'flat',
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.activeContributorsMonthlyDistinctLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationActiveContributorsMonthlyDistinct(foundationSlug).pipe(
            tap(() => this.activeContributorsMonthlyDistinctLoading.set(false)),
            catchError(() => {
              this.activeContributorsMonthlyDistinctLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeEventsQuarterlyData() {
    const defaultValue: FoundationEventsQuarterlyResponse = {
      quarterlyData: [],
      quarterlyLabels: [],
    };

    return toSignal(
      this.selectedFoundationSlug$.pipe(
        tap(() => this.eventsLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getFoundationEventsQuarterly(foundationSlug).pipe(
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
