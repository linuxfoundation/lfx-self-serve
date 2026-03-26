// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, signal, Signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { MARKETING_OVERVIEW_METRICS, NO_TOOLTIP_CHART_OPTIONS } from '@lfx-one/shared/constants';
import { lfxColors } from '@lfx-one/shared/constants';
import {
  DashboardDrawerType,
  DashboardMetricCard,
  EmailCtrResponse,
  SocialMediaResponse,
  SocialReachResponse,
  WebActivitiesSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { catchError, combineLatest, filter, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { EmailCtrDrawerComponent } from '../email-ctr-drawer/email-ctr-drawer.component';
import { PaidSocialReachDrawerComponent } from '../paid-social-reach-drawer/paid-social-reach-drawer.component';
import { SocialMediaDrawerComponent } from '../social-media-drawer/social-media-drawer.component';
import { WebsiteVisitsDrawerComponent } from '../website-visits-drawer/website-visits-drawer.component';

@Component({
  selector: 'lfx-marketing-overview',
  imports: [
    MetricCardComponent,
    ScrollShadowDirective,
    WebsiteVisitsDrawerComponent,
    EmailCtrDrawerComponent,
    PaidSocialReachDrawerComponent,
    SocialMediaDrawerComponent,
  ],
  templateUrl: './marketing-overview.component.html',
  styleUrl: './marketing-overview.component.scss',
})
export class MarketingOverviewComponent {
  @ViewChild(ScrollShadowDirective) public scrollShadowDirective!: ScrollShadowDirective;

  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  // === WritableSignals ===
  private readonly marketingDataLoading = signal(true);
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
  }> = this.initMarketingData();
  protected readonly marketingCards: Signal<DashboardMetricCard[]> = this.initMarketingCards();

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
        if (card.title === 'Website Visits') {
          return this.transformWebsiteVisits(card, webActivities, loading);
        }
        if (card.title === 'Email CTR') {
          return this.transformEmailCtr(card, emailCtr, loading);
        }
        if (card.title === 'Paid Social Reach') {
          return this.transformSocialReach(card, socialReach, loading);
        }
        if (card.title === 'Social Media') {
          return this.transformSocialMedia(card, socialMedia, loading);
        }
        return card;
      });
    });
  }

  private initMarketingData(): Signal<{
    webActivities: WebActivitiesSummaryResponse;
    emailCtr: EmailCtrResponse;
    socialReach: SocialReachResponse;
    socialMedia: SocialMediaResponse;
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

    const defaultValue = {
      webActivities: defaultWebActivities,
      emailCtr: defaultEmailCtr,
      socialReach: defaultSocialReach,
      socialMedia: defaultSocialMedia,
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
            webActivities: this.analyticsService.getWebActivitiesSummary(foundation.slug),
            emailCtr: this.analyticsService.getEmailCtr(foundation.name),
            socialReach: this.analyticsService.getSocialReach(foundation.name),
            socialMedia: this.analyticsService.getSocialMedia(foundation.name),
          }).pipe(
            tap(() => this.marketingDataLoading.set(false)),
            catchError(() => {
              this.marketingDataLoading.set(false);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initMarketingInsights(): Signal<string[]> {
    return computed(() => {
      const { webActivities, emailCtr } = this.marketingData();
      const loading = this.marketingDataLoading();
      const insights: string[] = [];

      if (loading) {
        return insights;
      }

      // Email CTR insight
      if (emailCtr.currentCtr > 0) {
        if (emailCtr.changePercentage < 0) {
          insights.push(`Email CTR declined ${Math.abs(emailCtr.changePercentage)}% to ${emailCtr.currentCtr.toFixed(1)}% — review newsletter engagement`);
        } else if (emailCtr.changePercentage > 0) {
          insights.push(`Email CTR grew ${emailCtr.changePercentage}% to ${emailCtr.currentCtr.toFixed(1)}% — content strategy is working`);
        } else {
          insights.push(`Email CTR steady at ${emailCtr.currentCtr.toFixed(1)}%`);
        }
      }

      // Website visits insight
      if (webActivities.totalSessions > 0) {
        const pagesPerSession = webActivities.totalPageViews / webActivities.totalSessions;
        insights.push(`${this.formatNumber(webActivities.totalSessions)} website sessions with ${pagesPerSession.toFixed(1)} pages per visit`);
      }

      // Domain concentration insight
      if (webActivities.domainGroups.length > 1 && webActivities.totalSessions > 0) {
        const sorted = [...webActivities.domainGroups].sort((a, b) => b.totalSessions - a.totalSessions);
        const topDomain = sorted[0];
        const topShare = (topDomain.totalSessions / webActivities.totalSessions) * 100;
        insights.push(`${topDomain.domainGroup} drives ${topShare.toFixed(0)}% of web traffic`);
      }

      return insights;
    });
  }

  // === Private Helpers ===
  private transformWebsiteVisits(card: DashboardMetricCard, data: WebActivitiesSummaryResponse, loading: boolean): DashboardMetricCard {
    return {
      ...card,
      loading,
      value: data.totalSessions > 0 ? this.formatNumber(data.totalSessions) : undefined,
      subtitle: data.totalSessions > 0 ? `Last 30 days · ${this.formatNumber(data.totalPageViews)} page views` : undefined,
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
      value: data.totalFollowers > 0 ? this.formatNumber(data.totalFollowers) : undefined,
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
    if (data.totalReach > 0) return this.formatNumber(data.totalReach);
    return undefined;
  }

  private getSocialReachSubtitle(data: SocialReachResponse): string | undefined {
    if (data.roas > 0) return 'ROAS · Last 6 months';
    if (data.totalReach > 0) return 'Last 6 months';
    return undefined;
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  }
}
