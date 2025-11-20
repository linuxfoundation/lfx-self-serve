// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, input, signal, ViewChild } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { AGGREGATE_FOUNDATION_METRICS, FOUNDATION_BAR_CHART_OPTIONS, FOUNDATION_SPARKLINE_CHART_OPTIONS } from '@lfx-one/shared/constants';
import { FoundationMetricCard, MetricCategory, TopProjectDisplay } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-foundation-health',
  standalone: true,
  imports: [CommonModule, FilterPillsComponent, ChartComponent],
  templateUrl: './foundation-health.component.html',
  styleUrl: './foundation-health.component.scss',
})
export class FoundationHealthComponent {
  @ViewChild('carouselScroll') public carouselScrollContainer!: ElementRef;

  public readonly title = input<string>('Foundation Health');

  public readonly selectedFilter = signal<string>('all');

  public readonly filterOptions: FilterOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributors', label: 'Contribution' },
    { id: 'projects', label: 'Project' },
    { id: 'events', label: 'Event' },
  ];

  public readonly sparklineOptions = FOUNDATION_SPARKLINE_CHART_OPTIONS;

  public readonly barChartOptions = FOUNDATION_BAR_CHART_OPTIONS;

  private readonly allMetricCards = computed<FoundationMetricCard[]>(() => {
    const metrics = AGGREGATE_FOUNDATION_METRICS;

    return [
      {
        icon: 'fa-light fa-chart-bar',
        title: 'Total Projects',
        value: metrics.totalProjects.toLocaleString(),
        subtitle: 'Across all foundations',
        category: 'projects' as MetricCategory,
        testId: 'foundation-health-card-total-projects',
        customContentType: 'sparkline',
        chartData: this.createSparklineData(metrics.totalProjectsData, '#0094FF'),
      },
      {
        icon: 'fa-light fa-users',
        title: 'Total Members',
        value: metrics.totalMembers.toLocaleString(),
        subtitle: 'Member organizations',
        category: 'projects' as MetricCategory,
        testId: 'foundation-health-card-total-members',
        customContentType: 'sparkline',
        chartData: this.createSparklineData(metrics.totalMembersData, '#0094FF'),
      },
      {
        icon: 'fa-light fa-chart-bar',
        title: 'Software Value',
        value: this.formatSoftwareValue(metrics.softwareValue),
        subtitle: 'Estimated total value of software managed',
        category: 'projects' as MetricCategory,
        testId: 'foundation-health-card-software-value',
        customContentType: 'top-projects',
        topProjects: this.formatTopProjects(metrics.topProjectsByValue),
      },
      {
        icon: 'fa-light fa-shield',
        title: 'Company Bus Factor',
        value: metrics.companyBusFactor.topCompaniesCount.toString(),
        subtitle: 'Companies account for >50% code contributions',
        category: 'contributors' as MetricCategory,
        testId: 'foundation-health-card-company-bus-factor',
        customContentType: 'bus-factor',
        busFactor: metrics.companyBusFactor,
      },
      {
        icon: 'fa-light fa-code',
        title: 'Active Contributors',
        value: metrics.avgActiveContributors.toLocaleString(),
        subtitle: 'Average active contributors over the past year',
        category: 'contributors' as MetricCategory,
        testId: 'foundation-health-card-active-contributors',
        customContentType: 'sparkline',
        chartData: this.createSparklineData(metrics.activeContributorsData, '#0094FF'),
      },
      {
        icon: 'fa-light fa-user-check',
        title: 'Maintainers',
        value: metrics.avgMaintainers.toString(),
        subtitle: 'Average maintainers over the past year',
        category: 'contributors' as MetricCategory,
        testId: 'foundation-health-card-maintainers',
        customContentType: 'sparkline',
        chartData: this.createSparklineData(metrics.maintainersData, '#0094FF'),
      },
      {
        icon: 'fa-light fa-calendar',
        title: 'Events',
        value: metrics.totalEvents.toString(),
        subtitle: 'Total events over 12 months',
        category: 'events' as MetricCategory,
        testId: 'foundation-health-card-events',
        customContentType: 'bar-chart',
        chartData: this.createBarChartData(metrics.eventsMonthlyData, '#0094FF'),
      },
      {
        icon: 'fa-light fa-chart-bar',
        title: 'Project Health Scores',
        value: '',
        subtitle: '',
        category: 'projects' as MetricCategory,
        testId: 'foundation-health-card-project-health-scores',
        customContentType: 'health-scores',
        healthScores: metrics.projectHealthDistribution,
      },
    ];
  });

  public readonly metricCards = computed<FoundationMetricCard[]>(() => {
    const filter = this.selectedFilter();
    const allCards = this.allMetricCards();

    if (filter === 'all') {
      return allCards;
    }

    return allCards.filter((card) => card.category === filter);
  });

  public readonly healthScoreDistribution = computed(() => {
    const metrics = AGGREGATE_FOUNDATION_METRICS;
    const distribution = metrics.projectHealthDistribution;

    const data = [
      { category: 'Critical', count: distribution.critical, color: '#EF4444' },
      { category: 'Unsteady', count: distribution.unsteady, color: '#FB923C' },
      { category: 'Stable', count: distribution.stable, color: '#F59E0B' },
      { category: 'Healthy', count: distribution.healthy, color: '#0094FF' },
      { category: 'Excellent', count: distribution.excellent, color: '#10bc8a' },
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
      return `${billions.toFixed(1)}B`;
    }
    return `${valueInMillions.toLocaleString()}M`;
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
}
