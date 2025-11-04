// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AccountContextService } from '@app/shared/services/account-context.service';
import { AnalyticsService } from '@app/shared/services/analytics.service';
import { ChartComponent } from '@components/chart/chart.component';
import { CONTRIBUTIONS_METRICS, IMPACT_METRICS, PRIMARY_INVOLVEMENT_METRICS } from '@lfx-one/shared/constants';
import { ContributionMetric, ImpactMetric, OrganizationInvolvementMetricWithChart, PrimaryInvolvementMetric } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';
import { finalize, map, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-organization-involvement',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  providers: [CurrencyPipe],
  templateUrl: './organization-involvement.component.html',
  styleUrl: './organization-involvement.component.scss',
})
export class OrganizationInvolvementComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly currencyPipe = inject(CurrencyPipe);

  // Loading state signals for each API call
  private readonly contributionsLoading = signal(true);
  private readonly dashboardLoading = signal(true);
  private readonly segmentLoading = signal(true);
  private readonly eventsLoading = signal(true);

  private readonly selectedAccountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));

  // Consolidated API call for contributions overview (maintainers + contributors + technical committee)
  private readonly contributionsOverviewData = toSignal(
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

  // Consolidated API call for board member dashboard (membership tier + certified employees + board meeting attendance)
  private readonly boardMemberDashboardData = toSignal(
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

  // Consolidated API call for segment overview (projects participating + total commits)
  private readonly segmentOverviewData = toSignal(
    this.selectedAccountId$.pipe(
      switchMap((accountId) => {
        this.segmentLoading.set(true);
        return this.analyticsService.getOrganizationSegmentOverview(accountId).pipe(finalize(() => this.segmentLoading.set(false)));
      })
    ),
    {
      initialValue: {
        projectsParticipating: 0,
        totalCommits: 0,
        accountId: '',
        segmentId: '',
      },
    }
  );

  // Consolidated API call for events overview (event attendance + event sponsorships)
  private readonly eventsOverviewData = toSignal(
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
        eventSponsorships: {
          currencySummaries: [],
          totalEvents: 0,
        },
        accountId: '',
        projectId: '',
      },
    }
  );

  protected readonly isLoading = computed<boolean>(() => {
    return this.contributionsLoading() || this.dashboardLoading() || this.segmentLoading() || this.eventsLoading();
  });

  protected readonly sparklineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false },
    },
  };

  protected readonly barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false },
    },
    datasets: {
      bar: {
        barPercentage: 0.9,
        categoryPercentage: 0.95,
        borderRadius: 4,
        borderSkipped: false,
      },
    },
  };

  protected readonly contributionsMetrics = computed<ContributionMetric[]>((): ContributionMetric[] => {
    const contributionsData = this.contributionsOverviewData();
    const segmentData = this.segmentOverviewData();
    const dashboardData = this.boardMemberDashboardData();

    return CONTRIBUTIONS_METRICS.map((metric) => {
      if (metric.title === 'TOC/TSC/TAG Participation') {
        return {
          ...metric,
          descriptiveValue: `${contributionsData.technicalCommittee.totalRepresentatives} representatives`,
          isConnected: true,
        };
      }
      if (metric.title === 'Total Commits') {
        return {
          ...metric,
          descriptiveValue: `${segmentData.totalCommits.toLocaleString()} commits`,
          isConnected: true,
        };
      }
      if (metric.title === 'Board Meetings Participation') {
        const percentage = dashboardData.boardMeetingAttendance.attendancePercentage.toFixed(0);
        return {
          ...metric,
          descriptiveValue: `${percentage}% attendance`,
          isConnected: true,
        };
      }
      return {
        ...metric,
        isConnected: false, // Hardcoded data
      };
    });
  });

  protected readonly impactMetrics = computed<ImpactMetric[]>((): ImpactMetric[] => {
    const eventsData = this.eventsOverviewData();
    const segmentData = this.segmentOverviewData();
    const dashboardData = this.boardMemberDashboardData();

    return IMPACT_METRICS.map((metric) => {
      if (metric.title === 'Event Attendees') {
        return {
          ...metric,
          descriptiveValue: `${eventsData.eventAttendance.totalAttendees} employees`,
          isConnected: true,
        };
      }
      if (metric.title === 'Event Speakers') {
        return {
          ...metric,
          descriptiveValue: `${eventsData.eventAttendance.totalSpeakers} speakers`,
          isConnected: true,
        };
      }
      if (metric.title === 'Projects Participating') {
        return {
          ...metric,
          descriptiveValue: `${segmentData.projectsParticipating} projects`,
          isConnected: true,
        };
      }
      if (metric.title === 'Certified Employees') {
        const certifications = dashboardData.certifiedEmployees.certifications;
        const employees = dashboardData.certifiedEmployees.certifiedEmployees;
        return {
          ...metric,
          descriptiveValue: `${certifications} certifications (${employees} employees)`,
          isConnected: true,
        };
      }
      return {
        ...metric,
        isConnected: false, // Hardcoded placeholder data
      };
    });
  });

  protected readonly primaryMetrics = computed<OrganizationInvolvementMetricWithChart[]>((): OrganizationInvolvementMetricWithChart[] => {
    const contributionsData = this.contributionsOverviewData();
    const dashboardData = this.boardMemberDashboardData();
    const eventsData = this.eventsOverviewData();

    return PRIMARY_INVOLVEMENT_METRICS.map((metric) => {
      if (metric.title === 'Event Sponsorship') {
        return this.transformEventSponsorship(eventsData.eventSponsorships, metric);
      }
      if (metric.title === 'Active Contributors') {
        return this.transformActiveContributors(contributionsData.contributors, metric);
      }
      if (metric.title === 'Maintainers') {
        return this.transformMaintainers(contributionsData.maintainers, metric);
      }
      if (metric.isMembershipTier) {
        return this.transformMembershipTier(dashboardData.membershipTier, metric);
      }
      return this.transformDefaultMetric(metric);
    });
  });

  private transformActiveContributors(
    data: { contributors: number; projects: number },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    return {
      title: metric.title,
      value: data.contributors.toString(),
      subtitle: 'Contributors from our organization',
      icon: metric.icon ?? '',
      isConnected: true,
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
      isConnected: true,
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
        isConnected: true,
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
      isConnected: true,
    };
  }

  private transformEventSponsorship(
    data: {
      currencySummaries: Array<{
        amount: number;
        currencyCode: string;
      }>;
      totalEvents: number;
    },
    metric: PrimaryInvolvementMetric
  ): OrganizationInvolvementMetricWithChart {
    // Filter out summaries with null/empty currency codes and transform remaining valid entries
    const formattedAmounts = data.currencySummaries
      .filter((summary) => summary.currencyCode && summary.currencyCode.trim() !== '')
      .map((summary) => this.currencyPipe.transform(summary.amount, summary.currencyCode, 'symbol', '1.0-0'))
      .filter((formatted) => formatted !== null);

    const displayValue = formattedAmounts.length > 0 ? formattedAmounts.join(' + ') : '$0';

    return {
      title: metric.title,
      value: displayValue,
      subtitle: `${data.totalEvents} events sponsored this year`,
      icon: metric.icon ?? '',
      isConnected: true,
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
      isConnected: false,
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
