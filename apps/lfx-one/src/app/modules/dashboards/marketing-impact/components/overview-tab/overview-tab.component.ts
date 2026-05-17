// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, forkJoin, of, switchMap, tap } from 'rxjs';

import type { AttributionData, BrandReachResponse, EmailCtrResponse, PerformanceSummaryKpi, RevenueImpactResponse } from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-overview-tab',
  imports: [ButtonComponent, SparklineKpiCardComponent],
  templateUrl: './overview-tab.component.html',
})
export class OverviewTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly selectedMonth = input.required<string>();
  public readonly foundationName = input<string>('');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly attributionData: Signal<AttributionData> = this.initAttributionData();
  protected readonly performanceSummaryKpis: Signal<PerformanceSummaryKpi[]> = this.initPerformanceSummaryKpis();
  protected readonly summaryTitle: Signal<string> = this.initSummaryTitle();
  protected readonly summarySubtitle: Signal<string> = this.initSummarySubtitle();

  // === Private Initializers ===
  private initAttributionData(): Signal<AttributionData> {
    const slug$ = toObservable(this.foundationSlug);

    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of({ revenueImpact: null, brandReach: null, emailCtr: null });
          }
          this.loading.set(true);
          return forkJoin({
            revenueImpact: this.analyticsService.getRevenueImpact(slug).pipe(catchError(() => of(null as RevenueImpactResponse | null))),
            brandReach: this.analyticsService.getBrandReach(slug).pipe(catchError(() => of(null as BrandReachResponse | null))),
            emailCtr: this.analyticsService.getEmailCtr(slug).pipe(catchError(() => of(null as EmailCtrResponse | null))),
          }).pipe(tap(() => this.loading.set(false)));
        })
      ),
      { initialValue: { revenueImpact: null, brandReach: null, emailCtr: null } }
    );
  }

  private initPerformanceSummaryKpis(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.attributionData();
      const cards: PerformanceSummaryKpi[] = [];

      if (data.revenueImpact) {
        const ri = data.revenueImpact;
        const yoyPct = ri.changePercentage;
        cards.push(
          {
            id: 'attributed-revenue',
            label: 'Attributed Revenue',
            icon: 'fa-light fa-dollar-sign',
            iconClass: 'bg-green-100 text-green-600',
            value: formatCurrency(ri.revenueAttributed),
            momChange: null,
            momTrend: 'neutral',
            momTrendClass: 'text-gray-500',
            yoyChange: this.formatChangePct(yoyPct, 'YoY'),
            yoyTrend: this.trendDirection(yoyPct),
            yoyTrendClass: this.trendColorClass(yoyPct),
            comparisonLine: '',
          },
          {
            id: 'roas',
            label: 'Return on Ad Spend',
            icon: 'fa-light fa-chart-line-up',
            iconClass: 'bg-blue-100 text-blue-600',
            value: `${ri.paidMedia.roas.toFixed(2)}x`,
            momChange: null,
            momTrend: 'neutral',
            momTrendClass: 'text-gray-500',
            yoyChange: null,
            yoyTrend: 'neutral',
            yoyTrendClass: 'text-gray-500',
            comparisonLine: '',
          }
        );
      }

      if (data.brandReach) {
        const br = data.brandReach;
        const momPct = br.sessionMomChangePct;
        cards.push({
          id: 'web-sessions',
          label: 'Total Web Sessions',
          icon: 'fa-light fa-globe',
          iconClass: 'bg-violet-100 text-violet-600',
          value: formatNumber(br.totalMonthlySessions),
          momChange: this.formatChangePct(momPct, 'MoM'),
          momTrend: this.trendDirection(momPct),
          momTrendClass: this.trendColorClass(momPct),
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        });
      }

      if (data.emailCtr) {
        const ec = data.emailCtr;
        const momPct = ec.changePercentage;
        cards.push({
          id: 'email-open-rate',
          label: 'Email Open Rate',
          icon: 'fa-light fa-envelope-open',
          iconClass: 'bg-amber-100 text-amber-600',
          value: `${ec.currentCtr.toFixed(2)}%`,
          momChange: this.formatChangePct(momPct, 'MoM'),
          momTrend: this.trendDirection(momPct),
          momTrendClass: this.trendColorClass(momPct),
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
          badge: momPct < 0 ? 'Needs review' : undefined,
        });
      }

      return cards;
    });
  }

  private initSummaryTitle(): Signal<string> {
    return computed(() => {
      const monthValue = this.selectedMonth();
      const [year, month] = monthValue.split('-').map(Number);
      if (!year || !month) return 'Performance summary';
      const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
      return `${monthName} performance summary`;
    });
  }

  private initSummarySubtitle(): Signal<string> {
    return computed(() => {
      const monthValue = this.selectedMonth();
      const [year, month] = monthValue.split('-').map(Number);
      if (!year || !month) return '';
      const date = new Date(Date.UTC(year, month - 1, 1));
      const priorMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
      const priorYear = new Date(Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), 1));

      const momLabel = priorMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const yoyLabel = priorYear.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

      const name = this.foundationName();
      const foundation = name ? name : 'all LF projects';
      return `vs ${momLabel} (MoM) and ${yoyLabel} (YoY) · Linear attribution · ${foundation}`;
    });
  }

  // === Private Helpers ===
  private trendDirection(pct: number): 'up' | 'down' | 'neutral' {
    if (pct > 0) return 'up';
    if (pct < 0) return 'down';
    return 'neutral';
  }

  private trendColorClass(pct: number): string {
    if (pct > 0) return 'text-green-600';
    if (pct < 0) return 'text-red-600';
    return 'text-gray-500';
  }

  private formatChangePct(pct: number, suffix: string): string {
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}% ${suffix}`;
  }
}
