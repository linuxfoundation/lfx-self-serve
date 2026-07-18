// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { FOCUS_TO_CLASSIFICATION } from '@lfx-one/shared/constants';
import { formatChangePct, formatCurrency, formatNumber, isPeriodMonth, resolvePeriodRange, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
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
  public readonly selectedPeriod = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly isProjectWebsites = computed(() => this.focusProgram() === 'projectWebsites');
  protected readonly overviewKpiData: Signal<OverviewKpiData> = this.initOverviewKpiData();
  protected readonly performanceSummaryKpis: Signal<PerformanceSummaryKpi[]> = this.initPerformanceSummaryKpis();
  protected readonly summaryTitle: Signal<string> = this.initSummaryTitle();
  protected readonly summarySubtitle: Signal<string> = this.initSummarySubtitle();

  // === Private Initializers ===
  private initOverviewKpiData(): Signal<OverviewKpiData> {
    const slug$ = toObservable(this.foundationSlug);
    const focus$ = toObservable(this.focusProgram);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, focus$, period$]).pipe(
        switchMap(([slug, focus, period]) => {
          if (!slug) {
            this.loading.set(false);
            return of({ revenueImpact: null, brandReach: null, emailCtr: null, attribution: null });
          }
          this.loading.set(true);
          const classification = FOCUS_TO_CLASSIFICATION[focus];
          const isWebOnly = focus === 'projectWebsites';
          return forkJoin({
            revenueImpact: isWebOnly
              ? of(null)
              : this.analyticsService.getRevenueImpact(slug, classification, period || undefined).pipe(catchError(() => of(null))),
            // getBrandReach uses pre-computed _30D columns that cannot be period-filtered
            brandReach: this.analyticsService.getBrandReach(slug, classification).pipe(catchError(() => of(null))),
            emailCtr: isWebOnly ? of(null) : this.analyticsService.getEmailCtr(slug, classification, period || undefined).pipe(catchError(() => of(null))),
            // Attributed Revenue KPI reports Linear attribution to match the
            // "Marketing attribution" table below (same source, same model),
            // not pipeline-won CRM revenue which is a different metric.
            // No catchError here: getMarketingAttribution already swallows HTTP
            // errors and emits { channels: [], projects: [] }, which the card
            // renders as a dash — a component-level handler would be unreachable.
            attribution: this.analyticsService.getMarketingAttribution(slug, classification, period || undefined),
          }).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: { revenueImpact: null, brandReach: null, emailCtr: null, attribution: null } }
    );
  }

  private initPerformanceSummaryKpis(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.overviewKpiData();
      const isMonth = isPeriodMonth(this.selectedPeriod());
      const changeSuffix: 'MoM' | 'Period' = isMonth ? 'MoM' : 'Period';
      const cards: PerformanceSummaryKpi[] = [];

      // Attributed Revenue is driven by the attribution response, not revenueImpact.
      // They are fetched independently and revenueImpact is intentionally null for
      // projectWebsites, so guarding this card on revenueImpact would hide it even
      // when attribution data exists. An empty/unavailable channel list renders as a
      // dash — matching the "No attribution data available" state of the table below —
      // rather than a misleading $0.
      if (data.attribution) {
        const channels = data.attribution.channels ?? [];
        // Linear-attributed revenue from the same source as the "Marketing
        // attribution" table, so the headline agrees with that table. The
        // attribution response carries no time dimension, so there is no honest
        // period delta to show here.
        const attributedRevenue = channels.reduce((sum, ch) => sum + (ch.linearRevenue ?? 0), 0);
        cards.push({
          id: 'attributed-revenue',
          label: 'Attributed Revenue',
          icon: 'fa-light fa-dollar-sign',
          iconClass: 'bg-green-100 text-green-600',
          value: channels.length ? formatCurrency(attributedRevenue) : '—',
          momChange: null,
          momTrend: 'neutral',
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        });
      }

      if (data.revenueImpact) {
        const ri = data.revenueImpact;
        cards.push({
          id: 'roas',
          label: 'Return on Ad Spend',
          icon: 'fa-light fa-chart-line-up',
          iconClass: 'bg-blue-100 text-blue-600',
          value: `${(ri.paidMedia?.roas ?? 0).toFixed(2)}x`,
          // No MoM delta: paid spend is lumpy and event-driven, so a
          // month-over-month ROAS swing mostly reflects a change in campaign
          // volume/mix (e.g. fewer campaigns when events wind down), not a
          // change in ad efficiency. Showing it as a performance delta
          // misrepresents a volume shift as a decline.
          momChange: null,
          momTrend: 'neutral',
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral',
          yoyTrendClass: 'text-gray-500',
        });
      }

      if (data.brandReach) {
        const br = data.brandReach;
        // sessionMomChangePct is 0 both for a genuine flat month AND when there is
        // no valid comparison (the server needs >= 8 weeks of trend AND a positive
        // prior-4-week total — it leaves the pct at 0 on a zero prior window to
        // avoid divide-by-zero). Replicate both server conditions so a 0 is only
        // shown when it is a real "0.0% MoM"; otherwise suppress the delta.
        const trend = br.weeklyTrend ?? [];
        const priorWindowSessions = trend.length >= 8 ? trend.slice(-8, -4).reduce((sum, d) => sum + (d.sessions ?? 0), 0) : 0;
        const hasComparison = priorWindowSessions > 0;
        const momPct = hasComparison ? br.sessionMomChangePct : null;
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
        // No sends in scope means CTR is undefined, not 0% — a 0.00% reads as
        // poor performance rather than "no sends", so suppress the value in that
        // case. What "in scope" means depends on the selection: the series is
        // calendar zero-filled, so for a single-month view only the trailing
        // (current) month counts, but for a preset range (last-3, YTD) currentCtr
        // is a period aggregate that is valid if ANY month in the range had sends.
        const sends = ec.monthlySends ?? [];
        const lastSends = sends.length > 0 ? sends[sends.length - 1] : undefined;
        const lastMonthActive = lastSends !== undefined && lastSends > 0;
        const hasSends = isMonth ? lastMonthActive : sends.some((s) => s > 0);
        // The MoM delta only applies to the single-month view: momChangePercentage
        // always compares the trailing two months, so pairing it with a range's
        // period-aggregate value would place a monthly delta beside a period value
        // — the exact metric mismatch this refinement removes. Show it only for a
        // month selection with an active trailing month; suppress it for ranges.
        const momPct = isMonth && lastMonthActive ? ec.momChangePercentage : null;
        cards.push({
          id: 'email-ctr',
          label: 'Email CTR',
          icon: 'fa-light fa-envelope-open',
          iconClass: 'bg-amber-100 text-amber-600',
          value: hasSends ? `${(ec.currentCtr ?? 0).toFixed(2)}%` : '—',
          momChange: formatChangePct(momPct, changeSuffix),
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
      const periodValue = this.selectedPeriod();
      if (!isPeriodMonth(periodValue)) {
        const resolved = resolvePeriodRange(periodValue);
        return resolved ? `${resolved.label} performance summary` : 'Performance summary';
      }
      const [year, month] = periodValue.split('-').map(Number);
      if (!year || !month) return 'Performance summary';
      const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
      return `${monthName} performance summary`;
    });
  }

  private initSummarySubtitle(): Signal<string> {
    return computed(() => {
      const periodValue = this.selectedPeriod();
      if (!isPeriodMonth(periodValue)) {
        const resolved = resolvePeriodRange(periodValue);
        const name = this.foundationName();
        const foundation = name || 'all LF projects';
        return resolved ? `${resolved.label} · Linear attribution · ${foundation}` : '';
      }
      const [year, month] = periodValue.split('-').map(Number);
      if (!year || !month) return '';
      const date = new Date(Date.UTC(year, month - 1, 1));
      const priorMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
      const priorYear = new Date(Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), 1));

      const momLabel = priorMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const yoyLabel = priorYear.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

      const name = this.foundationName();
      const foundation = name || 'all LF projects';
      return `vs. ${momLabel} (MoM) · vs. ${yoyLabel} (YoY) · Linear attribution · ${foundation}`;
    });
  }
}
