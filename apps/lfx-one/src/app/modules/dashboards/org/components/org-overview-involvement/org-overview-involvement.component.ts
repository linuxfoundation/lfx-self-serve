// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal, viewChild, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { BASE_BAR_CHART_OPTIONS, BASE_LINE_CHART_OPTIONS, lfxColors, ORG_INVOLVEMENT_METRICS } from '@lfx-one/shared/constants';
import { hexToRgba, parseLocalDateString } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgInvolvementAnalyticsService } from '@services/org-involvement-analytics.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { distinctUntilChanged, map, Observable, of, switchMap, tap } from 'rxjs';

import type {
  DashboardMetricCard,
  FilterPillOption,
  OrgFoundationCoverageResponse,
  OrgInvolvementCertifiedEmployeesMonthlyResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgTrainingEnrollmentsResponse,
} from '@lfx-one/shared/interfaces';
import type { ChartOptions, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-org-overview-involvement',
  imports: [FilterPillsComponent, MetricCardComponent, ScrollShadowDirective],
  templateUrl: './org-overview-involvement.component.html',
  styleUrl: './org-overview-involvement.component.scss',
})
export class OrgOverviewInvolvementComponent {
  private readonly analyticsService = inject(OrgInvolvementAnalyticsService);
  private readonly accountContextService = inject(AccountContextService);

  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  private readonly maintainersLoading = signal(true);
  private readonly contributorsLoading = signal(true);
  private readonly certifiedEmployeesLoading = signal(true);
  private readonly trainingEnrollmentsLoading = signal(true);
  private readonly eventsLoading = signal(true);
  private readonly coverageLoading = signal(true);
  public readonly selectedFilter = signal<string>('all');

  public readonly filterOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'contributors', label: 'Contribution' },
    { id: 'events', label: 'Event' },
    { id: 'education', label: 'Education' },
  ];

  private readonly selectedAccountId$: Observable<string> = toObservable(this.accountContextService.selectedAccount).pipe(
    map((account) => account.accountId),
    distinctUntilChanged()
  );

  private readonly coverageData = this.initializeCoverageData();
  private readonly maintainersData = this.initializeMaintainersData();
  private readonly contributorsData = this.initializeContributorsData();
  private readonly certifiedEmployeesData = this.initializeCertifiedEmployeesData();
  private readonly trainingEnrollmentsData = this.initializeTrainingEnrollmentsData();
  private readonly eventAttendanceMonthlyData = this.initializeEventAttendanceMonthlyData();

  public readonly accountName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Organization');

  public readonly subtitleText = computed<string>(() => this.initSubtitleText());

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

  private initializeCoverageData(): Signal<OrgFoundationCoverageResponse> {
    return this.buildOrgDataSignal(
      (id) => this.analyticsService.getFoundationCoverage(id),
      (accountId) => ({ accountId, foundationCount: 0, foundations: [] }),
      this.coverageLoading
    );
  }

  private initializeMaintainersData(): Signal<OrgInvolvementMaintainersMonthlyResponse> {
    return this.buildOrgDataSignal(
      (id) => this.analyticsService.getMaintainersMonthly(id),
      (accountId) => ({
        accountId,
        accountName: '',
        totalMaintainersYearly: 0,
        totalProjectsYearly: 0,
        monthlyData: [],
        monthlyLabels: [],
      }),
      this.maintainersLoading
    );
  }

  private initializeContributorsData(): Signal<OrgInvolvementContributorsMonthlyResponse> {
    return this.buildOrgDataSignal(
      (id) => this.analyticsService.getContributorsMonthly(id),
      (accountId) => ({ accountId, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] }),
      this.contributorsLoading
    );
  }

  private initializeCertifiedEmployeesData(): Signal<OrgInvolvementCertifiedEmployeesMonthlyResponse> {
    return this.buildOrgDataSignal(
      (id) => this.analyticsService.getCertifiedEmployeesMonthly(id),
      (accountId) => ({ accountId, totalCertifications: 0, totalCertifiedEmployees: 0, monthlyData: [], monthlyLabels: [] }),
      this.certifiedEmployeesLoading
    );
  }

  private initializeTrainingEnrollmentsData(): Signal<OrgTrainingEnrollmentsResponse> {
    return this.buildOrgDataSignal(
      (id) => this.analyticsService.getTrainingEnrollments(id),
      (accountId) => ({ accountId, totalEnrollments: 0, dailyData: [] }),
      this.trainingEnrollmentsLoading
    );
  }

  private initializeEventAttendanceMonthlyData(): Signal<OrgInvolvementEventAttendanceMonthlyResponse> {
    return this.buildOrgDataSignal(
      (id) => this.analyticsService.getEventAttendanceMonthly(id),
      (accountId) => ({
        accountId,
        accountName: '',
        totalAttended: 0,
        totalSpeakers: 0,
        attendeesMonthlyData: [],
        speakersMonthlyData: [],
        monthlyLabels: [],
      }),
      this.eventsLoading
    );
  }

  private initializeActiveContributorsCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformActiveContributors(this.contributorsData(), this.getMetricConfig('Active Contributors')));
  }

  private initializeMaintainersCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformMaintainers(this.maintainersData(), this.getMetricConfig('Maintainers')));
  }

  private initializeEventAttendeesCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformEventAttendees(this.eventAttendanceMonthlyData(), this.getMetricConfig('Event Attendees')));
  }

  private initializeEventSpeakersCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformEventSpeakers(this.eventAttendanceMonthlyData(), this.getMetricConfig('Event Speakers')));
  }

  private initializeCertifiedEmployeesCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformCertifiedEmployees(this.certifiedEmployeesData(), this.getMetricConfig('Certified Employees')));
  }

  private initializeTrainingEnrollmentsCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformTrainingEnrollments(this.trainingEnrollmentsData(), this.getMetricConfig('Training Enrollments')));
  }

  private initializePrimaryMetrics(): Signal<DashboardMetricCard[]> {
    return computed<DashboardMetricCard[]>(() => this.computePrimaryMetrics());
  }

  private initSubtitleText(): string {
    if (this.coverageLoading()) {
      return '';
    }
    const coverage = this.coverageData();
    return coverage.foundationCount > 0 ? `across ${coverage.foundationCount} LF foundations` : 'No engagement yet';
  }

  private computePrimaryMetrics(): DashboardMetricCard[] {
    const filter = this.selectedFilter();
    const allCards = [
      { card: this.activeContributorsCard(), category: 'contributors' },
      { card: this.maintainersCard(), category: 'contributors' },
      { card: this.eventAttendeesCard(), category: 'events' },
      { card: this.eventSpeakersCard(), category: 'events' },
      { card: this.certifiedEmployeesCard(), category: 'education' },
      { card: this.trainingEnrollmentsCard(), category: 'education' },
    ];

    if (filter === 'all') {
      return allCards.map((item) => item.card);
    }

    return allCards.filter((item) => item.category === filter).map((item) => item.card);
  }

  /** Skip HTTP on empty accountId, echo accountId in the empty envelope, and rely on the service's catchError. */
  private buildOrgDataSignal<T extends { accountId: string }>(
    loader: (accountId: string) => Observable<T>,
    emptyValue: (accountId: string) => T,
    loading: WritableSignal<boolean>
  ): Signal<T> {
    return toSignal(
      this.selectedAccountId$.pipe(
        switchMap((accountId) => {
          if (!accountId) {
            loading.set(false);
            return of(emptyValue(accountId));
          }
          loading.set(true);
          return loader(accountId).pipe(tap(() => loading.set(false)));
        })
      ),
      { initialValue: emptyValue('') }
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
      subtitle: `Employees stewarding ${data.totalProjectsYearly} ${projectLabel} across foundations`,
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
        labels: data.dailyData.map((row) => parseLocalDateString(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })),
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

  /** Title-keyed lookup into ORG_INVOLVEMENT_METRICS; throws on missing card so renames surface as a clear error. */
  private getMetricConfig(title: string): DashboardMetricCard {
    const config = ORG_INVOLVEMENT_METRICS.find((m) => m.title === title);
    if (!config) {
      throw new Error(`ORG_INVOLVEMENT_METRICS is missing card titled '${title}'`);
    }
    return config;
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
