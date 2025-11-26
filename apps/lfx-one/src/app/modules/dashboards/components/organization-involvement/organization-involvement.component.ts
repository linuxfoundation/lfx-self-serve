// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { TagComponent } from '@components/tag/tag.component';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, lfxColors, PRIMARY_INVOLVEMENT_METRICS } from '@lfx-one/shared/constants';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { combineLatest, finalize, map, of, switchMap } from 'rxjs';

import type {
  CertifiedEmployeesResponse,
  DashboardMetricCard,
  MembershipTierResponse,
  OrganizationContributorsResponse,
  OrganizationMaintainersResponse,
  TrainingEnrollmentsResponse,
} from '@lfx-one/shared/interfaces';
import type { ChartOptions, TooltipItem } from 'chart.js';

@Component({
  selector: 'lfx-organization-involvement',
  standalone: true,
  imports: [CommonModule, FilterPillsComponent, MetricCardComponent, TagComponent, DataCopilotComponent],
  templateUrl: './organization-involvement.component.html',
  styleUrl: './organization-involvement.component.scss',
})
export class OrganizationInvolvementComponent {
  @ViewChild('carouselScroll') public carouselScrollContainer!: ElementRef;

  private readonly analyticsService = inject(AnalyticsService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);

  private readonly maintainersLoading = signal(true);
  private readonly contributorsLoading = signal(true);
  private readonly membershipTierLoading = signal(true);
  private readonly certifiedEmployeesLoading = signal(true);
  private readonly trainingEnrollmentsLoading = signal(true);
  private readonly eventsLoading = signal(true);
  private readonly selectedAccountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));
  private readonly selectedFoundationSlug$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((foundation) => foundation?.slug || ''));
  public readonly hasFoundationSelected = computed<boolean>(() => !!this.projectContextService.selectedFoundation());
  private readonly maintainersData = this.initializeMaintainersData();
  private readonly contributorsData = this.initializeContributorsData();
  private readonly membershipTierData = this.initializeMembershipTierData();
  private readonly certifiedEmployeesData = this.initializeCertifiedEmployeesData();
  private readonly trainingEnrollmentsData = this.initializeTrainingEnrollmentsData();
  private readonly eventsOverviewData = this.initializeEventsOverviewData();
  public readonly isLoading = computed<boolean>(
    () =>
      this.maintainersLoading() ||
      this.contributorsLoading() ||
      this.membershipTierLoading() ||
      this.certifiedEmployeesLoading() ||
      this.trainingEnrollmentsLoading() ||
      this.eventsLoading()
  );
  public readonly selectedFilter = signal<string>('all');
  public readonly accountName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Organization');
  public readonly filterOptions: FilterOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributions', label: 'Contribution' },
    { id: 'events', label: 'Event' },
    { id: 'education', label: 'Education' },
  ];

  public readonly primaryMetrics = computed<DashboardMetricCard[]>((): DashboardMetricCard[] => {
    const maintainersData = this.maintainersData();
    const contributorsData = this.contributorsData();
    const membershipTierData = this.membershipTierData();
    const certifiedEmployeesData = this.certifiedEmployeesData();
    const trainingEnrollmentsData = this.trainingEnrollmentsData();
    const eventsData = this.eventsOverviewData();
    const filter = this.selectedFilter();

    const allMetrics = PRIMARY_INVOLVEMENT_METRICS.map((metric) => {
      if (metric.title === 'Active Contributors') {
        return this.transformActiveContributors(contributorsData, metric);
      }
      if (metric.title === 'Maintainers') {
        return this.transformMaintainers(maintainersData, metric);
      }
      if (metric.title === 'Event Attendees') {
        return this.transformEventAttendees(eventsData.eventAttendance, metric);
      }
      if (metric.title === 'Event Speakers') {
        return this.transformEventSpeakers(eventsData.eventAttendance, metric);
      }
      if (metric.title === 'Certified Employees') {
        return this.transformCertifiedEmployees(certifiedEmployeesData, metric);
      }
      if (metric.title === 'Training Enrollments') {
        return this.transformTrainingEnrollments(trainingEnrollmentsData, metric);
      }
      if (metric.isMembershipTier) {
        return this.transformMembershipTier(membershipTierData, metric);
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

  private initializeMaintainersData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.maintainersLoading.set(true);
          return this.analyticsService.getOrganizationMaintainers(accountId).pipe(finalize(() => this.maintainersLoading.set(false)));
        })
      ),
      {
        initialValue: {
          maintainers: 0,
          projects: 0,
          accountId: '',
          accountName: '',
        } as OrganizationMaintainersResponse,
      }
    );
  }

  private initializeContributorsData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.contributorsLoading.set(true);
          return this.analyticsService.getOrganizationContributors(accountId).pipe(finalize(() => this.contributorsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          contributors: 0,
          projects: 0,
          accountId: '',
          accountName: '',
        } as OrganizationContributorsResponse,
      }
    );
  }

  private initializeMembershipTierData() {
    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.membershipTierLoading.set(true);

          // Return empty data if no foundation is selected
          if (!foundationSlug) {
            this.membershipTierLoading.set(false);
            return of({
              projectId: '',
              projectName: '',
              projectSlug: '',
              isProjectActive: false,
              accountId: '',
              accountName: '',
              membershipTier: '',
              membershipPrice: 0,
              startDate: '',
              endDate: '',
              renewalPrice: 0,
              membershipStatus: '',
            } as MembershipTierResponse);
          }

          return this.analyticsService.getMembershipTier(accountId, foundationSlug).pipe(finalize(() => this.membershipTierLoading.set(false)));
        })
      ),
      {
        initialValue: {
          projectId: '',
          projectName: '',
          projectSlug: '',
          isProjectActive: false,
          accountId: '',
          accountName: '',
          membershipTier: '',
          membershipPrice: 0,
          startDate: '',
          endDate: '',
          renewalPrice: 0,
          membershipStatus: '',
        } as MembershipTierResponse,
      }
    );
  }

  private initializeCertifiedEmployeesData() {
    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.certifiedEmployeesLoading.set(true);

          // Return empty data if no foundation is selected
          if (!foundationSlug) {
            this.certifiedEmployeesLoading.set(false);
            return of({
              certifications: 0,
              certifiedEmployees: 0,
              accountId: '',
              projectId: '',
              projectSlug: '',
            } as CertifiedEmployeesResponse);
          }

          return this.analyticsService.getCertifiedEmployees(accountId, foundationSlug).pipe(finalize(() => this.certifiedEmployeesLoading.set(false)));
        })
      ),
      {
        initialValue: {
          certifications: 0,
          certifiedEmployees: 0,
          accountId: '',
          projectId: '',
          projectSlug: '',
        } as CertifiedEmployeesResponse,
      }
    );
  }

  private initializeTrainingEnrollmentsData() {
    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.trainingEnrollmentsLoading.set(true);

          // Return empty data if no foundation is selected
          if (!foundationSlug) {
            this.trainingEnrollmentsLoading.set(false);
            return of({
              totalEnrollments: 0,
              dailyData: [],
              accountId: '',
              projectSlug: '',
            } as TrainingEnrollmentsResponse);
          }

          return this.analyticsService.getTrainingEnrollments(accountId, foundationSlug).pipe(finalize(() => this.trainingEnrollmentsLoading.set(false)));
        })
      ),
      {
        initialValue: {
          totalEnrollments: 0,
          dailyData: [],
          accountId: '',
          projectSlug: '',
        } as TrainingEnrollmentsResponse,
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
        },
      }
    );
  }

  private transformActiveContributors(data: OrganizationContributorsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      value: data.contributors.toString(),
      subtitle: 'Contributors from our organization',
      chartOptions: this.createBarChartOptions('Active contributors'),
    };
  }

  private transformMaintainers(data: OrganizationMaintainersResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      value: data.maintainers.toString(),
      subtitle: `Across ${data.projects} projects`,
      chartOptions: this.createBarChartOptions('Maintainers'),
    };
  }

  private transformMembershipTier(data: MembershipTierResponse, metric: DashboardMetricCard): DashboardMetricCard {
    if (!data.membershipTier) {
      return {
        ...metric,
        value: 'No Membership',
        subtitle: 'Not a member',
        tier: '',
        tierSince: '',
        nextDue: '',
      };
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const tierSince = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const nextDue = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return {
      ...metric,
      value: data.membershipTier,
      subtitle: `Active membership`,
      tier: data.membershipTier,
      tierSince,
      nextDue,
    };
  }

  private transformEventAttendees(
    data: { totalAttendees: number; totalSpeakers: number; totalEvents: number; accountName: string },
    metric: DashboardMetricCard
  ): DashboardMetricCard {
    return {
      ...metric,
      value: data.totalAttendees.toString(),
      subtitle: 'Employees at foundation events',
      chartOptions: this.createLineChartOptions('Event attendees'),
    };
  }

  private transformEventSpeakers(
    data: { totalAttendees: number; totalSpeakers: number; totalEvents: number; accountName: string },
    metric: DashboardMetricCard
  ): DashboardMetricCard {
    return {
      ...metric,
      value: data.totalSpeakers.toString(),
      subtitle: 'Employee speakers at events',
      chartOptions: this.createLineChartOptions('Event speakers'),
    };
  }

  private transformCertifiedEmployees(data: CertifiedEmployeesResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      value: `${data.certifiedEmployees} employees`,
      subtitle: `${data.certifications} total certifications`,
      chartOptions: this.createLineChartOptions('Certified employees'),
    };
  }

  private transformTrainingEnrollments(data: TrainingEnrollmentsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      value: data.totalEnrollments.toString(),
      subtitle: 'Training courses enrolled this year',
      chartOptions: this.createLineChartOptions('Training enrollments'),
      chartData: {
        labels: data.dailyData.map((row) => {
          const date = new Date(row.date);
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }),
        datasets: [
          {
            data: data.dailyData.map((row) => row.cumulativeCount),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
    };
  }

  private transformDefaultMetric(metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      value: metric.value ?? 'N/A',
      subtitle: metric.subtitle ?? 'No data available',
      chartOptions: metric.chartType === 'bar' ? BASE_BAR_CHART_OPTIONS : BASE_LINE_CHART_OPTIONS,
    };
  }

  private createBarChartOptions(label: string): ChartOptions<'bar'> {
    return {
      ...BASE_BAR_CHART_OPTIONS,
      plugins: {
        ...BASE_BAR_CHART_OPTIONS.plugins,
        tooltip: {
          ...(BASE_BAR_CHART_OPTIONS.plugins?.tooltip ?? {}),
          callbacks: {
            title: (context: TooltipItem<'bar'>[]) => context[0].label,
            label: (context: TooltipItem<'bar'>) => `${label}: ${context.parsed.y}`,
          },
        },
      },
    };
  }

  private createLineChartOptions(label: string): ChartOptions<'line'> {
    return {
      ...BASE_LINE_CHART_OPTIONS,
      plugins: {
        ...BASE_LINE_CHART_OPTIONS.plugins,
        tooltip: {
          ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
          callbacks: {
            title: (context: TooltipItem<'line'>[]) => context[0].label,
            label: (context: TooltipItem<'line'>) => `${label}: ${context.parsed.y}`,
          },
        },
      },
    };
  }
}
