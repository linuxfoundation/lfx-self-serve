// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { createHorizontalBarChartOptions, createLineChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import { formatNumber, hexToRgba, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type { ChartData, ChartOptions } from 'chart.js';
import type { SocialMediaResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-social-media-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, SkeletonModule, TableComponent, TagComponent, MarketingActionIconPipe],
  templateUrl: './social-media-drawer.component.html',
  styleUrl: './social-media-drawer.component.scss',
})
export class SocialMediaDrawerComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);

  // === Icon Mapping (frontend concern — maps platform names to FontAwesome classes) ===
  private readonly platformIconMap: Record<string, string> = {
    Twitter: 'fa-brands fa-x-twitter',
    'Twitter/X': 'fa-brands fa-x-twitter',
    X: 'fa-brands fa-x-twitter',
    LinkedIn: 'fa-brands fa-linkedin',
    YouTube: 'fa-brands fa-youtube',
    Mastodon: 'fa-brands fa-mastodon',
    Bluesky: 'fa-brands fa-bluesky',
    Facebook: 'fa-brands fa-facebook',
    Instagram: 'fa-brands fa-instagram',
  };

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals (lazy-loaded data) ===
  protected readonly drawerData: Signal<SocialMediaResponse> = this.initDrawerData();
  protected readonly formattedTotalFollowers: Signal<string> = computed(() => formatNumber(this.drawerData().totalFollowers));
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly followerTrendChartData: Signal<ChartData<'line'>> = this.initFollowerTrendChartData();
  protected readonly platformChartData: Signal<ChartData<'bar'>> = this.initPlatformChartData();

  protected readonly followerTrendChartOptions: ChartOptions<'line'> = createLineChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y ?? 0;
            return ` ${formatNumber(val)} followers`;
          },
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (num >= 999_950) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
  });

  protected readonly platformChartOptions: ChartOptions<'bar'> = createHorizontalBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.x ?? 0;
            return ` ${formatNumber(val)} followers`;
          },
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (num >= 999_950) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[600], font: { size: 12 } },
      },
    },
  });

  protected readonly formatNumber = formatNumber;

  // === Protected Methods ===
  protected getIconClass(platformName: string): string {
    return this.platformIconMap[platformName] || 'fa-light fa-globe';
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<SocialMediaResponse> {
    const defaultValue: SocialMediaResponse = {
      totalFollowers: 0,
      totalPlatforms: 0,
      changePercentage: 0,
      trend: 'up',
      platforms: [],
      monthlyData: [],
    };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || ''));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.drawerLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getSocialMedia(foundationSlug).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load social media details.',
              });
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { platforms, changePercentage, totalFollowers } = this.drawerData();
      const actions: MarketingRecommendedAction[] = [];

      if (platforms.length === 0 && totalFollowers === 0) {
        return actions;
      }

      // Find platform with high engagement but low posting
      const highEngageLowPost = [...platforms]
        .filter((p) => p.engagementRate > 0 && p.postsLast30Days > 0)
        .sort((a, b) => b.engagementRate - a.engagementRate)
        .find((p) => {
          const avgPosts = platforms.reduce((s, pl) => s + pl.postsLast30Days, 0) / platforms.length;
          return p.postsLast30Days < avgPosts * 0.7;
        });

      if (highEngageLowPost) {
        actions.push({
          title: `Increase posting on ${highEngageLowPost.platform}`,
          description: `${highEngageLowPost.engagementRate.toFixed(1)}% engagement rate but only ${highEngageLowPost.postsLast30Days} posts in 30 days`,
          priority: 'high',

          actionType: 'content',
        });
      }

      if (changePercentage < -5) {
        actions.push({
          title: 'Address follower decline',
          description: `Followers dropped ${Math.abs(changePercentage)}% — review content strategy and posting cadence`,
          priority: 'high',

          actionType: 'decline',
        });
      }

      // Find low-engagement platform with many followers
      if (platforms.length > 1) {
        const sorted = [...platforms].sort((a, b) => a.engagementRate - b.engagementRate);
        const lowest = sorted[0];
        if (lowest.engagementRate > 0 && lowest.followers > totalFollowers * 0.2) {
          actions.push({
            title: `Boost engagement on ${lowest.platform}`,
            description: `${formatNumber(lowest.followers)} followers but only ${lowest.engagementRate.toFixed(1)}% engagement — try interactive content`,
            priority: 'medium',

            actionType: 'engagement',
          });
        }
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Continue growth strategy',
          description: `${formatNumber(totalFollowers)} followers across ${platforms.length} platforms${changePercentage > 0 ? ` — growing ${changePercentage}%` : ''}`,
          priority: 'low',

          actionType: 'growth',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { totalFollowers, changePercentage, platforms, monthlyData } = this.drawerData();
      const insights: MarketingKeyInsight[] = [];

      if (totalFollowers === 0 && platforms.length === 0) {
        return insights;
      }

      // Follower trend
      if (changePercentage > 5) {
        insights.push({ text: `Followers grew ${changePercentage}% month-over-month`, type: 'driver' });
      } else if (changePercentage < -5) {
        insights.push({ text: `Followers declined ${Math.abs(changePercentage)}% month-over-month`, type: 'warning' });
      } else if (changePercentage !== 0) {
        insights.push({ text: `Followers ${changePercentage > 0 ? 'up' : 'down'} ${Math.abs(changePercentage)}% — relatively stable`, type: 'info' });
      }

      // Best engagement platform
      if (platforms.length > 0) {
        const byEngagement = [...platforms].filter((p) => p.engagementRate > 0).sort((a, b) => b.engagementRate - a.engagementRate);
        if (byEngagement.length > 0) {
          insights.push({ text: `${byEngagement[0].platform} leads engagement at ${byEngagement[0].engagementRate.toFixed(1)}%`, type: 'driver' });
        }
      }

      // Platform concentration
      if (platforms.length > 1 && totalFollowers > 0) {
        const sorted = [...platforms].sort((a, b) => b.followers - a.followers);
        const topShare = (sorted[0].followers / totalFollowers) * 100;
        if (topShare > 70) {
          insights.push({ text: `${topShare.toFixed(0)}% of followers on ${sorted[0].platform} — audience concentration risk`, type: 'warning' });
        } else {
          insights.push({ text: `Audience spread across ${platforms.length} platforms — healthy diversification`, type: 'info' });
        }
      }

      // Monthly trend
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].totalFollowers < recent3[1].totalFollowers && recent3[1].totalFollowers < recent3[2].totalFollowers;
        const isShrinking = recent3[0].totalFollowers > recent3[1].totalFollowers && recent3[1].totalFollowers > recent3[2].totalFollowers;
        if (isGrowing) {
          insights.push({ text: 'Follower count growing for 3 consecutive months', type: 'driver' });
        } else if (isShrinking) {
          insights.push({ text: 'Follower count declining for 3 consecutive months', type: 'warning' });
        }
      }

      return insights;
    });
  }

  private initFollowerTrendChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { monthlyData } = this.drawerData();
      return {
        labels: monthlyData.map((d) => d.month),
        datasets: [
          {
            data: monthlyData.map((d) => d.totalFollowers),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: lfxColors.blue[500],
          },
        ],
      };
    });
  }

  private initPlatformChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { platforms } = this.drawerData();
      const sorted = [...platforms].sort((a, b) => b.followers - a.followers);
      return {
        labels: sorted.map((p) => p.platform),
        datasets: [
          {
            data: sorted.map((p) => p.followers),
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[400], lfxColors.blue[300], lfxColors.blue[200]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
