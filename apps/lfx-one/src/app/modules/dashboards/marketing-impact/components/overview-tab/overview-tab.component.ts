// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { FOCUS_TO_CLASSIFICATION } from '@lfx-one/shared/constants';
import { formatChangePct, formatCurrency, formatNumber, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, combineLatest, finalize, forkJoin, of, switchMap } from 'rxjs';

import type { MarketingImpactFocusProgram, OverviewKpiData, PerformanceSummaryKpi } from '@lfx-one/shared/interfaces';

import { AttributionSectionComponent } from '../attribution-section/attribution-section.component';
import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-overview-tab',
  imports: [ButtonComponent, SparklineKpiCardComponent, AttributionSectionComponent],
  templateUrl: './overview-tab.component.html',
})
export class OverviewTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly selectedMonth = input.required<string>();
  public readonly foundationName = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly overviewKpiData: Signal<OverviewKpiData> = this.initOverviewKpiData();
  protected readonly performanceSummaryKpis: Signal<PerformanceSummaryKpi[]> = this.initPerformanceSummaryKpis();
  protected readonly summaryTitle: Signal<string> = this.initSummaryTitle();
  protected readonly summarySubtitle: Signal<string> = this.initSummarySubtitle();

  // === Private Initializers ===
  private initOverviewKpiData(): Signal<OverviewKpiData> {
    const slug$ = toObservable(this.foundationSlug);
    const focus$ = toObservable(this.focusProgram);

    return toSignal(
      combineLatest([slug$, focus$]).pipe(
        switchMap(([slug, focus]) => {
          if (!slug) {
            this.loading.set(false);
            return of({ revenueImpact: null, brandReach: null, emailCtr: null });
          }
          this.loading.set(true);
          const classification = FOCUS_TO_CLASSIFICATION[focus];
          return forkJoin({
            revenueImpact: this.analyticsService.getRevenueImpact(slug, classification).pipe(catchError(() => of(null))),
            brandReach: this.analyticsService.getBrandReach(slug, classification).pipe(catchError(() => of(null))),
            emailCtr: this.analyticsService.getEmailCtr(slug, classification).pipe(catchError(() => of(null))),
          }).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: { revenueImpact: null, brandReach: null, emailCtr: null } }
    );
  }

  private initPerformanceSummaryKpis(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.overviewKpiData();
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
            yoyChange: formatChangePct(yoyPct, 'YoY'),
            yoyTrend: trendDirection(yoyPct),
            yoyTrendClass: trendColorClass(yoyPct),
          },
          {
            id: 'roas',
            label: 'Return on Ad Spend',
            icon: 'fa-light fa-chart-line-up',
            iconClass: 'bg-blue-100 text-blue-600',
            value: `${(ri.paidMedia?.roas ?? 0).toFixed(2)}x`,
            momChange: null,
            momTrend: 'neutral',
            momTrendClass: 'text-gray-500',
            yoyChange: null,
            yoyTrend: 'neutral',
            yoyTrendClass: 'text-gray-500',
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
          momChange: formatChangePct(momPct, 'MoM'),
          momTrend: trendDirection(momPct),
          momTrendClass: trendColorClass(momPct),
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        });
      }

      if (data.emailCtr) {
        const ec = data.emailCtr;
        const momPct = ec.changePercentage;
        cards.push({
          id: 'email-ctr',
          label: 'Email CTR',
          icon: 'fa-light fa-envelope-open',
          iconClass: 'bg-amber-100 text-amber-600',
          value: `${(ec.currentCtr ?? 0).toFixed(2)}%`,
          momChange: formatChangePct(momPct, 'vs avg'),
          momTrend: trendDirection(momPct),
          momTrendClass: trendColorClass(momPct),
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
          badge: momPct != null && momPct < 0 ? 'Needs review' : undefined,
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
      return `Compared to ${momLabel} and ${yoyLabel} · Linear attribution · ${foundation}`;
    });
  }
}
