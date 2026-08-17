// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';

import {
  buildEdEvolutionMetrics,
  ED_EVOLUTION_FILTER_OPTIONS,
  HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY,
  NO_TOOLTIP_CHART_OPTIONS,
} from '@lfx-one/shared/constants';
import {
  BrandHealthResponse,
  BrandReachResponse,
  DashboardDrawerType,
  DashboardMetricCard,
  EdEvolutionData,
  EngagedCommunitySizeResponse,
  EventGrowthResponse,
  FlywheelConversionResponse,
  MemberAcquisitionResponse,
  MemberRetentionResponse,
  MetricCategory,
  RevenueImpactResponse,
  SocialReachResponse,
  TrainingCertificationSummaryResponse,
} from '@lfx-one/shared/interfaces';

import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, forkJoin, map, Observable, of, skip, startWith, Subject, switchMap, tap } from 'rxjs';

import { BrandHealthDrawerComponent } from '../brand-health-drawer/brand-health-drawer.component';
import { BrandReachDrawerComponent } from '../brand-reach-drawer/brand-reach-drawer.component';
import { EducationDrawerComponent } from '../education-drawer/education-drawer.component';
import { EmailCtrDrawerComponent } from '../email-ctr-drawer/email-ctr-drawer.component';
import { EngagedCommunityDrawerComponent } from '../engaged-community-drawer/engaged-community-drawer.component';
import { EventGrowthDrawerComponent } from '../event-growth-drawer/event-growth-drawer.component';
import { FlywheelConversionDrawerComponent } from '../flywheel-conversion-drawer/flywheel-conversion-drawer.component';
import { MemberAcquisitionDrawerComponent } from '../member-acquisition-drawer/member-acquisition-drawer.component';
import { PaidSocialReachDrawerComponent } from '../paid-social-reach-drawer/paid-social-reach-drawer.component';
import { RevenueImpactDrawerComponent } from '../revenue-impact-drawer/revenue-impact-drawer.component';
import { WebsiteVisitsDrawerComponent } from '../website-visits-drawer/website-visits-drawer.component';

const EMPTY_ED_EVOLUTION_DATA: EdEvolutionData = {
  // Explicitly undefined for the same reason as revenueImpact below: a zero-filled response
  // renders "0.0%" on the Flywheel card, which reads as a measured conversion rate rather
  // than a failed request.
  flywheel: undefined,
  // Explicitly undefined for the same reason as revenueImpact below: zero paying members is
  // a legitimate measurement, so the Members card must not fall back to it.
  memberAcquisition: undefined,
  // Explicitly undefined for the same reason as memberAcquisition above — this response
  // supplies the Members caption, so a zero-filled fallback reports "0.0% retention · NRR
  // 0.0%" as if measured.
  memberRetention: undefined,
  // Explicitly undefined for the same reason as revenueImpact below: 27,831 engaged
  // individuals rendered as "0" on AAIF when this fell back to a zero-filled response.
  engagedCommunity: undefined,
  // Explicitly undefined for the same reason as revenueImpact below: a zero-filled response
  // renders "0" registrants, indistinguishable from a foundation that genuinely ran no events.
  eventGrowth: undefined,
  // Explicitly undefined for the same reason as revenueImpact below: zero followers and
  // zero sessions are legitimate measurements, so the Social and Web cards must not fall
  // back to them. AAIF has 17,269 followers across 2 platforms and rendered "0 · 0
  // platforms" on a cold load when brand-reach failed inside the dashboard's request
  // burst — an outage presented as a measured absence.
  brandReach: undefined,
  // Explicitly undefined for the same reason as revenueImpact below: AAIF has 80,799
  // mentions and the card read "0" when this fell back to a zero-filled response.
  brandHealth: undefined,
  // Explicitly undefined rather than zero-filled: safe() reads EMPTY_ED_EVOLUTION_DATA[key]
  // as the per-call error fallback, and the Attribution card renders an unavailable state
  // on undefined. A zero-filled summary here would render the card at $0 on a failed
  // request — reporting a fabricated figure as a measured one.
  revenueImpact: undefined,
  // Explicitly undefined for the same reason as revenueImpact above. This one was reported
  // from production: the Email card read "0 opens · 0.0% CTR" for a foundation whose March
  // campaign had 100 opens at a 76.3% CTR, because the zero-filled fallback summed to 0 and
  // nothing downstream could tell that apart from a month with no email.
  emailCtr: undefined,
  // Explicitly undefined for the same reason as revenueImpact above — zero spend and
  // 0.0x ROAS are real measurements, so the Paid Media card must not fall back to them.
  paidCampaign: undefined,
  // Explicitly undefined rather than omitted: safe() reads EMPTY_ED_EVOLUTION_DATA[key]
  // as the per-call error fallback, and the Education card is suppressed on undefined.
  // A zero-filled summary here would render the card at 0 on a failed request instead.
  education: undefined,
};

/**
 * Initial value for the forkJoin signal, used only while the first requests are in flight.
 *
 * Structurally identical to EMPTY_ED_EVOLUTION_DATA except for `pending: true`. The two
 * must stay distinct: EMPTY_ED_EVOLUTION_DATA encodes "the request failed" (undefined
 * revenueImpact/paidCampaign render an explicit unavailable state), whereas this encodes
 * "not answered yet". Reusing the error object as the initial value made both cards
 * announce "could not be loaded" before any request had failed.
 */
const PENDING_ED_EVOLUTION_DATA: EdEvolutionData = {
  ...EMPTY_ED_EVOLUTION_DATA,
  pending: true,
};

/**
 * Zero-filled revenue impact used ONLY to satisfy the drill-down drawers' non-nullable
 * `RevenueImpactResponse` inputs when the summary request failed.
 *
 * This is deliberately not reachable from the Attribution card, which branches on the
 * raw `undefined` and renders an explicit unavailable state instead. It is safe today
 * only because every field on this placeholder is empty/zero and every drawer that reads
 * `data()` directly (revenue-impact-drawer's attributionChannels/paidMedia/projectBreakdown/
 * eventRegistrationAttribution, member-acquisition-drawer's revenueImpactData, and this
 * component's own social-reach data) either length-guards arrays or never reads a numeric
 * field without one — not because those sections refetch their own summary. paid-social-
 * reach-drawer's own social-reach panel does refetch independently (see initDrawerData);
 * the revenueImpact-derived sections above do not. Adding a field that's read without a
 * guard would silently reintroduce the fabricated-zero problem this PR removes elsewhere.
 */
const DRAWER_FALLBACK_REVENUE_IMPACT: RevenueImpactResponse = {
  pipelineInfluenced: 0,
  revenueAttributed: 0,
  matchRate: 0,
  changePercentage: 0,
  trend: 'up',
  attributionModels: { linear: 0, firstTouch: 0, lastTouch: 0 },
  engagementTypes: [],
  paidMedia: { roas: 0, impressions: 0, adSpend: 0, adRevenue: 0, monthlyTrend: [] },
  attributionChannels: [],
  projectBreakdown: [],
  eventRegistrationAttribution: { channelBreakdown: [], monthlyTrend: [] },
};

@Component({
  selector: 'lfx-marketing-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ChartComponent,
    FilterPillsComponent,
    MetricCardComponent,
    ScrollShadowDirective,
    TooltipModule,

    // Existing drawers
    WebsiteVisitsDrawerComponent,
    EmailCtrDrawerComponent,
    PaidSocialReachDrawerComponent,
    EngagedCommunityDrawerComponent,
    MemberAcquisitionDrawerComponent,
    FlywheelConversionDrawerComponent,

    // New prototype drawers
    EventGrowthDrawerComponent,
    BrandReachDrawerComponent,
    BrandHealthDrawerComponent,
    RevenueImpactDrawerComponent,
    EducationDrawerComponent,
  ],
  templateUrl: './marketing-overview.component.html',
  styleUrl: './marketing-overview.component.scss',
})
export class MarketingOverviewComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  // === Constants ===
  protected readonly filterOptions = ED_EVOLUTION_FILTER_OPTIONS;
  protected readonly noTooltipChartOptions = NO_TOOLTIP_CHART_OPTIONS;
  protected readonly DashboardDrawerType = DashboardDrawerType;

  // === WritableSignals ===
  public readonly selectedFilter = signal<'all' | MetricCategory>('all');
  public readonly activeDrawer = signal<DashboardDrawerType | null>(null);

  // === Computed Signals ===
  // Lazy-fetch mentions via Subject trigger + switchMap (no manual subscribe).
  // Foundation changes automatically cancel in-flight requests via switchMap.
  private readonly mentionsTrigger$ = new Subject<string>();
  private readonly brandHealthMentions: Signal<Pick<BrandHealthResponse, 'topPositiveMentions' | 'topNegativeMentions'> | null> =
    this.initBrandHealthMentions();
  protected readonly edEvolutionData: Signal<EdEvolutionData> = this.initEdEvolutionData();

  /**
   * Drawer-facing only, exactly like engagedCommunityData below: the Flywheel card reads
   * `edEvolutionData().flywheel` directly and renders an unavailable state on undefined,
   * while the drawer takes a non-optional input and length-guards its own collections.
   * Never source a card value from here — an empty shape here reads as a measured zero.
   */
  protected readonly flywheelData = computed<FlywheelConversionResponse>(
    () =>
      this.edEvolutionData().flywheel ?? {
        conversionRate: 0,
        changePercentage: 0,
        trend: 'up',
        funnel: {
          eventAttendees: 0,
          convertedToNewsletter: 0,
          convertedToCommunity: 0,
          convertedToWorkingGroup: 0,
          convertedToTraining: 0,
          convertedToCode: 0,
          convertedToWeb: 0,
        },
        reengagement: {
          totalReengaged: 0,
          reengagementRate: 0,
          reengagementMomChange: 0,
          reengagedToNewsletter: 0,
          reengagedToCommunity: 0,
          reengagedToWorkingGroup: 0,
          reengagedToTraining: 0,
          reengagedToCode: 0,
          reengagedToWeb: 0,
        },
        monthlyData: [],
      }
  );
  /**
   * Drawer-facing only, exactly like engagedCommunityData below: the Members card reads
   * `edEvolutionData().memberAcquisition` directly and renders an unavailable state on undefined,
   * while the drawer takes a non-optional input and length-guards its own collections.
   * Never source a card value from here — an empty shape here reads as a measured zero.
   */
  protected readonly memberAcquisitionData = computed<MemberAcquisitionResponse>(
    () =>
      this.edEvolutionData().memberAcquisition ?? {
        totalMembers: 0,
        totalMembersMonthlyData: [],
        totalMembersMonthlyLabels: [],
        newMembersThisQuarter: 0,
        newMemberRevenue: 0,
        changePercentage: 0,
        trend: 'up',
        quarterlyData: [],
      }
  );
  /**
   * Drawer-facing only, exactly like engagedCommunityData below: the Members card reads
   * `edEvolutionData().memberRetention` directly and renders an unavailable state on undefined,
   * while the drawer takes a non-optional input and length-guards its own collections.
   * Never source a card value from here — an empty shape here reads as a measured zero.
   */
  protected readonly memberRetentionData = computed<MemberRetentionResponse>(
    () => this.edEvolutionData().memberRetention ?? { renewalRate: 0, netRevenueRetention: 0, changePercentage: 0, trend: 'up', target: 0, monthlyData: [] }
  );
  /**
   * Drawer-facing only, exactly like brandReachData below: the Adoption card reads
   * `edEvolutionData().engagedCommunity` and renders an unavailable state on undefined,
   * while the drawer takes a non-optional input and length-guards its own collections.
   * Never source a card value from here — that is what printed "0" for AAIF's 27,831.
   */
  protected readonly engagedCommunityData = computed<EngagedCommunitySizeResponse>(
    () =>
      this.edEvolutionData().engagedCommunity ?? {
        totalMembers: 0,
        changePercentage: 0,
        trend: 'up',
        breakdown: {
          newsletterSubscribers: 0,
          communityMembers: 0,
          workingGroupMembers: 0,
          certifiedIndividuals: 0,
          webVisitors: 0,
          codeContributors: 0,
          trainingEnrollees: 0,
        },
        monthlyData: [],
      }
  );
  /**
   * Drawer-facing only, exactly like engagedCommunityData below: the Events card reads
   * `edEvolutionData().eventGrowth` directly and renders an unavailable state on undefined,
   * while the drawer takes a non-optional input and length-guards its own collections.
   * Never source a card value from here — an empty shape here reads as a measured zero.
   */
  protected readonly eventGrowthData = computed<EventGrowthResponse>(
    () =>
      this.edEvolutionData().eventGrowth ?? {
        totalAttendees: 0,
        totalRegistrants: 0,
        totalEvents: 0,
        totalRevenue: 0,
        revenuePerAttendee: 0,
        attendeeYoyChange: 0,
        registrantYoyChange: 0,
        revenueYoyChange: 0,
        trend: 'up',
        monthlyData: [],
        topEvents: [],
      }
  );
  /**
   * Drawer-facing only. The Social and Web cards read `edEvolutionData().brandReach`
   * directly and render an unavailable state when it is undefined; the drawers take a
   * non-optional input and already render their own "not yet available" copy for empty
   * collections, so an empty shape here is the smaller change and says the same thing.
   * It must never be used to source a card value — that is what printed "0 · 0 platforms"
   * for a foundation with 17,269 followers.
   */
  protected readonly brandReachData = computed<BrandReachResponse>(
    () =>
      this.edEvolutionData().brandReach ?? {
        totalSocialFollowers: 0,
        totalMonthlySessions: 0,
        activePlatforms: 0,
        changePercentage: 0,
        sessionMomChangePct: 0,
        trend: 'up',
        socialPlatforms: [],
        websiteDomains: [],
        weeklyTrend: [],
      }
  );
  /**
   * Drawer-facing only, like brandReachData and engagedCommunityData: the Sentiment card
   * reads `edEvolutionData().brandHealth` and renders an unavailable state on undefined.
   * Never source a card value from here — that printed "0" for AAIF's 80,799 mentions.
   */
  protected readonly brandHealthData = computed<BrandHealthResponse>(() => {
    const base = this.edEvolutionData().brandHealth ?? {
      totalMentions: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0 },
      sentimentMomChangePp: 0,
      mentionMomChangePct: null,
      trend: 'up' as const,
      monthlyMentions: [],
      topProjects: [],
      topPositiveMentions: [],
      topNegativeMentions: [],
    };
    const mentions = this.brandHealthMentions();
    return mentions ? { ...base, ...mentions } : base;
  });
  // Drawer-facing only. The Attribution card reads edEvolutionData().revenueImpact
  // directly so it can distinguish a failed request from a genuine zero; the drawers
  // take a non-nullable input and refetch their own detail data, so they get the
  // placeholder rather than a widened contract.
  protected readonly revenueImpactData = computed<RevenueImpactResponse>(() => this.edEvolutionData().revenueImpact ?? DRAWER_FALLBACK_REVENUE_IMPACT);
  // Falls back to the shared zero summary so the drawer input stays non-optional. The card
  // is suppressed when there is no education data, so the fallback is not normally reachable.
  protected readonly educationData = computed<TrainingCertificationSummaryResponse>(
    () => this.edEvolutionData().education ?? HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY
  );

  // Rendered directly by the carousel, in array order — the category split that used
  // to sit here regrouped the cards and overrode the intended sequence.
  protected readonly filteredCards: Signal<DashboardMetricCard[]> = this.initFilteredCards();

  // === Public Methods ===
  public handleCardClick(drawerType: DashboardDrawerType): void {
    if (this.activeDrawer() === drawerType) {
      return;
    }

    this.activeDrawer.set(drawerType);

    // Lazy-fetch mentions only when the Brand Health drawer is opened for the first time.
    // Guarding repeated clicks on the already active drawer prevents duplicate trigger
    // emissions while the initial mentions request is still in flight.
    if (drawerType === DashboardDrawerType.BrandHealth && !this.brandHealthMentions()) {
      this.mentionsTrigger$.next(this.projectContextService.selectedFoundation()?.slug || 'tlf');
    }
  }

  public handleDrawerClose(): void {
    this.activeDrawer.set(null);
  }

  public setFilter(value: string): void {
    this.selectedFilter.set(value as 'all' | MetricCategory);
  }

  // === Private Initializers ===
  private initFilteredCards(): Signal<DashboardMetricCard[]> {
    return computed<DashboardMetricCard[]>(() => {
      const cards = buildEdEvolutionMetrics(this.edEvolutionData());
      const filterKey = this.selectedFilter();
      if (filterKey === 'all') return cards;
      return cards.filter((card) => card.category === filterKey);
    });
  }

  private initBrandHealthMentions(): Signal<Pick<BrandHealthResponse, 'topPositiveMentions' | 'topNegativeMentions'> | null> {
    // Reset mentions when foundation changes — toObservable + tap replaces
    // the previous effect() to avoid writing signals inside effect().
    toObservable(this.projectContextService.selectedFoundation)
      .pipe(
        skip(1),
        tap(() => this.mentionsTrigger$.next('')),
        takeUntilDestroyed()
      )
      .subscribe();

    return toSignal(
      this.mentionsTrigger$.pipe(
        switchMap((slug) => {
          if (!slug) return of(null);
          return this.analyticsService.getBrandHealth(slug, true, 'last-6').pipe(
            map((res) => ({ topPositiveMentions: res.topPositiveMentions, topNegativeMentions: res.topNegativeMentions })),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initEdEvolutionData(): Signal<EdEvolutionData> {
    // ED dashboard intentionally falls back to `tlf` (the umbrella foundation) when no specific
    // foundation is selected — that is the default "all foundations" view for executive directors.
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || 'tlf'));

    // Per-call catchError ensures a single failing Snowflake query degrades only its own card
    // rather than taking down the whole dashboard. Errors are swallowed client-side — the server
    // logger already records the upstream failure.
    const safe = <T>(key: keyof EdEvolutionData, obs: Observable<T>): Observable<T> => obs.pipe(catchError(() => of(EMPTY_ED_EVOLUTION_DATA[key] as T)));

    return toSignal(
      foundation$.pipe(
        switchMap((slug) =>
          forkJoin({
            // getFlywheelConversion is the one service here that swallows its own HTTP error
            // into of(null), so safe()'s catchError never fires for it and this map is the
            // real failure path. Coalesce to undefined explicitly rather than through
            // EMPTY_ED_EVOLUTION_DATA.flywheel — that now IS undefined, which hides the
            // dependency and lets a later "cleanup" put null into a field typed
            // FlywheelConversionResponse | undefined.
            flywheel: safe<FlywheelConversionResponse | undefined>(
              'flywheel',
              this.analyticsService.getFlywheelConversion(slug).pipe(map((r) => r ?? undefined))
            ),
            memberAcquisition: safe('memberAcquisition', this.analyticsService.getMemberAcquisition(slug)),
            memberRetention: safe('memberRetention', this.analyticsService.getMemberRetention(slug)),
            engagedCommunity: safe('engagedCommunity', this.analyticsService.getEngagedCommunity(slug)),
            eventGrowth: safe('eventGrowth', this.analyticsService.getEventGrowth(slug)),
            brandReach: safe('brandReach', this.analyticsService.getBrandReach(slug)),
            // Period-aware endpoints get the last-6 preset explicitly: their trend
            // sections are designed (and labeled) as 6-month windows, and omitting
            // the period silently falls back to the previous completed month. MoM
            // KPIs are unaffected — both windows share the same period END.
            brandHealth: safe('brandHealth', this.analyticsService.getBrandHealth(slug, false, 'last-6')),
            // Explicit `| undefined` type argument on these two: their error fallback
            // is genuinely undefined (see EMPTY_ED_EVOLUTION_DATA), so letting safe()
            // infer T from the observable alone would type away the failure case that
            // the Paid Media and Attribution cards branch on.
            revenueImpact: safe<RevenueImpactResponse | undefined>('revenueImpact', this.analyticsService.getRevenueImpact(slug, undefined, 'last-6')),
            emailCtr: safe('emailCtr', this.analyticsService.getEmailCtr(slug, undefined, 'last-6')),
            paidCampaign: safe<SocialReachResponse | undefined>('paidCampaign', this.analyticsService.getSocialReach(slug, undefined, 'last-6')),
            // Reuses the Health Metrics training-certification endpoint so the Education
            // card cannot disagree with that card. 'YTD' matches the default range there.
            //
            // getTrainingCertificationSummary() converts HTTP errors into an all-zeros
            // response (its contract, relied on by the Health Metrics card — not changed
            // here). That makes a failed request indistinguishable from a foundation with
            // no training, and both would silently hide this card. Map the all-zeros shape
            // back to undefined so "request failed" and "genuinely zero enrollments" stay
            // distinguishable: undefined suppresses the card, real zeros are impossible to
            // reach here because the card is only built when total enrollments are > 0.
            education: safe<TrainingCertificationSummaryResponse | undefined>(
              'education',
              this.analyticsService.getTrainingCertificationSummary(slug, 'YTD').pipe(map((res) => (res && res.projectId !== '' ? res : undefined)))
            ),
          }).pipe(
            // Without this, switchMap's cancellation of the previous forkJoin leaves toSignal
            // holding its last-emitted value — including a stale failed/unavailable card — until
            // the new forkJoin resolves, misreporting the newly-selected foundation as failed
            // before it has even been requested. Re-emitting the pending sentinel synchronously
            // on every foundation switch (not just the initial subscription) closes that gap.
            startWith(PENDING_ED_EVOLUTION_DATA)
          )
        )
      ),
      // Distinct pending sentinel, NOT EMPTY_ED_EVOLUTION_DATA: that object carries
      // `undefined` for revenueImpact/paidCampaign as its *error* fallback, so reusing
      // it here would make both cards announce "could not be loaded" during the initial
      // in-flight window — reporting a failure before one has occurred.
      { initialValue: PENDING_ED_EVOLUTION_DATA }
    ) as Signal<EdEvolutionData>;
  }
}
