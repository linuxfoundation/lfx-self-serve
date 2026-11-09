// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal, viewChild, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import {
  BASE_BAR_CHART_OPTIONS,
  BASE_LINE_CHART_OPTIONS,
  DEFAULT_ORG_EVENTS_ATTRIBUTION,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  lfxColors,
  ORG_INVOLVEMENT_METRICS,
  ORG_MAINTAINER_ROLES_LABEL,
  ORG_DEFAULT_PROJECT_SCOPE_LABEL,
  ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE,
  ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE,
  ORG_EVENTS_SPEAKERS_CAPTION_PHRASE,
  ORG_LENS_DEFAULT_VIEW_PHRASE,
  ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION,
  ORG_OVERVIEW_EVENT_ATTENDEES_SUBTITLE,
  ORG_OVERVIEW_EVENT_SPEAKERS_SUBTITLE,
  ORG_OVERVIEW_EVENTS_DISTINCT_PEOPLE_NOTE,
  ORG_OVERVIEW_MAINTAINER_ROLES_DEFINITION,
  ORG_TRAINING_STAT_DEFINITIONS,
} from '@lfx-one/shared/constants';
import { buildOrgTrainingStatTiles, hexToRgba, orgTrainingStatCaptionParts, orgTrainingStatsQuery, parseOrgTrainingViewState } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgInvolvementAnalyticsService } from '@services/org-involvement-analytics.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { OrgLensNavigationService } from '@shared/services/org-lens-navigation.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { catchError, distinctUntilChanged, finalize, map, Observable, of, startWith, switchMap, tap } from 'rxjs';

import type {
  DashboardMetricCard,
  FilterPillOption,
  OrgFoundationCoverageResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgTrainingStats,
  OrgTrainingStatsQuery,
} from '@lfx-one/shared/interfaces';
import type { ChartOptions, ChartType } from 'chart.js';

/**
 * The Education tiles read the shared stats in the Training page's default state (Past 2 years, no filters): the query
 * the page itself builds from a URL with no params, so the headline numbers are the page's numbers.
 */
const OVERVIEW_TRAINING_STATS_QUERY: OrgTrainingStatsQuery = orgTrainingStatsQuery(parseOrgTrainingViewState(() => null));

@Component({
  selector: 'lfx-org-overview-involvement',
  imports: [FilterPillsComponent, MetricCardComponent, ScrollShadowDirective],
  templateUrl: './org-overview-involvement.component.html',
  styleUrl: './org-overview-involvement.component.scss',
})
export class OrgOverviewInvolvementComponent {
  private readonly analyticsService = inject(OrgInvolvementAnalyticsService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly trainingService = inject(OrgLensTrainingService);
  private readonly router = inject(Router);
  private readonly orgLensNavigation = inject(OrgLensNavigationService);

  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  private readonly maintainersLoading = signal(true);
  private readonly contributorsLoading = signal(true);
  private readonly trainingStatsLoading = signal(true);
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
  private readonly trainingStats = this.initializeTrainingStats();
  private readonly eventAttendanceMonthlyData = this.initializeEventAttendanceMonthlyData();

  public readonly accountName = computed<string>(() => this.accountContextService.selectedAccount().accountName || 'Organization');

  public readonly subtitleText = computed<string>(() => this.initSubtitleText());

  private readonly activeContributorsCard = this.initializeActiveContributorsCard();
  private readonly maintainersCard = this.initializeMaintainersCard();
  private readonly eventAttendeesCard = this.initializeEventAttendeesCard();
  private readonly eventSpeakersCard = this.initializeEventSpeakersCard();
  private readonly peopleWithTrainingActivityCard = this.initializePeopleWithTrainingActivityCard();
  private readonly certifiedEmployeesCard = this.initializeCertifiedEmployeesCard();
  private readonly trainingEnrollmentsCard = this.initializeTrainingEnrollmentsCard();

  public readonly primaryMetrics = this.initializePrimaryMetrics();

  public handleFilterChange(filter: string): void {
    this.selectedFilter.set(filter);
  }

  /** The Education tiles open Training & Certification in its default state: no query, so the page shows the same numbers. */
  public openTraining(): void {
    void this.router.navigate(this.orgLensNavigation.orgLensLink('training'));
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
      (accountId) => ({ accountId, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] }),
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

  /** The shared training stats for the Training page's default range, Past 2 years (Org Lens training route, keyed by org uid); null while loading or when the read fails. */
  private initializeTrainingStats(): Signal<OrgTrainingStats | null> {
    return toSignal(
      toObservable(this.accountContextService.selectedAccount).pipe(
        map((account) => account.uid ?? ''),
        distinctUntilChanged(),
        switchMap((uid) => {
          if (!uid) {
            this.trainingStatsLoading.set(false);
            return of(null);
          }
          this.trainingStatsLoading.set(true);
          // Starts from null so the previous organization's stats never show while this one's load.
          return this.trainingService.getTrainingStats(uid, OVERVIEW_TRAINING_STATS_QUERY).pipe(
            catchError((error: unknown) => {
              console.error('Failed to load org training stats for the Overview training tile:', error);
              return of(null);
            }),
            startWith(null),
            finalize(() => this.trainingStatsLoading.set(false))
          );
        })
      ),
      { initialValue: null }
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
    return computed(() => this.transformMaintainers(this.maintainersData(), this.getMetricConfig(ORG_MAINTAINER_ROLES_LABEL)));
  }

  private initializeEventAttendeesCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformEventAttendees(this.eventAttendanceMonthlyData(), this.getMetricConfig('Event Attendees')));
  }

  private initializeEventSpeakersCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformEventSpeakers(this.eventAttendanceMonthlyData(), this.getMetricConfig('Event Speakers')));
  }

  private initializePeopleWithTrainingActivityCard(): Signal<DashboardMetricCard> {
    return computed(() =>
      this.transformPeopleWithTrainingActivity(this.trainingStats(), this.getMetricConfig(ORG_TRAINING_STAT_DEFINITIONS.peopleWithTrainingActivity.label))
    );
  }

  private initializeCertifiedEmployeesCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformCertifiedEmployees(this.trainingStats(), this.getMetricConfig(ORG_TRAINING_STAT_DEFINITIONS.certifiedPeople.label)));
  }

  private initializeTrainingEnrollmentsCard(): Signal<DashboardMetricCard> {
    return computed(() => this.transformTrainingEnrollments(this.trainingStats(), this.getMetricConfig(ORG_TRAINING_STAT_DEFINITIONS.coursesTaken.label)));
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
      { card: this.peopleWithTrainingActivityCard(), category: 'education' },
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
      // Everyone credited to the org at the time of the work, with or without an employment record.
      subtitle: `${ORG_LENS_DEFAULT_VIEW_PHRASE}, credited to ${this.accountName()} at the time of their work`,
      tooltipText: ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION,
      chartOptions: this.createBarChartOptions('Active contributors'),
      chartCaption: OrgOverviewInvolvementComponent.monthlyWindowCaption(data.monthlyLabels),
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
    return {
      ...metric,
      loading: this.maintainersLoading(),
      // `null` means the roles are unavailable (roles table missing or the read failed): a dash, never zero.
      value: data.maintainerRoles === null ? '—' : String(data.maintainerRoles),
      subtitle: ORG_LENS_DEFAULT_VIEW_PHRASE,
      tooltipText: ORG_OVERVIEW_MAINTAINER_ROLES_DEFINITION,
      chartOptions: this.createBarChartOptions(ORG_MAINTAINER_ROLES_LABEL),
      chartCaption: OrgOverviewInvolvementComponent.monthlyWindowCaption(data.monthlyLabels),
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
      subtitle: ORG_OVERVIEW_EVENT_ATTENDEES_SUBTITLE,
      chartCaption: OrgOverviewInvolvementComponent.eventsWindowCaption(data.monthlyLabels),
      tooltipText: OrgOverviewInvolvementComponent.eventsTooltip(ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE[DEFAULT_ORG_EVENTS_PARTICIPATION]),
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
      subtitle: ORG_OVERVIEW_EVENT_SPEAKERS_SUBTITLE,
      chartCaption: OrgOverviewInvolvementComponent.eventsWindowCaption(data.monthlyLabels),
      tooltipText: OrgOverviewInvolvementComponent.eventsTooltip(ORG_EVENTS_SPEAKERS_CAPTION_PHRASE),
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

  /** Headline: people on the people list with training activity for the Training page's default range (unit, window and as-of in the subtitle). Stat-only: no chart. */
  private transformPeopleWithTrainingActivity(stats: OrgTrainingStats | null, metric: DashboardMetricCard): DashboardMetricCard {
    // A failed or pending stats read shows a dash, never a zero that reads as "nobody trained", and no as-of date.
    const people = buildOrgTrainingStatTiles(stats, OVERVIEW_TRAINING_STATS_QUERY.range).find((tile) => tile.key === 'peopleWithTrainingActivity')!;
    return {
      ...metric,
      loading: this.trainingStatsLoading(),
      value: people.display,
      subtitle: people.caption,
      tooltipText: people.tooltip,
    };
  }

  /**
   * Headline: certified people for the Training page's default range, subtitle the certifications (person-course
   * pairs) with the window and as-of date. Stat-only: no chart.
   */
  private transformCertifiedEmployees(stats: OrgTrainingStats | null, metric: DashboardMetricCard): DashboardMetricCard {
    const tiles = buildOrgTrainingStatTiles(stats, OVERVIEW_TRAINING_STATS_QUERY.range);
    const people = tiles.find((tile) => tile.key === 'certifiedPeople')!;
    const certifications = tiles.find((tile) => tile.key === 'certifications')!;
    return {
      ...metric,
      loading: this.trainingStatsLoading(),
      value: people.display,
      // A failed or pending stats read shows a dash, never a zero that reads as "nobody certified", and no as-of date.
      subtitle: stats === null ? people.caption : this.certifiedEmployeesSubtitle(certifications.display, stats),
      tooltipText: `${people.tooltip} ${certifications.tooltip}`,
    };
  }

  /** `N certifications · Past 2 years · as of <date>`: the certifications count, then the window and as-of parts of the people caption. */
  private certifiedEmployeesSubtitle(certifications: string, stats: OrgTrainingStats): string {
    const caption = orgTrainingStatCaptionParts(ORG_TRAINING_STAT_DEFINITIONS.certifiedPeople, OVERVIEW_TRAINING_STATS_QUERY.range, stats.asOf);
    return [`${certifications} certifications`, caption.window, caption.asOf].filter((part): part is string => !!part).join(' · ');
  }

  /** Headline: courses taken for the Training page's default range (unit, window and as-of in the subtitle). Stat-only: no chart. */
  private transformTrainingEnrollments(stats: OrgTrainingStats | null, metric: DashboardMetricCard): DashboardMetricCard {
    // A failed or pending stats read shows a dash, never a zero that reads as "nobody trained", and no as-of date.
    const coursesTaken = buildOrgTrainingStatTiles(stats, OVERVIEW_TRAINING_STATS_QUERY.range).find((tile) => tile.key === 'coursesTaken')!;
    return {
      ...metric,
      loading: this.trainingStatsLoading(),
      value: coursesTaken.display,
      subtitle: coursesTaken.caption,
      tooltipText: coursesTaken.tooltip,
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

  /** Overview Events tooltip: what is counted, by whom (the pinned Employee match default), and the distinct-people rule. */
  private static eventsTooltip(countPhrase: string): string {
    return `${countPhrase} ${ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE[DEFAULT_ORG_EVENTS_ATTRIBUTION]} ${ORG_OVERVIEW_EVENTS_DISTINCT_PEOPLE_NOTE}`;
  }

  /** Events chart caption: the points are distinct people per month. */
  private static eventsWindowCaption(labels: string[]): string | undefined {
    if (labels.length === 0) {
      return undefined;
    }
    return `Distinct people per month, ${labels[0]} – ${labels[labels.length - 1]} to date`;
  }

  /**
   * The window a monthly trend covers, stated under its chart: "Per month, Nov 2025 – Oct 2026 to date, LF and non-LF projects".
   * The BFF sends the 12 calendar months ending with this one, which is counted to date.
   */
  private static monthlyWindowCaption(labels: string[]): string | undefined {
    if (labels.length === 0) {
      return undefined;
    }
    return `Per month, ${labels[0]} – ${labels[labels.length - 1]} to date, ${ORG_DEFAULT_PROJECT_SCOPE_LABEL}`;
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
