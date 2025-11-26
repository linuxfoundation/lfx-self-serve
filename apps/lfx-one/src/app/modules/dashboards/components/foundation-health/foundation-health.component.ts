// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, input, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { ChartComponent } from '@components/chart/chart.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import {
  AGGREGATE_FOUNDATION_METRICS,
  BASE_BAR_CHART_OPTIONS,
  BASE_LINE_CHART_OPTIONS,
  lfxColors,
  PRIMARY_FOUNDATION_HEALTH_METRICS,
} from '@lfx-one/shared/constants';
import { FoundationMetricCard, MetricCategory, PrimaryFoundationHealthMetric, TopProjectDisplay } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { finalize, map, switchMap } from 'rxjs';

import type { TooltipItem } from 'chart.js';
@Component({
  selector: 'lfx-foundation-health',
  standalone: true,
  imports: [CommonModule, FilterPillsComponent, ChartComponent, DataCopilotComponent],
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
  private readonly selectedFoundationSlug$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((foundation) => foundation?.slug || ''));
  public readonly hasFoundationSelected = computed<boolean>(() => !!this.projectContextService.selectedFoundation());
  private readonly totalProjectsData = this.initializeTotalProjectsData();
  private readonly totalMembersData = this.initializeTotalMembersData();
  private readonly softwareValueData = this.initializeSoftwareValueData();
  private readonly maintainersData = this.initializeMaintainersData();
  private readonly healthScoresData = this.initializeHealthScoresData();
  public readonly isLoading = computed<boolean>(
    () => this.totalProjectsLoading() || this.totalMembersLoading() || this.softwareValueLoading() || this.maintainersLoading() || this.healthScoresLoading()
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

  public readonly metricCards = computed<FoundationMetricCard[]>(() => {
    const filter = this.selectedFilter();
    const allCards = this.allMetricCards();

    if (filter === 'all') {
      return allCards;
    }

    return allCards.filter((card) => card.category === filter);
  });

  private readonly allMetricCards = computed<FoundationMetricCard[]>(() => {
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

  private createSparklineData(data: number[], color: string) {
    return {
      labels: Array.from({ length: data.length }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data,
          borderColor: color,
          backgroundColor: hexToRgba(color, 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  }

  private createBarChartData(data: number[], color: string) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return {
      labels: months,
      datasets: [
        {
          data,
          backgroundColor: color,
          borderColor: color,
          borderWidth: 0,
        },
      ],
    };
  }

  private transformTotalProjects(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    const data = this.totalProjectsData();

    return {
      icon: metric.icon,
      title: metric.title,
      value: data.totalProjects.toLocaleString(),
      subtitle: 'Across all foundations',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      chartData: {
        labels: data.monthlyLabels,
        datasets: [
          {
            data: data.monthlyData,
            borderColor: metric.sparklineColor || lfxColors.blue[500],
            backgroundColor: hexToRgba(metric.sparklineColor || lfxColors.blue[500], 0.1),
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

  private transformTotalMembers(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    const data = this.totalMembersData();

    return {
      icon: metric.icon,
      title: metric.title,
      value: data.totalMembers.toLocaleString(),
      subtitle: 'Member organizations',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      chartData: {
        labels: data.monthlyLabels,
        datasets: [
          {
            data: data.monthlyData,
            borderColor: metric.sparklineColor || lfxColors.blue[500],
            backgroundColor: hexToRgba(metric.sparklineColor || lfxColors.blue[500], 0.1),
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

  private transformSoftwareValue(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    const data = this.softwareValueData();

    return {
      icon: metric.icon,
      title: metric.title,
      value: this.formatSoftwareValue(data.totalValue),
      subtitle: 'Estimated total value of software managed',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      topProjects: this.formatTopProjects(data.topProjects),
    };
  }

  private transformCompanyBusFactor(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    // TODO: Replace with real API data when endpoint is available
    const metrics = AGGREGATE_FOUNDATION_METRICS;

    return {
      icon: metric.icon,
      title: metric.title,
      value: metrics.companyBusFactor.topCompaniesCount.toString(),
      subtitle: 'Companies account for >50% code contributions',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      busFactor: metrics.companyBusFactor,
    };
  }

  private transformActiveContributors(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    // TODO: Replace with real API data when endpoint is available
    const metrics = AGGREGATE_FOUNDATION_METRICS;

    return {
      icon: metric.icon,
      title: metric.title,
      value: metrics.avgActiveContributors.toLocaleString(),
      subtitle: 'Average active contributors over the past year',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      chartData: this.createSparklineData(metrics.activeContributorsData, metric.sparklineColor || lfxColors.blue[500]),
    };
  }

  private transformMaintainers(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    const data = this.maintainersData();

    return {
      icon: metric.icon,
      title: metric.title,
      value: data.avgMaintainers.toString(),
      subtitle: 'Average maintainers over the past year',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      chartData: {
        labels: data.trendLabels,
        datasets: [
          {
            data: data.trendData,
            borderColor: metric.sparklineColor || lfxColors.blue[500],
            backgroundColor: hexToRgba(metric.sparklineColor || lfxColors.blue[500], 0.1),
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

  private transformEvents(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    // TODO: Replace with real API data when endpoint is available
    const metrics = AGGREGATE_FOUNDATION_METRICS;

    return {
      icon: metric.icon,
      title: metric.title,
      value: metrics.totalEvents.toString(),
      subtitle: 'Total events over 12 months',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      chartData: this.createBarChartData(metrics.eventsMonthlyData, metric.chartColor || lfxColors.blue[500]),
    };
  }

  private transformProjectHealthScores(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    const data = this.healthScoresData();

    return {
      icon: metric.icon,
      title: metric.title,
      value: '',
      subtitle: '',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
      healthScores: data,
    };
  }

  private transformDefault(metric: PrimaryFoundationHealthMetric): FoundationMetricCard {
    return {
      icon: metric.icon,
      title: metric.title,
      value: 'N/A',
      subtitle: 'No data available',
      category: metric.category as MetricCategory,
      testId: metric.testId,
      customContentType: metric.customContentType,
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
}
