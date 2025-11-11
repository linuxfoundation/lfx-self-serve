// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AccountContextService } from '@app/shared/services/account-context.service';
import { AnalyticsService } from '@app/shared/services/analytics.service';
import { ChartComponent } from '@components/chart/chart.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { BAR_CHART_OPTIONS, PRIMARY_INVOLVEMENT_METRICS, SPARKLINE_CHART_OPTIONS } from '@lfx-one/shared/constants';
import { OrganizationInvolvementMetricWithChart, PrimaryInvolvementMetric } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';
import { finalize, map, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-organization-involvement',
  standalone: true,
  imports: [CommonModule, ChartComponent, TooltipModule, FilterPillsComponent],
  templateUrl: './organization-involvement.component.html',
  styleUrl: './organization-involvement.component.scss',
})
export class OrganizationInvolvementComponent {
  @ViewChild('carouselScroll') public carouselScrollContainer!: ElementRef;

  private readonly analyticsService = inject(AnalyticsService);
  private readonly accountContextService = inject(AccountContextService);

  private readonly contributionsLoading = signal(true);
  private readonly dashboardLoading = signal(true);
  private readonly eventsLoading = signal(true);
  private readonly selectedAccountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));
  private readonly contributionsOverviewData = this.initializeContributionsOverviewData();
  private readonly boardMemberDashboardData = this.initializeBoardMemberDashboardData();
  private readonly eventsOverviewData = this.initializeEventsOverviewData();
  public readonly isLoading = computed<boolean>(() => this.contributionsLoading() || this.dashboardLoading() || this.eventsLoading());
  public readonly selectedFilter = signal<string>('all');
  public readonly accountName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Organization');
  public readonly sparklineChartOptions = SPARKLINE_CHART_OPTIONS;
  public readonly barChartOptions = BAR_CHART_OPTIONS;
  public readonly filterOptions: FilterOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributions', label: 'Contributions' },
    { id: 'events', label: 'Events' },
    { id: 'education', label: 'Education' },
  ];

  public readonly primaryMetrics = computed<OrganizationInvolvementMetricWithChart[]>((): OrganizationInvolvementMetricWithChart[] => {
    const contributionsData = this.contributionsOverviewData();
    const dashboardData = this.boardMemberDashboardData();
    const eventsData = this.eventsOverviewData();
    const filter = this.selectedFilter();

    const allMetrics = PRIMARY_INVOLVEMENT_METRICS.map((metric) => {
      if (metric.title === 'Active Contributors') {
        return this.transformActiveContributors(contributionsData.contributors, metric);
      }
      if (metric.title === 'Maintainers') {
        return this.transformMaintainers(contributionsData.maintainers, metric);
      }
      if (metric.title === 'Event Attendees') {
        return this.transformEventAttendees(eventsData.eventAttendance, metric);
      }
      if (metric.title === 'Event Speakers') {
        return this.transformEventSpeakers(eventsData.eventAttendance, metric);
      }
      if (metric.title === 'Certified Employees') {
        return this.transformCertifiedEmployees(dashboardData.certifiedEmployees, metric);
      }
      if (metric.title === 'Training Enrollments') {
        return this.transformTrainingEnrollments(metric);
      }
      if (metric.isMembershipTier) {
        return this.transformMembershipTier(dashboardData.membershipTier, metric);
      }
      return this.transformDefaultMetric(metric);
    });

    // Filter metrics based on selected filter
    if (filter === 'all') {
      return allMetrics;
    }

    // Always show Membership Tier
    const filteredMetrics = allMetrics.filter((metric) => {
      if (metric.isMembershipTier) return true;

      if (filter === 'contributions') {
        return metric.title === 'Active Contributors' || metric.title === 'Maintainers';
      }
      if (filter === 'events') {
        return metric.title === 'Event Attendees' || metric.title === 'Event Speakers';
      }
      if (filter === 'education') {
        return metric.title === 'Certified Employees' || metric.title === 'Training Enrollments';
      }
      return false;
    });

    return filteredMetrics;
  });

  public handleFilterChange(filter: string): void {
    this.selectedFilter.set(filter);
  }

  public scrollLeft(): void {
    if (!this.carouselScrollContainer?.nativeElement) return;
    const container = this.carouselScrollContainer.nativeElement;
    container.scrollBy({ left: -300, behavior: 'smooth' });
  }

  public scrollRight(): void {
    if (!this.carouselScrollContainer?.nativeElement) return;
    const container = this.carouselScrollContainer.nativeElement;
    container.scrollBy({ left: 300, behavior: 'smooth' });
  }

  private initializeContributionsOverviewData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.contributionsLoading.set(true);
          return this.analyticsService.getOrganizationContributionsOverview(accountId).pipe(finalize(() => this.contributionsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          maintainers: {
            maintainers: 0,
            projects: 0,
          },
          contributors: {
            contributors: 0,
            projects: 0,
          },
          technicalCommittee: {
            totalRepresentatives: 0,
            totalProjects: 0,
          },
          accountId: '',
          accountName: '',
        },
      }
    );
  }

  private initializeBoardMemberDashboardData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.dashboardLoading.set(true);
          return this.analyticsService.getBoardMemberDashboard(accountId).pipe(finalize(() => this.dashboardLoading.set(false)));
        })
      ),
      {
        initialValue: {
          membershipTier: {
            tier: '',
            membershipStartDate: '',
            membershipEndDate: '',
            membershipStatus: '',
          },
          certifiedEmployees: {
            certifications: 0,
            certifiedEmployees: 0,
          },
          boardMeetingAttendance: {
            totalMeetings: 0,
            attendedMeetings: 0,
            notAttendedMeetings: 0,
            attendancePercentage: 0,
          },
          accountId: '',
          projectId: '',
        },
      }
    );
  }

  private initializeEventsOverviewData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.eventsLoading.set(true);
          return this.analyticsService.getOrganizationEventsOverview(accountId).pipe(finalize(() => this.eventsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          eventAttendance: {
            totalAttendees: 0,
            totalSpeakers: 0,
            totalEvents: 0,
            accountName: '',
          },
          accountId: '',
          projectId: '',
        },
      }
    );
  }

  private transformActiveContributors(
    data: { contributors: number; projects: number },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: data.contributors.toString(),
      subtitle: 'Contributors from our organization',
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: metric.sparklineColor ?? '',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformMaintainers(data: { maintainers: number; projects: number }, metric: PrimaryInvolvementMetric): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: data.maintainers.toString(),
      subtitle: `Across ${data.projects} projects`,
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: metric.sparklineColor ?? '',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformMembershipTier(
    data: {
      tier: string;
      membershipStartDate: string;
      membershipEndDate: string;
      membershipStatus: string;
    },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    if (!data.tier) {
      return {
        title: metric.title,
        value: 'No Membership',
        subtitle: 'Not a member',
        icon: metric.icon ?? '',
        tier: '',
        tierSince: '',
        nextDue: '',
        isMembershipTier: metric.isMembershipTier,
      };
    }

    const startDate = new Date(data.membershipStartDate);
    const endDate = new Date(data.membershipEndDate);
    const tierSince = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const nextDue = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return {
      title: metric.title,
      value: data.tier,
      subtitle: `Active membership`,
      icon: metric.icon ?? '',
      tier: data.tier,
      tierSince,
      nextDue,
      isMembershipTier: metric.isMembershipTier,
    };
  }

  private transformEventAttendees(
    data: { totalAttendees: number; totalSpeakers: number; totalEvents: number; accountName: string },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: data.totalAttendees.toString(),
      subtitle: 'Employees at foundation events',
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: hexToRgba(metric.sparklineColor ?? '', 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformEventSpeakers(
    data: { totalAttendees: number; totalSpeakers: number; totalEvents: number; accountName: string },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: data.totalSpeakers.toString(),
      subtitle: 'Employee speakers at events',
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: hexToRgba(metric.sparklineColor ?? '', 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformCertifiedEmployees(
    data: { certifications: number; certifiedEmployees: number },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: `${data.certifiedEmployees} employees`,
      subtitle: `${data.certifications} total certifications`,
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: hexToRgba(metric.sparklineColor ?? '', 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformTrainingEnrollments(metric: PrimaryInvolvementMetric): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: '156',
      subtitle: 'Employees enrolled in training',
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: hexToRgba(metric.sparklineColor ?? '', 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformDefaultMetric(metric: PrimaryInvolvementMetric): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: metric.value ?? 'N/A',
      subtitle: metric.subtitle ?? 'No data available',
      icon: metric.icon ?? '',
      chartData: {
        labels: Array.from({ length: metric.sparklineData?.length ?? 0 }, (_, i) => `Point ${i + 1}`),
        datasets: [
          {
            data: metric.sparklineData ?? [],
            borderColor: metric.sparklineColor ?? '',
            backgroundColor: hexToRgba(metric.sparklineColor ?? '', 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }
}
