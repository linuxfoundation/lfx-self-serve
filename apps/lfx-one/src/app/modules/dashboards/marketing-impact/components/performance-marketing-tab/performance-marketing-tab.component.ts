// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FOCUS_TO_CLASSIFICATION } from '@lfx-one/shared/constants';
import { computeMomPct, formatChangePct, formatCurrency, formatNumber, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import type {
  KeywordPerformanceResponse,
  KeywordRow,
  MarketingImpactFocusProgram,
  PaidCampaignPerformance,
  PaidCampaignRow,
  PaidProjectPerformance,
  PaidProjectRow,
  PerformanceSummaryKpi,
  PlatformCampaignRow,
  PlatformPerformanceRow,
  SearchTermRow,
  SocialReachResponse,
} from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-performance-marketing-tab',
  imports: [SparklineKpiCardComponent],
  templateUrl: './performance-marketing-tab.component.html',
  styleUrl: './performance-marketing-tab.component.scss',
})
export class PerformanceMarketingTabComponent {
  private static readonly performanceClassMap: Record<PaidProjectPerformance, string> = {
    EXCELLENT: 'bg-emerald-50 text-emerald-700',
    GOOD: 'bg-blue-50 text-blue-700',
    AVERAGE: 'bg-gray-100 text-gray-600',
    EMERGING: 'bg-gray-100 text-gray-500',
  };

  private static readonly performanceOrderMap: Record<PaidProjectPerformance, number> = {
    EXCELLENT: 0,
    GOOD: 1,
    AVERAGE: 2,
    EMERGING: 3,
  };

  private static readonly validPerformance = new Set<PaidProjectPerformance>(['EXCELLENT', 'GOOD', 'AVERAGE', 'EMERGING']);

  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly selectedPeriod = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly keywordLoading = signal(false);
  protected readonly expandedProjects = signal<Set<string>>(new Set());
  protected readonly expandedPlatforms = signal<Set<string>>(new Set());
  protected readonly expandedKeywords = signal<Set<string>>(new Set());

  // === Computed Signals ===
  protected readonly socialReachData: Signal<SocialReachResponse | null> = this.initSocialReachData();
  protected readonly keywordData: Signal<KeywordPerformanceResponse | null> = this.initKeywordData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly projectRows: Signal<PaidProjectRow[]> = this.initProjectRows();
  protected readonly platformRows: Signal<PlatformPerformanceRow[]> = this.initPlatformRows();
  protected readonly platformTotals: Signal<PlatformPerformanceRow | null> = this.initPlatformTotals();
  protected readonly keywordRows: Signal<KeywordRow[]> = this.initKeywordRows();
  protected readonly hasProjects = computed(() => this.projectRows().length > 0);
  protected readonly hasPlatforms = computed(() => this.platformRows().length > 0);
  protected readonly hasKeywords = computed(() => this.keywordRows().length > 0);

  // === Protected Methods ===
  protected toggleProjectExpand(projectKey: string): void {
    this.expandedProjects.update((current) => {
      const next = new Set(current);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
      return next;
    });
  }

  protected togglePlatformExpand(platform: string): void {
    this.expandedPlatforms.update((current) => {
      const next = new Set(current);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }

  protected toggleKeywordExpand(keyword: string): void {
    this.expandedKeywords.update((current) => {
      const next = new Set(current);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });
  }

  // === Private Initializers ===
  private initSocialReachData(): Signal<SocialReachResponse | null> {
    const slug$ = toObservable(this.foundationSlug);
    const focus$ = toObservable(this.focusProgram);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, focus$, period$]).pipe(
        switchMap(([slug, focus, period]) => {
          this.expandedProjects.set(new Set());
          this.expandedPlatforms.set(new Set());
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          const classification = FOCUS_TO_CLASSIFICATION[focus];
          return this.analyticsService.getSocialReach(slug, classification, period || undefined).pipe(
            catchError(() => of(null)),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initKpiCards(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.socialReachData();
      if (!data) return [];

      const completedMonths = data.monthlyData?.slice(0, -1);
      const impressionsMomPct = computeMomPct(completedMonths);

      const cards: PerformanceSummaryKpi[] = [
        {
          id: 'total-impressions',
          label: 'Total Impressions',
          icon: 'fa-light fa-eye',
          iconClass: 'bg-blue-100 text-blue-600',
          value: formatNumber(data.totalReach),
          momChange: formatChangePct(impressionsMomPct, 'MoM'),
          momTrend: trendDirection(impressionsMomPct),
          momTrendClass: trendColorClass(impressionsMomPct),
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        },
        {
          id: 'total-spend',
          label: 'Total Spend',
          icon: 'fa-light fa-wallet',
          iconClass: 'bg-amber-100 text-amber-600',
          value: formatCurrency(data.totalSpend),
          momChange: null,
          momTrend: 'neutral',
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        },
        {
          id: 'total-revenue',
          label: 'Total Revenue',
          icon: 'fa-light fa-dollar-sign',
          iconClass: 'bg-green-100 text-green-600',
          value: formatCurrency(data.totalRevenue),
          momChange: null,
          momTrend: 'neutral',
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        },
        {
          id: 'roas',
          label: 'ROAS',
          icon: 'fa-light fa-chart-line-up',
          iconClass: 'bg-violet-100 text-violet-600',
          value: `${(data.roas ?? 0).toFixed(2)}x`,
          // No MoM delta: paid spend is lumpy and event-driven, so a
          // month-over-month ROAS swing mostly reflects a change in campaign
          // volume/mix, not a change in ad efficiency.
          momChange: null,
          momTrend: 'neutral',
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        },
      ];

      return cards;
    });
  }

  private initProjectRows(): Signal<PaidProjectRow[]> {
    return computed(() => {
      const data = this.socialReachData();
      if (!data?.projectBreakdown?.length) return [];

      return data.projectBreakdown
        .map((p): PaidProjectRow => {
          const perf = this.normalizePerformance(p.performance);
          return {
            name: p.projectName,
            funnelStage: p.funnelStage,
            spend: formatCurrency(p.spend),
            revenue: formatCurrency(p.revenue),
            roas: `${(p.roas ?? 0).toFixed(2)}x`,
            impressions: formatNumber(p.impressions),
            performance: perf,
            performanceClass: this.getPerformanceClass(perf),
            campaigns: this.mapCampaignRows(p.campaigns),
          };
        })
        .sort((a, b) => {
          return (
            (PerformanceMarketingTabComponent.performanceOrderMap[a.performance] ?? 4) -
            (PerformanceMarketingTabComponent.performanceOrderMap[b.performance] ?? 4)
          );
        });
    });
  }

  private initPlatformRows(): Signal<PlatformPerformanceRow[]> {
    return computed(() => {
      const data = this.socialReachData();
      if (!data?.platformBreakdown?.length) return [];

      return data.platformBreakdown.map((p): PlatformPerformanceRow => {
        const perf = this.normalizePerformance(p.performance);
        return {
          platform: p.platform,
          spend: formatCurrency(p.spend),
          revenue: formatCurrency(p.revenue),
          roas: `${(p.roas ?? 0).toFixed(2)}x`,
          clicks: formatNumber(p.clicks),
          impressions: formatNumber(p.impressions),
          ctr: `${(p.ctr ?? 0).toFixed(2)}%`,
          cpc: formatCurrency(p.cpc),
          convRate: `${(p.convRate ?? 0).toFixed(2)}%`,
          conversions: formatNumber(p.conversions),
          performance: perf,
          performanceClass: this.getPerformanceClass(perf),
          campaigns: this.mapPlatformCampaignRows(p.campaigns),
        };
      });
    });
  }

  private initPlatformTotals(): Signal<PlatformPerformanceRow | null> {
    return computed(() => {
      const data = this.socialReachData();
      if (!data?.platformBreakdown?.length) return null;

      const totals = data.platformBreakdown.reduce(
        (acc, p) => ({
          spend: acc.spend + (p.spend ?? 0),
          revenue: acc.revenue + (p.revenue ?? 0),
          clicks: acc.clicks + (p.clicks ?? 0),
          impressions: acc.impressions + (p.impressions ?? 0),
          conversions: acc.conversions + (p.conversions ?? 0),
        }),
        { spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0 }
      );

      const totalRoasRaw = totals.spend > 0 ? totals.revenue / totals.spend : 0;
      const totalRoas = Math.round(totalRoasRaw * 100) / 100;
      const totalCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
      const totalCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
      const totalConvRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;

      const totalPerf = this.getRoasPerformance(totalRoas);
      return {
        platform: 'TOTAL',
        spend: formatCurrency(totals.spend),
        revenue: formatCurrency(totals.revenue),
        roas: `${totalRoas.toFixed(2)}x`,
        clicks: formatNumber(totals.clicks),
        impressions: formatNumber(totals.impressions),
        ctr: `${totalCtr.toFixed(2)}%`,
        cpc: formatCurrency(totalCpc),
        convRate: `${totalConvRate.toFixed(2)}%`,
        conversions: formatNumber(totals.conversions),
        performance: totalPerf,
        performanceClass: this.getPerformanceClass(totalPerf),
        campaigns: [],
      };
    });
  }

  private initKeywordData(): Signal<KeywordPerformanceResponse | null> {
    const slug$ = toObservable(this.foundationSlug);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, period$]).pipe(
        switchMap(([slug, period]) => {
          this.expandedKeywords.set(new Set());
          if (!slug) {
            this.keywordLoading.set(false);
            return of(null);
          }
          this.keywordLoading.set(true);
          return this.analyticsService.getKeywordPerformance(slug, period || undefined).pipe(
            catchError(() => of(null)),
            finalize(() => this.keywordLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initKeywordRows(): Signal<KeywordRow[]> {
    return computed(() => {
      const data = this.keywordData();
      if (!data?.keywords?.length) return [];

      return data.keywords.map(
        (k): KeywordRow => ({
          keyword: k.keyword,
          matchType: k.matchType,
          clicks: formatNumber(k.clicks),
          spend: formatCurrency(k.spend),
          impressions: formatNumber(k.impressions),
          ctr: `${(k.ctr ?? 0).toFixed(2)}%`,
          cpc: formatCurrency(k.cpc),
          conversions: formatNumber(k.conversions),
          convRate: `${(k.conversionRate ?? 0).toFixed(2)}%`,
          revenue: formatCurrency(k.attributedRevenue),
          roas: `${(k.roas ?? 0).toFixed(2)}x`,
          searchTerms: (k.searchTerms ?? []).map(
            (st): SearchTermRow => ({
              searchTerm: st.searchTerm,
              matchType: st.matchType,
              clicks: formatNumber(st.clicks),
              spend: formatCurrency(st.spend),
              impressions: formatNumber(st.impressions),
              ctr: `${(st.ctr ?? 0).toFixed(2)}%`,
              cpc: formatCurrency(st.cpc),
              conversions: formatNumber(st.conversions),
            })
          ),
        })
      );
    });
  }

  // === Private Helpers ===
  private normalizePerformance(value: string | null | undefined): PaidProjectPerformance {
    const upper = (value ?? '').toUpperCase().trim();
    if (PerformanceMarketingTabComponent.validPerformance.has(upper as PaidProjectPerformance)) {
      return upper as PaidProjectPerformance;
    }
    return 'EMERGING';
  }

  private getPerformanceClass(perf: PaidProjectPerformance): string {
    return PerformanceMarketingTabComponent.performanceClassMap[perf] ?? 'bg-gray-50 text-gray-700';
  }

  private mapCampaignRows(campaigns: PaidCampaignPerformance[] | undefined): PaidCampaignRow[] {
    if (!campaigns?.length) return [];
    return campaigns.map(
      (c): PaidCampaignRow => ({
        campaignName: c.campaignName,
        funnelStage: c.funnelStage,
        spend: formatCurrency(c.spend),
        revenue: formatCurrency(c.revenue),
        roas: `${(c.roas ?? 0).toFixed(2)}x`,
        impressions: formatNumber(c.impressions),
      })
    );
  }

  private mapPlatformCampaignRows(campaigns: PaidCampaignPerformance[] | undefined): PlatformCampaignRow[] {
    if (!campaigns?.length) return [];
    return campaigns.map(
      (c): PlatformCampaignRow => ({
        campaignName: c.campaignName,
        spend: formatCurrency(c.spend),
        revenue: formatCurrency(c.revenue),
        roas: `${(c.roas ?? 0).toFixed(2)}x`,
        clicks: formatNumber(c.clicks),
        impressions: formatNumber(c.impressions),
      })
    );
  }

  private getRoasPerformance(roas: number): PaidProjectPerformance {
    if (roas >= 2) return 'EXCELLENT';
    if (roas >= 1) return 'GOOD';
    if (roas > 0) return 'AVERAGE';
    return 'EMERGING';
  }
}
