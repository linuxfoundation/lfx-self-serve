// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MONTH_NAMES } from '@lfx-one/shared/constants';
import { formatChangePct, formatNumber, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import type {
  MarketingImpactFocusProgram,
  PerformanceSummaryKpi,
  SocialAccountRow,
  SocialMediaMonthlyResponse,
  SocialMediaResponse,
  SocialMonthlyPlatform,
  SocialMonthlyRow,
} from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-social-accounts-tab',
  imports: [SparklineKpiCardComponent, NgClass],
  templateUrl: './social-accounts-tab.component.html',
  styleUrl: './social-accounts-tab.component.scss',
})
export class SocialAccountsTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly selectedPeriod = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly monthlyLoading = signal(false);
  protected readonly expandedPlatforms = signal<Set<string>>(new Set());
  protected readonly selectedYear = signal(new Date().getUTCFullYear());

  // === Computed Signals ===
  protected readonly socialData: Signal<SocialMediaResponse | null> = this.initSocialData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly platformRows: Signal<SocialAccountRow[]> = this.initPlatformRows();
  protected readonly hasPlatforms = computed(() => this.platformRows().length > 0);
  protected readonly monthlyData: Signal<SocialMediaMonthlyResponse | null> = this.initMonthlyData();
  protected readonly monthlyPlatforms: Signal<SocialMonthlyPlatform[]> = this.initMonthlyPlatforms();
  protected readonly hasMonthlyData = computed(() => this.monthlyPlatforms().length > 0);
  protected readonly availableYears = computed(() => {
    const current = new Date().getUTCFullYear();
    return [current, current - 1];
  });

  // === Protected Methods ===
  protected togglePlatform(platform: string): void {
    const current = this.expandedPlatforms();
    const next = new Set(current);
    if (next.has(platform)) {
      next.delete(platform);
    } else {
      next.add(platform);
    }
    this.expandedPlatforms.set(next);
  }

  protected onYearChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const parsed = parseInt(target.value, 10);
    if (Number.isFinite(parsed) && this.availableYears().includes(parsed)) {
      this.selectedYear.set(parsed);
    }
  }

  // === Private Initializers ===
  private initSocialData(): Signal<SocialMediaResponse | null> {
    const slug$ = toObservable(this.foundationSlug);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, period$]).pipe(
        switchMap(([slug, period]) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.analyticsService.getSocialMedia(slug, period || undefined).pipe(
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

  private initMonthlyData(): Signal<SocialMediaMonthlyResponse | null> {
    const slug$ = toObservable(this.foundationSlug);
    const year$ = toObservable(this.selectedYear);

    return toSignal(
      combineLatest([slug$, year$]).pipe(
        switchMap(([slug, year]) => {
          if (!slug) {
            this.monthlyLoading.set(false);
            return of(null);
          }
          this.monthlyLoading.set(true);
          return this.analyticsService.getSocialMediaMonthly(slug, year).pipe(
            finalize(() => this.monthlyLoading.set(false)),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initMonthlyPlatforms(): Signal<SocialMonthlyPlatform[]> {
    return computed(() => {
      const data = this.monthlyData();
      if (!data?.platforms?.length) return [];

      const expanded = this.expandedPlatforms();

      return data.platforms.map((p) => {
        const rowsByMonth = new Map(p.months.map((m) => [m.month, m]));
        const latestRow = p.months.length > 0 ? p.months.reduce((latest, row) => (row.month > latest.month ? row : latest)) : null;

        const allMonths: SocialMonthlyRow[] = MONTH_NAMES.map((name, i) => {
          const monthStr = `${data.year}-${String(i + 1).padStart(2, '0')}`;
          const row = rowsByMonth.get(monthStr);
          if (!row) {
            return {
              month: name,
              impressions: '—',
              engagementRate: '—',
              followers: '—',
              newFollowers: '—',
              momChange: '—',
              momChangeClass: 'text-gray-400',
            };
          }
          return {
            month: name,
            impressions: formatNumber(row.impressions),
            engagementRate: `${row.engagementRate.toFixed(2)}%`,
            followers: formatNumber(row.followers),
            newFollowers: formatNumber(row.newFollowers),
            momChange: this.formatMomChange(row.momChangeFollowers),
            momChangeClass: this.getMomChangeClass(row.momChangeFollowers),
          };
        });

        return {
          platform: p.platform,
          expanded: expanded.has(p.platform),
          latestFollowers: latestRow ? formatNumber(latestRow.followers) : '—',
          latestMomChange: latestRow ? this.formatMomChange(latestRow.momChangeFollowers) : '—',
          latestMomChangeClass: latestRow ? this.getMomChangeClass(latestRow.momChangeFollowers) : 'text-gray-400',
          months: allMonths,
        };
      });
    });
  }

  private formatMomChange(value: number | null): string {
    if (value === null) return '—';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  private getMomChangeClass(value: number | null): string {
    if (value === null) return 'text-gray-400';
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-500';
  }
}
