// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { ChartComponent } from '@components/chart/chart.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';

import { buildEdEvolutionMetrics, ED_EVOLUTION_FILTER_OPTIONS, NO_TOOLTIP_CHART_OPTIONS } from '@lfx-one/shared/constants';
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
} from '@lfx-one/shared/interfaces';

import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, forkJoin, map, Observable, of, skip, Subject, switchMap, tap } from 'rxjs';

import { BrandHealthDrawerComponent } from '../brand-health-drawer/brand-health-drawer.component';
import { BrandReachDrawerComponent } from '../brand-reach-drawer/brand-reach-drawer.component';
import { EmailCtrDrawerComponent } from '../email-ctr-drawer/email-ctr-drawer.component';
import { EngagedCommunityDrawerComponent } from '../engaged-community-drawer/engaged-community-drawer.component';
import { EventGrowthDrawerComponent } from '../event-growth-drawer/event-growth-drawer.component';
import { FlywheelConversionDrawerComponent } from '../flywheel-conversion-drawer/flywheel-conversion-drawer.component';
import { MemberAcquisitionDrawerComponent } from '../member-acquisition-drawer/member-acquisition-drawer.component';
import { PaidSocialReachDrawerComponent } from '../paid-social-reach-drawer/paid-social-reach-drawer.component';
import { RevenueImpactDrawerComponent } from '../revenue-impact-drawer/revenue-impact-drawer.component';
import { SocialMediaDrawerComponent } from '../social-media-drawer/social-media-drawer.component';
import { WebsiteVisitsDrawerComponent } from '../website-visits-drawer/website-visits-drawer.component';

const EMPTY_ED_EVOLUTION_DATA: EdEvolutionData = {
  flywheel: {
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
  },
  memberAcquisition: {
    totalMembers: 0,
    totalMembersMonthlyData: [],
    totalMembersMonthlyLabels: [],
    newMembersThisQuarter: 0,
    newMemberRevenue: 0,
    changePercentage: 0,
    trend: 'up',
    quarterlyData: [],
  },
  memberRetention: {
    renewalRate: 0,
    netRevenueRetention: 0,
    changePercentage: 0,
    trend: 'up',
    target: 0,
    monthlyData: [],
  },
  engagedCommunity: {
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
  },
  eventGrowth: {
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
  },
  brandReach: {
    totalSocialFollowers: 0,
    totalMonthlySessions: 0,
    activePlatforms: 0,
    changePercentage: 0,
    trend: 'up',
    socialPlatforms: [],
    websiteDomains: [],
    weeklyTrend: [],
  },
  brandHealth: {
    totalMentions: 0,
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    sentimentMomChangePp: 0,
    trend: 'up',
    monthlyMentions: [],
    topProjects: [],
    topPositiveMentions: [],
    topNegativeMentions: [],
  },
  revenueImpact: {
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
  },
};

@Component({
  selector: 'lfx-marketing-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ButtonComponent,
    ChartComponent,
    FilterPillsComponent,
    MetricCardComponent,
    ScrollShadowDirective,
    TooltipModule,

    // Existing drawers
    WebsiteVisitsDrawerComponent,
    EmailCtrDrawerComponent,
    PaidSocialReachDrawerComponent,
    SocialMediaDrawerComponent,
    EngagedCommunityDrawerComponent,
    MemberAcquisitionDrawerComponent,
    FlywheelConversionDrawerComponent,

    // New prototype drawers
    EventGrowthDrawerComponent,
    BrandReachDrawerComponent,
    BrandHealthDrawerComponent,
    RevenueImpactDrawerComponent,
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

  protected readonly flywheelData = computed<FlywheelConversionResponse>(() => this.edEvolutionData().flywheel);
  protected readonly memberAcquisitionData = computed<MemberAcquisitionResponse>(() => this.edEvolutionData().memberAcquisition);
  protected readonly memberRetentionData = computed<MemberRetentionResponse>(() => this.edEvolutionData().memberRetention);
  protected readonly engagedCommunityData = computed<EngagedCommunitySizeResponse>(() => this.edEvolutionData().engagedCommunity);
  protected readonly eventGrowthData = computed<EventGrowthResponse>(() => this.edEvolutionData().eventGrowth);
  protected readonly brandReachData = computed<BrandReachResponse>(() => this.edEvolutionData().brandReach);
  protected readonly brandHealthData = computed<BrandHealthResponse>(() => {
    const base = this.edEvolutionData().brandHealth;
    const mentions = this.brandHealthMentions();
    return mentions ? { ...base, ...mentions } : base;
  });
  protected readonly revenueImpactData = computed<RevenueImpactResponse>(() => this.edEvolutionData().revenueImpact);

  protected readonly filteredCards: Signal<DashboardMetricCard[]> = this.initFilteredCards();

  protected readonly northStarCards = computed<DashboardMetricCard[]>(() => this.filteredCards().filter((c) => c.category === 'memberships'));
  protected readonly nonNorthStarCards = computed<DashboardMetricCard[]>(() => this.filteredCards().filter((c) => c.category !== 'memberships'));
  protected readonly totalCardCount = computed<number>(() => this.filteredCards().length);

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
          return this.analyticsService.getBrandHealth(slug, true).pipe(
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
            flywheel: safe('flywheel', this.analyticsService.getFlywheelConversion(slug).pipe(map((r) => r ?? EMPTY_ED_EVOLUTION_DATA.flywheel))),
            memberAcquisition: safe('memberAcquisition', this.analyticsService.getMemberAcquisition(slug)),
            memberRetention: safe('memberRetention', this.analyticsService.getMemberRetention(slug)),
            engagedCommunity: safe('engagedCommunity', this.analyticsService.getEngagedCommunity(slug)),
            eventGrowth: safe('eventGrowth', this.analyticsService.getEventGrowth(slug)),
            brandReach: safe('brandReach', this.analyticsService.getBrandReach(slug)),
            brandHealth: safe('brandHealth', this.analyticsService.getBrandHealth(slug)),
            revenueImpact: safe('revenueImpact', this.analyticsService.getRevenueImpact(slug)),
          })
        )
      ),
      { initialValue: EMPTY_ED_EVOLUTION_DATA }
    ) as Signal<EdEvolutionData>;
  }
}
