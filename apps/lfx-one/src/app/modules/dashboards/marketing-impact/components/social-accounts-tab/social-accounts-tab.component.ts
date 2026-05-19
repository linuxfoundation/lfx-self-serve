// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatChangePct, formatNumber, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, finalize, of, switchMap } from 'rxjs';

import type { PerformanceSummaryKpi, SocialAccountRow, SocialMediaResponse } from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-social-accounts-tab',
  imports: [SparklineKpiCardComponent],
  templateUrl: './social-accounts-tab.component.html',
  styleUrl: './social-accounts-tab.component.scss',
})
export class SocialAccountsTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly socialData: Signal<SocialMediaResponse | null> = this.initSocialData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly platformRows: Signal<SocialAccountRow[]> = this.initPlatformRows();
  protected readonly hasPlatforms = computed(() => this.platformRows().length > 0);

  // === Private Initializers ===
  private initSocialData(): Signal<SocialMediaResponse | null> {
    const slug$ = toObservable(this.foundationSlug);

    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.analyticsService.getSocialMedia(slug).pipe(
            finalize(() => this.loading.set(false)),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initKpiCards(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.socialData();
      if (!data) return [];

      const totalImpressions = data.platforms.reduce((sum, p) => sum + p.impressions, 0);
      const totalPosts = data.platforms.reduce((sum, p) => sum + p.postsLast30Days, 0);
      const avgEngagement = totalImpressions > 0 ? data.platforms.reduce((sum, p) => sum + p.engagementRate * p.impressions, 0) / totalImpressions : 0;
      const changePct = data.changePercentage;

      return [
        {
          id: 'total-followers',
          label: 'Total Followers',
          icon: 'fa-light fa-users',
          iconClass: 'bg-blue-100 text-blue-600',
          value: formatNumber(data.totalFollowers),
          momChange: formatChangePct(changePct, 'MoM'),
          momTrend: trendDirection(changePct),
          momTrendClass: trendColorClass(changePct),
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'total-impressions',
          label: 'Impressions',
          icon: 'fa-light fa-eye',
          iconClass: 'bg-green-100 text-green-600',
          value: formatNumber(totalImpressions),
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'engagement-rate',
          label: 'Engagement Rate',
          icon: 'fa-light fa-heart',
          iconClass: 'bg-amber-100 text-amber-600',
          value: `${avgEngagement.toFixed(2)}%`,
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'posts-published',
          label: 'Posts Published',
          icon: 'fa-light fa-pen-to-square',
          iconClass: 'bg-violet-100 text-violet-600',
          value: formatNumber(totalPosts),
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
      ];
    });
  }

  private initPlatformRows(): Signal<SocialAccountRow[]> {
    return computed(() => {
      const data = this.socialData();
      if (!data?.platforms?.length) return [];

      return [...data.platforms]
        .sort((a, b) => b.followers - a.followers)
        .map(
          (p): SocialAccountRow => ({
            platform: p.platform,
            followers: formatNumber(p.followers),
            impressions: formatNumber(p.impressions),
            engagementRate: `${p.engagementRate.toFixed(2)}%`,
            posts: formatNumber(p.postsLast30Days),
          })
        );
    });
  }
}
