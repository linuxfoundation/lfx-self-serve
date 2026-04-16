// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, signal, Signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';

import { MARKETING_OVERVIEW_METRICS, NO_TOOLTIP_CHART_OPTIONS } from '@lfx-one/shared/constants';
import { lfxColors } from '@lfx-one/shared/constants';
import {
  DashboardDrawerType,
  DashboardMetricCard,
  EmailCtrResponse,
  EngagedCommunitySizeResponse,
  FlywheelConversionResponse,
  MemberAcquisitionResponse,
  MemberRetentionResponse,
  SocialMediaResponse,
  SocialReachResponse,
  WebActivitiesSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { formatNumber, hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';

import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { catchError, combineLatest, filter, finalize, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { EmailCtrDrawerComponent } from '../email-ctr-drawer/email-ctr-drawer.component';
import { EngagedCommunityDrawerComponent } from '../engaged-community-drawer/engaged-community-drawer.component';
import { FlywheelConversionDrawerComponent } from '../flywheel-conversion-drawer/flywheel-conversion-drawer.component';
import { MemberAcquisitionDrawerComponent } from '../member-acquisition-drawer/member-acquisition-drawer.component';
import { PaidSocialReachDrawerComponent } from '../paid-social-reach-drawer/paid-social-reach-drawer.component';
import { SocialMediaDrawerComponent } from '../social-media-drawer/social-media-drawer.component';
import { WebsiteVisitsDrawerComponent } from '../website-visits-drawer/website-visits-drawer.component';

@Component({
  selector: 'lfx-marketing-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    MetricCardComponent,
    ScrollShadowDirective,

    WebsiteVisitsDrawerComponent,
    EmailCtrDrawerComponent,
    PaidSocialReachDrawerComponent,
    SocialMediaDrawerComponent,
    EngagedCommunityDrawerComponent,
    MemberAcquisitionDrawerComponent,
    FlywheelConversionDrawerComponent,
  ],
  templateUrl: './marketing-overview.component.html',
  styleUrl: './marketing-overview.component.scss',
})
export class MarketingOverviewComponent {
  public readonly scrollShadowDirective = viewChild(ScrollShadowDirective);

  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  // === WritableSignals ===
  protected readonly marketingDataLoading = signal(true);
  private readonly browserReady = signal(false);
  public readonly activeDrawer = signal<DashboardDrawerType | null>(null);

  // === Observables ===
  private readonly selectedFoundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(
    map((foundation) => ({ slug: foundation?.slug || '', name: foundation?.name || '' }))
  );

  // === Constants ===
  protected readonly DashboardDrawerType = DashboardDrawerType;

  // === Computed Signals ===
  protected readonly marketingInsights: Signal<string[]> = this.initMarketingInsights();
  protected readonly marketingData: Signal<{
    webActivities: WebActivitiesSummaryResponse;
    emailCtr: EmailCtrResponse;
    socialReach: SocialReachResponse;
    socialMedia: SocialMediaResponse;
    memberRetention: MemberRetentionResponse;
    memberAcquisition: MemberAcquisitionResponse;
    engagedCommunity: EngagedCommunitySizeResponse;
    flywheelConversion: FlywheelConversionResponse;
  }> = this.initMarketingData();
  protected readonly marketingCards: Signal<DashboardMetricCard[]> = this.initMarketingCards();
  protected readonly formatNumber = formatNumber;
  protected readonly noTooltipChartOptions = NO_TOOLTIP_CHART_OPTIONS;

  // North Star sparkline chart data
  protected readonly memberGrowthChartData = computed(() => {
    const { totalMembersMonthlyData, totalMembersMonthlyLabels } = this.marketingData().memberAcquisition;
    if (totalMembersMonthlyData.length === 0) return undefined;
    return {
      labels: totalMembersMonthlyLabels,
      datasets: [
        {
          data: totalMembersMonthlyData,
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  });

  protected readonly flywheelChartData = computed(() => {
    const { monthlyData } = this.marketingData().flywheelConversion;
    if (monthlyData.length === 0) return undefined;
    return {
      labels: monthlyData.map((d) => d.month),
      datasets: [
        {
          data: monthlyData.map((d) => d.value),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  });

  protected readonly engagedCommunityChartData = computed(() => {
    const { monthlyData } = this.marketingData().engagedCommunity;
    if (monthlyData.length === 0) return undefined;
    return {
      labels: monthlyData.map((d) => d.month),
      datasets: [
        {
          data: monthlyData.map((d) => d.value),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  });

  public constructor() {
    afterNextRender(() => {
      this.browserReady.set(true);
    });
  }

  // === Public Methods ===
  public handleCardClick(drawerType: DashboardDrawerType): void {
    this.activeDrawer.set(drawerType);
  }

  public handleDrawerClose(): void {
    this.activeDrawer.set(null);
  }

  // === Private Initializers ===
  private initMarketingCards(): Signal<DashboardMetricCard[]> {
    return computed(() => {
      const { webActivities, emailCtr, socialReach, socialMedia } = this.marketingData();
      const loading = this.marketingDataLoading();

      return MARKETING_OVERVIEW_METRICS.map((card) => {
        switch (card.drawerType) {
          case DashboardDrawerType.MarketingWebsiteVisits:
            return this.transformWebsiteVisits(card, webActivities, loading);
          case DashboardDrawerType.MarketingEmailCtr:
            return this.transformEmailCtr(card, emailCtr, loading);
          case DashboardDrawerType.MarketingPaidSocialReach:
            return this.transformSocialReach(card, socialReach, loading);
          case DashboardDrawerType.MarketingSocialMedia:
            return this.transformSocialMedia(card, socialMedia, loading);
          default:
            return card;
        }
      });
    });
  }

  private initMarketingData(): Signal<{
    webActivities: WebActivitiesSummaryResponse;
    emailCtr: EmailCtrResponse;
    socialReach: SocialReachResponse;
    socialMedia: SocialMediaResponse;
    memberRetention: MemberRetentionResponse;
    memberAcquisition: MemberAcquisitionResponse;
    engagedCommunity: EngagedCommunitySizeResponse;
    flywheelConversion: FlywheelConversionResponse;
  }> {
    const defaultWebActivities: WebActivitiesSummaryResponse = {
      totalSessions: 0,
      totalPageViews: 0,
      domainGroups: [],
      dailyData: [],
      dailyLabels: [],
    };

    const defaultEmailCtr: EmailCtrResponse = {
      currentCtr: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      campaignGroups: [],
      monthlySends: [],
      monthlyOpens: [],
    };

    const defaultSocialReach: SocialReachResponse = {
      totalReach: 0,
      roas: 0,
      totalSpend: 0,
      totalRevenue: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      monthlyRoas: [],
      channelGroups: [],
    };

    const defaultSocialMedia: SocialMediaResponse = {
      totalFollowers: 0,
      totalPlatforms: 0,
      changePercentage: 0,
      trend: 'up',
      platforms: [],
      monthlyData: [],
    };

    const defaultMemberRetention: MemberRetentionResponse = {
      renewalRate: 0,
      netRevenueRetention: 0,
      changePercentage: 0,
      trend: 'up',
      target: 85,
      monthlyData: [],
    };

    const defaultMemberAcquisition: MemberAcquisitionResponse = {
      totalMembers: 0,
      totalMembersMonthlyData: [],
      totalMembersMonthlyLabels: [],
      newMembersThisQuarter: 0,
      newMemberRevenue: 0,
      changePercentage: 0,
      trend: 'up',
      quarterlyData: [],
    };

    const defaultEngagedCommunity: EngagedCommunitySizeResponse = {
      totalMembers: 0,
      changePercentage: 0,
      trend: 'up',
      breakdown: {
        newsletterSubscribers: 0,
        communityMembers: 0,
        workingGroupMembers: 0,
        certifiedIndividuals: 0,
      },
      monthlyData: [],
    };

    const defaultFlywheelConversion: FlywheelConversionResponse = {
      conversionRate: 0,
      changePercentage: 0,
      trend: 'up',
      funnel: {
        eventAttendees: 0,
        convertedToNewsletter: 0,
        convertedToCommunity: 0,
        convertedToWorkingGroup: 0,
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
    };

    const defaultValue = {
      webActivities: defaultWebActivities,
      emailCtr: defaultEmailCtr,
      socialReach: defaultSocialReach,
      socialMedia: defaultSocialMedia,
      memberRetention: defaultMemberRetention,
      memberAcquisition: defaultMemberAcquisition,
      engagedCommunity: defaultEngagedCommunity,
      flywheelConversion: defaultFlywheelConversion,
    };

    return toSignal(
      combineLatest([toObservable(this.browserReady), this.selectedFoundation$]).pipe(
        filter(([ready, foundation]) => ready && !!foundation.slug),
        map(([, foundation]) => foundation),
        tap(() => {
          this.marketingDataLoading.set(true);
          this.activeDrawer.set(null);
        }),
        switchMap((foundation) =>
          forkJoin({
            webActivities: this.analyticsService.getWebActivitiesSummary(foundation.slug).pipe(catchError(() => of(defaultWebActivities))),
            emailCtr: this.analyticsService.getEmailCtr(foundation.name).pipe(catchError(() => of(defaultEmailCtr))),
            socialReach: this.analyticsService.getSocialReach(foundation.name).pipe(catchError(() => of(defaultSocialReach))),
            socialMedia: this.analyticsService.getSocialMedia(foundation.name).pipe(catchError(() => of(defaultSocialMedia))),
            memberRetention: this.analyticsService.getMemberRetention(foundation.slug).pipe(catchError(() => of(defaultMemberRetention))),
            memberAcquisition: this.analyticsService.getMemberAcquisition(foundation.slug).pipe(catchError(() => of(defaultMemberAcquisition))),
            engagedCommunity: this.analyticsService.getEngagedCommunity(foundation.slug).pipe(catchError(() => of(defaultEngagedCommunity))),
            flywheelConversion: this.analyticsService.getFlywheelConversion(foundation.slug).pipe(catchError(() => of(defaultFlywheelConversion))),
          }).pipe(tap(() => this.marketingDataLoading.set(false)))
        ),
        finalize(() => this.marketingDataLoading.set(false))
      ),
      { initialValue: defaultValue }
    );
  }

  private initMarketingInsights(): Signal<string[]> {
    return computed(() => {
      const data = this.marketingData();
      if (this.marketingDataLoading()) {
        return [];
      }

      // Collect all metrics that have meaningful data and a change percentage
      const signals: { label: string; change: number; detail: string }[] = [];

      if (data.socialMedia.totalFollowers > 0) {
        signals.push({
          label: 'Social followers',
          change: data.socialMedia.changePercentage,
          detail: formatNumber(data.socialMedia.totalFollowers),
        });
      }

      if (data.socialReach.totalReach > 0) {
        signals.push({
          label: 'Paid social reach',
          change: data.socialReach.changePercentage,
          detail: formatNumber(data.socialReach.totalReach),
        });
      }

      if (data.engagedCommunity.totalMembers > 0) {
        signals.push({
          label: 'Engaged community',
          change: data.engagedCommunity.changePercentage,
          detail: formatNumber(data.engagedCommunity.totalMembers),
        });
      }

      if (data.memberAcquisition.totalMembers > 0) {
        signals.push({
          label: 'Member base',
          change: data.memberAcquisition.changePercentage,
          detail: formatNumber(data.memberAcquisition.totalMembers),
        });
      }

      if (data.flywheelConversion.conversionRate > 0) {
        signals.push({
          label: 'Flywheel conversion',
          change: data.flywheelConversion.changePercentage,
          detail: `${data.flywheelConversion.conversionRate}%`,
        });
      }

      if (data.memberRetention.renewalRate > 0) {
        signals.push({
          label: 'Member retention',
          change: data.memberRetention.changePercentage,
          detail: `${data.memberRetention.renewalRate}%`,
        });
      }

      // Sort by absolute change magnitude — biggest movers first
      const sorted = signals.filter((s) => s.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

      const insights: string[] = [];

      // Top movers — up to 3, biggest changes across all metrics
      for (const signal of sorted.slice(0, 3)) {
        const direction = signal.change > 0 ? 'up' : 'down';
        insights.push(`${signal.label} is ${direction} ${Math.abs(signal.change)}% — now at ${signal.detail}`);
      }

      // If fewer than 2 insights from movers, add a steady-state summary
      if (insights.length < 2 && data.webActivities.totalSessions > 0) {
        insights.push(`${formatNumber(data.webActivities.totalSessions)} website sessions in the last 30 days`);
      }

      return insights;
    });
  }

  // === Private Helpers ===
  private transformWebsiteVisits(card: DashboardMetricCard, data: WebActivitiesSummaryResponse, loading: boolean): DashboardMetricCard {
    return {
      ...card,
      loading,
      value: data.totalSessions > 0 ? formatNumber(data.totalSessions) : undefined,
      subtitle: data.totalSessions > 0 ? `Last 30 days · ${formatNumber(data.totalPageViews)} page views` : undefined,
      chartData:
        data.dailyData.length > 0
          ? {
              labels: data.dailyLabels,
              datasets: [
                {
                  data: data.dailyData,
                  borderColor: lfxColors.blue[500],
                  backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : card.chartData,
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private transformEmailCtr(card: DashboardMetricCard, data: EmailCtrResponse, loading: boolean): DashboardMetricCard {
    return {
      ...card,
      loading,
      value: data.currentCtr > 0 ? `${data.currentCtr.toFixed(1)}%` : undefined,
      subtitle: data.currentCtr > 0 ? 'Last 6 months' : undefined,
      changePercentage: data.changePercentage !== 0 ? `${data.changePercentage}%` : undefined,
      trend: data.trend,
      chartData:
        data.monthlyData.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.monthlyData,
                  borderColor: lfxColors.blue[500],
                  backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : card.chartData,
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private transformSocialReach(card: DashboardMetricCard, data: SocialReachResponse, loading: boolean): DashboardMetricCard {
    return {
      ...card,
      loading,
      value: this.getSocialReachValue(data),
      subtitle: this.getSocialReachSubtitle(data),
      changePercentage: data.changePercentage !== 0 ? `${data.changePercentage > 0 ? '+' : ''}${data.changePercentage}%` : undefined,
      trend: data.trend,
      chartData:
        data.monthlyRoas && data.monthlyRoas.length > 0
          ? {
              labels: data.monthlyLabels,
              datasets: [
                {
                  data: data.monthlyRoas,
                  borderColor: lfxColors.blue[500],
                  backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : card.chartData,
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private transformSocialMedia(card: DashboardMetricCard, data: SocialMediaResponse, loading: boolean): DashboardMetricCard {
    return {
      ...card,
      loading,
      value: data.totalFollowers > 0 ? formatNumber(data.totalFollowers) : undefined,
      subtitle: data.totalFollowers > 0 ? `${data.totalPlatforms} platforms · Last 6 months` : undefined,
      changePercentage: data.changePercentage !== 0 ? `${data.changePercentage > 0 ? '+' : ''}${data.changePercentage}%` : undefined,
      trend: data.trend,
      chartData:
        data.monthlyData.length > 0
          ? {
              labels: data.monthlyData.map((d) => d.month),
              datasets: [
                {
                  data: data.monthlyData.map((d) => d.totalFollowers),
                  borderColor: lfxColors.blue[500],
                  backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 0,
                },
              ],
            }
          : card.chartData,
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private getSocialReachValue(data: SocialReachResponse): string | undefined {
    if (data.roas > 0) return `${data.roas.toFixed(2)}x`;
    if (data.totalReach > 0) return formatNumber(data.totalReach);
    return undefined;
  }

  private getSocialReachSubtitle(data: SocialReachResponse): string | undefined {
    if (data.roas > 0) return 'ROAS · Last 6 months';
    if (data.totalReach > 0) return 'Last 6 months';
    return undefined;
  }
}
