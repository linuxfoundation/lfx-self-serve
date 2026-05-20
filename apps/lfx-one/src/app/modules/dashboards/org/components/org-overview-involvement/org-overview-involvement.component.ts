// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, lfxColors, ORG_INVOLVEMENT_METRICS } from '@lfx-one/shared/constants';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgInvolvementAnalyticsService } from '@services/org-involvement-analytics.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import type {
  OrgInvolvementCertifiedEmployeesMonthlyResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgFoundationCoverageResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgTrainingEnrollmentsResponse,
} from '@lfx-one/shared/interfaces/org-involvement.interface';
import type { DashboardMetricCard, FilterPillOption } from '@lfx-one/shared/interfaces';
import type { ChartOptions, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-org-overview-involvement',
  imports: [FilterPillsComponent, MetricCardComponent, ScrollShadowDirective],
  templateUrl: './org-overview-involvement.component.html',
  styleUrl: './org-overview-involvement.component.scss',
})
export class OrgOverviewInvolvementComponent {
  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  private readonly analyticsService = inject(OrgInvolvementAnalyticsService);
  private readonly accountContextService = inject(AccountContextService);

  private readonly maintainersLoading = signal(true);
  private readonly contributorsLoading = signal(true);
  private readonly certifiedEmployeesLoading = signal(true);
  private readonly trainingEnrollmentsLoading = signal(true);
  private readonly eventsLoading = signal(true);
  private readonly coverageLoading = signal(true);

  private readonly selectedAccountId$ = toObservable(this.accountContextService.selectedAccount).pipe(map((account) => account.accountId));

  private readonly coverageData = this.initializeCoverageData();
  private readonly maintainersData = this.initializeMaintainersData();
  private readonly contributorsData = this.initializeContributorsData();
  private readonly certifiedEmployeesData = this.initializeCertifiedEmployeesData();
  private readonly trainingEnrollmentsData = this.initializeTrainingEnrollmentsData();
  private readonly eventAttendanceMonthlyData = this.initializeEventAttendanceMonthlyData();

  public readonly selectedFilter = signal<string>('all');
  public readonly accountName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Organization');

  public readonly subtitleText = computed<string>(() => {
    const coverage = this.coverageData();
    if (this.coverageLoading()) {
      return '';
    }
    return coverage.foundationCount > 0 ? `across ${coverage.foundationCount} LF foundations` : 'No engagement yet';
  });

  public readonly filterOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributions', label: 'Contribution' },
    { id: 'events', label: 'Event' },
    { id: 'education', label: 'Education' },
  ];

  private readonly activeContributorsCard = this.initializeActiveContributorsCard();
  private readonly maintainersCard = this.initializeMaintainersCard();
  private readonly eventAttendeesCard = this.initializeEventAttendeesCard();
  private readonly eventSpeakersCard = this.initializeEventSpeakersCard();
  private readonly certifiedEmployeesCard = this.initializeCertifiedEmployeesCard();
  private readonly trainingEnrollmentsCard = this.initializeTrainingEnrollmentsCard();

  public readonly primaryMetrics = this.initializePrimaryMetrics();

  public handleFilterChange(filter: string): void {
    this.selectedFilter.set(filter);
  }

  private getMetricConfig(title: string): DashboardMetricCard {
    return ORG_INVOLVEMENT_METRICS.find((m) => m.title === title)!;
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

  private initializeCoverageData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.coverageLoading.set(true);
          return this.analyticsService.getFoundationCoverage(accountId).pipe(
            tap(() => this.coverageLoading.set(false)),
            catchError(() => {
              this.coverageLoading.set(false);
              return of({ accountId: '', foundationCount: 0, foundations: [] } as OrgFoundationCoverageResponse);
            })
          );
        })
      ),
      { initialValue: { accountId: '', foundationCount: 0, foundations: [] } as OrgFoundationCoverageResponse }
    );
  }

  private initializeMaintainersData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.maintainersLoading.set(true);
          return this.analyticsService.getMaintainersMonthly(accountId).pipe(
            tap(() => this.maintainersLoading.set(false)),
            catchError(() => {
              this.maintainersLoading.set(false);
              return of({
                accountId: '',
                accountName: '',
                totalMaintainersYearly: 0,
                totalProjectsYearly: 0,
                monthlyData: [],
                monthlyLabels: [],
              } as OrgInvolvementMaintainersMonthlyResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          accountId: '',
          accountName: '',
          totalMaintainersYearly: 0,
          totalProjectsYearly: 0,
          monthlyData: [],
          monthlyLabels: [],
        } as OrgInvolvementMaintainersMonthlyResponse,
      }
    );
  }

  private initializeContributorsData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.contributorsLoading.set(true);
          return this.analyticsService.getContributorsMonthly(accountId).pipe(
            tap(() => this.contributorsLoading.set(false)),
            catchError(() => {
              this.contributorsLoading.set(false);
              return of({
                accountId: '',
                totalActiveContributors: 0,
                monthlyData: [],
                monthlyLabels: [],
              } as OrgInvolvementContributorsMonthlyResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          accountId: '',
          totalActiveContributors: 0,
          monthlyData: [],
          monthlyLabels: [],
        } as OrgInvolvementContributorsMonthlyResponse,
      }
    );
  }

  private initializeCertifiedEmployeesData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.certifiedEmployeesLoading.set(true);
          return this.analyticsService.getCertifiedEmployeesMonthly(accountId).pipe(
            tap(() => this.certifiedEmployeesLoading.set(false)),
            catchError(() => {
              this.certifiedEmployeesLoading.set(false);
              return of({
                accountId: '',
                totalCertifications: 0,
                totalCertifiedEmployees: 0,
                monthlyData: [],
                monthlyLabels: [],
              } as OrgInvolvementCertifiedEmployeesMonthlyResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          accountId: '',
          totalCertifications: 0,
          totalCertifiedEmployees: 0,
          monthlyData: [],
          monthlyLabels: [],
        } as OrgInvolvementCertifiedEmployeesMonthlyResponse,
      }
    );
  }

  private initializeTrainingEnrollmentsData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.trainingEnrollmentsLoading.set(true);
          return this.analyticsService.getTrainingEnrollments(accountId).pipe(
            tap(() => this.trainingEnrollmentsLoading.set(false)),
            catchError(() => {
              this.trainingEnrollmentsLoading.set(false);
              return of({ accountId: '', totalEnrollments: 0, dailyData: [] } as OrgTrainingEnrollmentsResponse);
            })
          );
        })
      ),
      { initialValue: { accountId: '', totalEnrollments: 0, dailyData: [] } as OrgTrainingEnrollmentsResponse }
    );
  }

  private initializeEventAttendanceMonthlyData() {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          this.eventsLoading.set(true);
          return this.analyticsService.getEventAttendanceMonthly(accountId).pipe(
            tap(() => this.eventsLoading.set(false)),
            catchError(() => {
              this.eventsLoading.set(false);
              return of({
                accountId: '',
                accountName: '',
                totalAttended: 0,
                totalSpeakers: 0,
                attendeesMonthlyData: [],
                speakersMonthlyData: [],
                monthlyLabels: [],
              } as OrgInvolvementEventAttendanceMonthlyResponse);
            })
          );
        })
      ),
      {
        initialValue: {
          accountId: '',
          accountName: '',
          totalAttended: 0,
          totalSpeakers: 0,
          attendeesMonthlyData: [],
          speakersMonthlyData: [],
          monthlyLabels: [],
        } as OrgInvolvementEventAttendanceMonthlyResponse,
      }
    );
  }

  private transformActiveContributors(data: OrgInvolvementContributorsMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.contributorsLoading(),
      value: data.totalActiveContributors.toString(),
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

  private transformMaintainers(data: OrgInvolvementMaintainersMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
    const projectLabel = data.totalProjectsYearly === 1 ? 'project' : 'projects';
    return {
      ...metric,
      loading: this.maintainersLoading(),
      value: data.totalMaintainersYearly.toString(),
      subtitle: `Employees stewarding ${projectLabel} across foundations`,
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

  private transformEventAttendees(data: OrgInvolvementEventAttendanceMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
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

  private transformEventSpeakers(data: OrgInvolvementEventAttendanceMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
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

  private transformCertifiedEmployees(data: OrgInvolvementCertifiedEmployeesMonthlyResponse, metric: DashboardMetricCard): DashboardMetricCard {
    return {
      ...metric,
      loading: this.certifiedEmployeesLoading(),
      value: `${data.totalCertifiedEmployees} employees`,
      subtitle: `${data.totalCertifications} total certifications`,
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

  private transformTrainingEnrollments(data: OrgTrainingEnrollmentsResponse, metric: DashboardMetricCard): DashboardMetricCard {
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
