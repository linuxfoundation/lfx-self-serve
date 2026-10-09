// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DataCopilotComponent } from '@app/shared/components/data-copilot/data-copilot.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { FilterPillOption } from '@lfx-one/shared/interfaces';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, lfxColors, PRIMARY_INVOLVEMENT_METRICS } from '@lfx-one/shared/constants';
import { DashboardDrawerType } from '@lfx-one/shared/interfaces';
import { hexToRgba, parseLocalDateString } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { classifySectionError, sectionEmptyState, worstSectionOutcome } from '@shared/utils/org-lens-empty-state.utils';
import { catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';

import { OrgActiveContributorsDrawerComponent } from '../org-active-contributors-drawer/org-active-contributors-drawer.component';
import { OrgCertifiedEmployeesDrawerComponent } from '../org-certified-employees-drawer/org-certified-employees-drawer.component';
import { OrgEventAttendeesDrawerComponent } from '../org-event-attendees-drawer/org-event-attendees-drawer.component';
import { OrgEventSpeakersDrawerComponent } from '../org-event-speakers-drawer/org-event-speakers-drawer.component';
import { OrgMaintainersDrawerComponent } from '../org-maintainers-drawer/org-maintainers-drawer.component';
import { OrgTrainingEnrollmentsDrawerComponent } from '../org-training-enrollments-drawer/org-training-enrollments-drawer.component';

import type {
  CertifiedEmployeesResponse,
  DashboardMetricCard,
  MembershipTierResponse,
  OrganizationContributorsResponse,
  OrganizationEventAttendanceMonthlyResponse,
  OrganizationMaintainersResponse,
  OrgLensSectionErrorOutcome,
  TrainingEnrollmentsResponse,
} from '@lfx-one/shared/interfaces';
import type { ChartOptions, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-organization-involvement',
  imports: [
    FilterPillsComponent,
    MetricCardComponent,
    DataCopilotComponent,
    OrgLensEmptyStateComponent,
    ScrollShadowDirective,
    OrgActiveContributorsDrawerComponent,
    OrgCertifiedEmployeesDrawerComponent,
    OrgEventAttendeesDrawerComponent,
    OrgEventSpeakersDrawerComponent,
    OrgMaintainersDrawerComponent,
    OrgTrainingEnrollmentsDrawerComponent,
  ],
  templateUrl: './organization-involvement.component.html',
  styleUrl: './organization-involvement.component.scss',
})
export class OrganizationInvolvementComponent {
  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  private readonly analyticsService = inject(AnalyticsService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly DashboardDrawerType = DashboardDrawerType;

  private readonly maintainersLoading = signal(true);
  private readonly contributorsLoading = signal(true);
  private readonly membershipTierLoading = signal(true);
  private readonly certifiedEmployeesLoading = signal(true);
  private readonly trainingEnrollmentsLoading = signal(true);
  private readonly eventsLoading = signal(true);
  private readonly maintainersOutcome = signal<OrgLensSectionErrorOutcome>('records');
  private readonly contributorsOutcome = signal<OrgLensSectionErrorOutcome>('records');
  private readonly membershipTierOutcome = signal<OrgLensSectionErrorOutcome>('records');
  private readonly certifiedEmployeesOutcome = signal<OrgLensSectionErrorOutcome>('records');
  private readonly trainingEnrollmentsOutcome = signal<OrgLensSectionErrorOutcome>('records');
  private readonly eventsOutcome = signal<OrgLensSectionErrorOutcome>('records');
  private readonly attempt = signal(0);
  private readonly attempt$ = toObservable(this.attempt);
  private readonly selectedAccountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));
  private readonly selectedFoundationSlug$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((foundation) => foundation?.slug || ''));
  public readonly hasFoundationSelected = computed<boolean>(() => !!this.projectContextService.selectedFoundation());
  public readonly sectionOutcome = computed<OrgLensSectionErrorOutcome>(() =>
    worstSectionOutcome([
      this.maintainersOutcome(),
      this.contributorsOutcome(),
      this.membershipTierOutcome(),
      this.certifiedEmployeesOutcome(),
      this.trainingEnrollmentsOutcome(),
      this.eventsOutcome(),
    ])
  );
  public readonly emptyState = computed(() => (this.isLoading() ? null : sectionEmptyState(this.sectionOutcome())));
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
  protected readonly activeDrawer = signal<DashboardDrawerType | null>(null);
  public readonly accountName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Organization');
  public readonly filterOptions: FilterPillOption[] = [
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

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected handleCardClick(drawerType: DashboardDrawerType): void {
    this.activeDrawer.set(drawerType);
  }

  protected handleDrawerClose(): void {
    this.activeDrawer.set(null);
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
    const defaultValue: OrganizationMaintainersResponse = {
      maintainers: 0,
      projects: 0,
      accountId: '',
      accountName: '',
      monthlyData: [],
      monthlyLabels: [],
    };

    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$, this.attempt$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.maintainersLoading.set(true);

          // Return empty data if no account/foundation is selected
          if (!accountId || !foundationSlug) {
            this.maintainersLoading.set(false);
            this.maintainersOutcome.set('records');
            return of(defaultValue);
          }

          return this.analyticsService.getOrganizationMaintainers(accountId, foundationSlug).pipe(
            tap(() => {
              this.maintainersLoading.set(false);
              this.maintainersOutcome.set('records');
            }),
            catchError((error: unknown) => {
              this.maintainersLoading.set(false);
              this.maintainersOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeContributorsData() {
    const defaultValue: OrganizationContributorsResponse = {
      contributors: 0,
      accountId: '',
      accountName: '',
      monthlyData: [],
      monthlyLabels: [],
    };

    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$, this.attempt$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.contributorsLoading.set(true);

          // Return empty data if no account/foundation is selected
          if (!accountId || !foundationSlug) {
            this.contributorsLoading.set(false);
            this.contributorsOutcome.set('records');
            return of(defaultValue);
          }

          return this.analyticsService.getOrganizationContributors(accountId, foundationSlug).pipe(
            tap(() => {
              this.contributorsLoading.set(false);
              this.contributorsOutcome.set('records');
            }),
            catchError((error: unknown) => {
              this.contributorsLoading.set(false);
              this.contributorsOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeMembershipTierData() {
    const defaultValue: MembershipTierResponse = {
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
    };

    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$, this.attempt$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.membershipTierLoading.set(true);

          // Return empty data if no account/foundation is selected
          if (!accountId || !foundationSlug) {
            this.membershipTierLoading.set(false);
            this.membershipTierOutcome.set('records');
            return of(defaultValue);
          }

          return this.analyticsService.getMembershipTier(accountId, foundationSlug).pipe(
            tap(() => {
              this.membershipTierLoading.set(false);
              this.membershipTierOutcome.set('records');
            }),
            catchError((error: unknown) => {
              this.membershipTierLoading.set(false);
              this.membershipTierOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeCertifiedEmployeesData() {
    const defaultValue: CertifiedEmployeesResponse = {
      certifications: 0,
      certifiedEmployees: 0,
      accountId: '',
      monthlyData: [],
      monthlyLabels: [],
    };

    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$, this.attempt$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.certifiedEmployeesLoading.set(true);

          // Return empty data if no account/foundation is selected
          if (!accountId || !foundationSlug) {
            this.certifiedEmployeesLoading.set(false);
            this.certifiedEmployeesOutcome.set('records');
            return of(defaultValue);
          }

          return this.analyticsService.getCertifiedEmployees(accountId, foundationSlug).pipe(
            tap(() => {
              this.certifiedEmployeesLoading.set(false);
              this.certifiedEmployeesOutcome.set('records');
            }),
            catchError((error: unknown) => {
              this.certifiedEmployeesLoading.set(false);
              this.certifiedEmployeesOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeTrainingEnrollmentsData() {
    const defaultValue: TrainingEnrollmentsResponse = { totalEnrollments: 0, dailyData: [], accountId: '', projectSlug: '' };

    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$, this.attempt$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.trainingEnrollmentsLoading.set(true);

          // Return empty data if no account/foundation is selected
          if (!accountId || !foundationSlug) {
            this.trainingEnrollmentsLoading.set(false);
            this.trainingEnrollmentsOutcome.set('records');
            return of(defaultValue);
          }

          return this.analyticsService.getTrainingEnrollments(accountId, foundationSlug).pipe(
            tap(() => {
              this.trainingEnrollmentsLoading.set(false);
              this.trainingEnrollmentsOutcome.set('records');
            }),
            catchError((error: unknown) => {
              this.trainingEnrollmentsLoading.set(false);
              this.trainingEnrollmentsOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initializeEventAttendanceMonthlyData() {
    const defaultValue: OrganizationEventAttendanceMonthlyResponse = {
      totalAttended: 0,
      totalSpeakers: 0,
      accountId: '',
      accountName: '',
      attendeesMonthlyData: [],
      speakersMonthlyData: [],
      monthlyLabels: [],
    };

    return toSignal(
      combineLatest([this.selectedAccountId$, this.selectedFoundationSlug$, this.attempt$]).pipe(
        switchMap(([accountId, foundationSlug]) => {
          this.eventsLoading.set(true);

          // Return empty data if no account/foundation is selected
          if (!accountId || !foundationSlug) {
            this.eventsLoading.set(false);
            this.eventsOutcome.set('records');
            return of(defaultValue);
          }

          return this.analyticsService.getEventAttendanceMonthly(accountId, foundationSlug).pipe(
            tap(() => {
              this.eventsLoading.set(false);
              this.eventsOutcome.set('records');
            }),
            catchError((error: unknown) => {
              this.eventsLoading.set(false);
              this.eventsOutcome.set(classifySectionError(error));
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private transformActiveContributors(data: OrganizationContributorsResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.contributorsLoading(),
      value: data.contributors.toString(),
      subtitle: 'Employees actively contributing to projects',
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
      subtitle: `Employees stewarding foundation ${projectLabel}`,
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
        tier: '',
        tierSince: '',
        nextDue: '',
      };
    }

    const tierSince = data.startDate ? parseLocalDateString(data.startDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';

    const nextDue = data.endDate ? parseLocalDateString(data.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

    return {
      ...metric,
      loading: this.membershipTierLoading(),
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
