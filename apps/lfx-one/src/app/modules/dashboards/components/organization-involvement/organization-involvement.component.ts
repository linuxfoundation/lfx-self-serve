// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { FilterOption, FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { TagComponent } from '@components/tag/tag.component';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, lfxColors, PRIMARY_INVOLVEMENT_METRICS } from '@lfx-one/shared/constants';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';

import type {
  CertifiedEmployeesResponse,
  DashboardMetricCard,
  MembershipTierResponse,
  OrganizationContributorsResponse,
  OrganizationEventAttendanceMonthlyResponse,
  OrganizationMaintainersResponse,
  TrainingEnrollmentsResponse,
} from '@lfx-one/shared/interfaces';
import type { ChartOptions, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-organization-involvement',
  imports: [FilterPillsComponent, MetricCardComponent, TagComponent, DataCopilotComponent, ScrollShadowDirective],
  templateUrl: './organization-involvement.component.html',
  styleUrl: './organization-involvement.component.scss',
})
export class OrganizationInvolvementComponent {
  @ViewChild(ScrollShadowDirective) public scrollShadowDirective!: ScrollShadowDirective;

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
  private readonly eventAttendanceMonthlyData = this.initializeEventAttendanceMonthlyData();
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

  // Individual computed signals for each card - each only depends on its own data
  private readonly membershipTierCard = this.initializeMembershipTierCard();
  private readonly activeContributorsCard = this.initializeActiveContributorsCard();
  private readonly maintainersCard = this.initializeMaintainersCard();
  private readonly eventAttendeesCard = this.initializeEventAttendeesCard();
  private readonly eventSpeakersCard = this.initializeEventSpeakersCard();
  private readonly certifiedEmployeesCard = this.initializeCertifiedEmployeesCard();
  private readonly trainingEnrollmentsCard = this.initializeTrainingEnrollmentsCard();

  // Filtered cards - materializes card values while benefiting from individual signal memoization
  public readonly primaryMetrics = this.initializePrimaryMetrics();

  public handleFilterChange(filter: string): void {
    this.selectedFilter.set(filter);
  }

  private getMetricConfig(title: string): DashboardMetricCard {
    return PRIMARY_INVOLVEMENT_METRICS.find((m) => m.title === title || (title === 'Membership Tier' && m.isMembershipTier))!;
  }

  private initializeMembershipTierCard() {
    return computed(() => this.transformMembershipTier(this.membershipTierData(), this.getMetricConfig('Membership Tier')));
  }

  private initializeActiveContributorsCard() {
    return computed(() => this.transformActiveContributors(this.contributorsData(), this.getMetricConfig('Active Contributors')));
  }

  private initializeMaintainersCard() {
    return computed(() => this.transformMaintainers(this.maintainersData(), this.getMetricConfig('Maintainers')));
  }

  private initializeEventAttendeesCard() {
    return computed(() => this.transformEventAttendees(this.eventAttendanceMonthlyData(), this.getMetricConfig('Event Attendees')));
  }

  private initializeEventSpeakersCard() {
    return computed(() => this.transformEventSpeakers(this.eventAttendanceMonthlyData(), this.getMetricConfig('Event Speakers')));
  }

  private initializeCertifiedEmployeesCard() {
    return computed(() => this.transformCertifiedEmployees(this.certifiedEmployeesData(), this.getMetricConfig('Certified Employees')));
  }

  private initializeTrainingEnrollmentsCard() {
    return computed(() => this.transformTrainingEnrollments(this.trainingEnrollmentsData(), this.getMetricConfig('Training Enrollments')));
  }

  private initializePrimaryMetrics() {
    return computed<DashboardMetricCard[]>(() => {
      const filter = this.selectedFilter();

      const allCards = [
        { card: this.membershipTierCard(), category: 'membership' },
        { card: this.activeContributorsCard(), category: 'contributions' },
        { card: this.maintainersCard(), category: 'contributions' },
        { card: this.eventAttendeesCard(), category: 'events' },
        { card: this.eventSpeakersCard(), category: 'events' },
        { card: this.certifiedEmployeesCard(), category: 'education' },
        { card: this.trainingEnrollmentsCard(), category: 'education' },
      ];

      if (filter === 'all') {
        return allCards.map((item) => item.card);
      }

      return allCards.filter((item) => item.category === filter).map((item) => item.card);
    });
  }

  private initializeMaintainersData() {
    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.maintainersLoading.set(true);

          // Return empty data if no foundation is selected
          if (!foundationSlug) {
            this.maintainersLoading.set(false);
            return of({
              maintainers: 0,
              projects: 0,
              accountId: '',
              accountName: '',
              monthlyData: [],
              monthlyLabels: [],
            } as OrganizationMaintainersResponse);
          }

          return this.analyticsService.getOrganizationMaintainers(accountId, foundationSlug).pipe(
            tap(() => this.maintainersLoading.set(false)),
            catchError(() => {
              this.maintainersLoading.set(false);
              return of({
                maintainers: 0,
                projects: 0,
                accountId: '',
                accountName: '',
                monthlyData: [],
                monthlyLabels: [],
              } as OrganizationMaintainersResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          maintainers: 0,
          projects: 0,
          accountId: '',
          accountName: '',
          monthlyData: [],
          monthlyLabels: [],
        } as OrganizationMaintainersResponse,
      }
    );
  }

  private initializeContributorsData() {
    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.contributorsLoading.set(true);

          // Return empty data if no foundation is selected
          if (!foundationSlug) {
            this.contributorsLoading.set(false);
            return of({
              contributors: 0,
              accountId: '',
              accountName: '',
              monthlyData: [],
              monthlyLabels: [],
            } as OrganizationContributorsResponse);
          }

          return this.analyticsService.getOrganizationContributors(accountId, foundationSlug).pipe(
            tap(() => this.contributorsLoading.set(false)),
            catchError(() => {
              this.contributorsLoading.set(false);
              return of({
                contributors: 0,
                accountId: '',
                accountName: '',
                monthlyData: [],
                monthlyLabels: [],
              } as OrganizationContributorsResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          contributors: 0,
          accountId: '',
          accountName: '',
          monthlyData: [],
          monthlyLabels: [],
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

          return this.analyticsService.getMembershipTier(accountId, foundationSlug).pipe(
            tap(() => this.membershipTierLoading.set(false)),
            catchError(() => {
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
            })
          );
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
              monthlyData: [],
              monthlyLabels: [],
            } as CertifiedEmployeesResponse);
          }

          return this.analyticsService.getCertifiedEmployees(accountId, foundationSlug).pipe(
            tap(() => this.certifiedEmployeesLoading.set(false)),
            catchError(() => {
              this.certifiedEmployeesLoading.set(false);
              return of({
                certifications: 0,
                certifiedEmployees: 0,
                accountId: '',
                monthlyData: [],
                monthlyLabels: [],
              } as CertifiedEmployeesResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          certifications: 0,
          certifiedEmployees: 0,
          accountId: '',
          monthlyData: [],
          monthlyLabels: [],
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

          return this.analyticsService.getTrainingEnrollments(accountId, foundationSlug).pipe(
            tap(() => this.trainingEnrollmentsLoading.set(false)),
            catchError(() => {
              this.trainingEnrollmentsLoading.set(false);
              return of({ totalEnrollments: 0, dailyData: [], accountId: '', projectSlug: '' } as TrainingEnrollmentsResponse);
            })
          );
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

  private initializeEventAttendanceMonthlyData() {
    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.eventsLoading.set(true);

          // Return empty data if no foundation is selected
          if (!foundationSlug) {
            this.eventsLoading.set(false);
            return of({
              totalAttended: 0,
              totalSpeakers: 0,
              accountId: '',
              accountName: '',
              attendeesMonthlyData: [],
              speakersMonthlyData: [],
              monthlyLabels: [],
            } as OrganizationEventAttendanceMonthlyResponse);
          }

          return this.analyticsService.getEventAttendanceMonthly(accountId, foundationSlug).pipe(
            tap(() => this.eventsLoading.set(false)),
            catchError(() => {
              this.eventsLoading.set(false);
              return of({
                totalAttended: 0,
                totalSpeakers: 0,
                accountId: '',
                accountName: '',
                attendeesMonthlyData: [],
                speakersMonthlyData: [],
                monthlyLabels: [],
              } as OrganizationEventAttendanceMonthlyResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          totalAttended: 0,
          totalSpeakers: 0,
          accountId: '',
          accountName: '',
          attendeesMonthlyData: [],
          speakersMonthlyData: [],
          monthlyLabels: [],
        } as OrganizationEventAttendanceMonthlyResponse,
      }
    );
  }

  private transformActiveContributors(data: OrganizationContributorsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.contributorsLoading(),
      value: data.contributors.toString(),
      subtitle: 'Contributors from our organization',
      chartOptions: this.createBarChartOptions('Active contributors'),
      chartData:
        data.monthlyData.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.monthlyData,
                  borderColor: lfxColors.blue[500],
                  backgroundColor: hexToRgba(lfxColors.blue[500], 0.5),
                  borderWidth: 0,
                  borderRadius: 4,
                },
              ],
            }
          : metric.chartData,
    };
  }

  private transformMaintainers(data: OrganizationMaintainersResponse, metric: DashboardMetricCard): DashboardMetricCard {
    const projectLabel = data.projects === 1 ? 'project' : 'projects';
    return {
      ...metric,
      loading: this.maintainersLoading(),
      value: data.maintainers.toString(),
      subtitle: `Across ${data.projects} ${projectLabel}`,
      chartOptions: this.createBarChartOptions('Maintainers'),
      chartData:
        data.monthlyData.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.monthlyData,
                  borderColor: lfxColors.blue[500],
                  backgroundColor: hexToRgba(lfxColors.blue[500], 0.5),
                  borderWidth: 0,
                  borderRadius: 4,
                },
              ],
            }
          : metric.chartData,
    };
  }

  private transformMembershipTier(data: MembershipTierResponse, metric: DashboardMetricCard): DashboardMetricCard {
    if (!data.membershipTier) {
      return {
        ...metric,
        loading: this.membershipTierLoading(),
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
      loading: this.membershipTierLoading(),
      value: data.membershipTier,
      subtitle: `Active membership`,
      tier: data.membershipTier,
      tierSince,
      nextDue,
    };
  }

  private transformEventAttendees(data: OrganizationEventAttendanceMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.eventsLoading(),
      value: data.totalAttended.toString(),
      subtitle: 'Employees at foundation events',
      chartOptions: this.createLineChartOptions('Event attendees'),
      chartData:
        data.attendeesMonthlyData.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.attendeesMonthlyData,
                  borderColor: lfxColors.emerald[500],
                  backgroundColor: hexToRgba(lfxColors.emerald[500], 0.1),
                  fill: true,
                  tension: 0,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : metric.chartData,
    };
  }

  private transformEventSpeakers(data: OrganizationEventAttendanceMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.eventsLoading(),
      value: data.totalSpeakers.toString(),
      subtitle: 'Employee speakers at events',
      chartOptions: this.createLineChartOptions('Event speakers'),
      chartData:
        data.speakersMonthlyData.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.speakersMonthlyData,
                  borderColor: lfxColors.amber[500],
                  backgroundColor: hexToRgba(lfxColors.amber[500], 0.1),
                  fill: true,
                  tension: 0,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : metric.chartData,
    };
  }

  private transformCertifiedEmployees(data: CertifiedEmployeesResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.certifiedEmployeesLoading(),
      value: `${data.certifiedEmployees} employees`,
      subtitle: `${data.certifications} total certifications`,
      chartOptions: this.createLineChartOptions('Certifications'),
      chartData:
        data.monthlyData.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.monthlyData,
                  borderColor: lfxColors.violet[500],
                  backgroundColor: hexToRgba(lfxColors.violet[500], 0.1),
                  fill: true,
                  tension: 0,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : metric.chartData,
    };
  }

  private transformTrainingEnrollments(data: TrainingEnrollmentsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.trainingEnrollmentsLoading(),
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

  private createBarChartOptions(label: string): ChartOptions<ChartType> {
    return {
      ...BASE_BAR_CHART_OPTIONS,
      plugins: {
        ...BASE_BAR_CHART_OPTIONS.plugins,
        tooltip: {
          ...(BASE_BAR_CHART_OPTIONS.plugins?.tooltip ?? {}),
          callbacks: {
            title: (context) => context[0]?.label ?? '',
            label: (context) => `${label}: ${context.parsed.y ?? 0}`,
          },
        },
      },
    };
  }

  private createLineChartOptions(label: string): ChartOptions<ChartType> {
    return {
      ...BASE_LINE_CHART_OPTIONS,
      plugins: {
        ...BASE_LINE_CHART_OPTIONS.plugins,
        tooltip: {
          ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
          callbacks: {
            title: (context) => context[0]?.label ?? '',
            label: (context) => `${label}: ${context.parsed.y ?? 0}`,
          },
        },
      },
    };
  }
}
