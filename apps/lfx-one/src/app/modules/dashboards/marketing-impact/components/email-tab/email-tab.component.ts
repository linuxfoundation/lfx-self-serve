// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { computeMomPct, formatChangePct, formatIsoDateLabel, formatNumber, formatPercent, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { EMAIL_SENDS_ROW_LIMIT, FOCUS_TO_CLASSIFICATION } from '@lfx-one/shared/constants';
import { catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import type { EmailCtrResponse, EmailTypeRow, MarketingImpactFocusProgram, PerformanceSummaryKpi, TopCampaignRow } from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-email-tab',
  imports: [SparklineKpiCardComponent],
  templateUrl: './email-tab.component.html',
  styleUrl: './email-tab.component.scss',
})
export class EmailTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly selectedPeriod = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');

  // === WritableSignals ===
  protected readonly loading = signal(false);
  /** True when the request failed, so the tab can say so instead of rendering zeros. */
  protected readonly failed = signal(false);

  // === Computed Signals ===
  protected readonly emailData: Signal<EmailCtrResponse | null> = this.initEmailData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly emailTypeRows: Signal<EmailTypeRow[]> = this.initEmailTypeRows();
  protected readonly hasEmailTypes = computed(() => this.emailTypeRows().length > 0);
  protected readonly topCampaigns: Signal<TopCampaignRow[]> = this.initTopCampaigns();
  protected readonly hasTopCampaigns = computed(() => this.topCampaigns().length > 0);
  /**
   * How many sends the response carried, before the render cap. Compared against the cap rather
   * than against the rendered length: the rendered list can never exceed the cap, so a source of
   * exactly EMAIL_SENDS_ROW_LIMIT would otherwise be labelled "latest N" despite being complete.
   */
  private readonly sendSourceCount = computed(() => this.emailData()?.emailTypeBreakdown?.flatMap((et) => et.campaigns ?? []).length ?? 0);
  /** True only when rows were actually omitted, so the header claims truncation only when it happened. */
  protected readonly topCampaignsTruncated = computed(() => this.sendSourceCount() > EMAIL_SENDS_ROW_LIMIT);
  protected readonly topCampaignsCountLabel = computed(() => {
    const count = this.topCampaigns().length;
    const noun = count === 1 ? 'send' : 'sends';
    return this.topCampaignsTruncated() ? `latest ${formatNumber(count)} ${noun}` : `${formatNumber(count)} ${noun}`;
  });

  // === Private Initializers ===
  private initEmailData(): Signal<EmailCtrResponse | null> {
    const slug$ = toObservable(this.foundationSlug);
    const focus$ = toObservable(this.focusProgram);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, focus$, period$]).pipe(
        switchMap(([slug, focus, period]) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          this.failed.set(false);
          const classification = FOCUS_TO_CLASSIFICATION[focus];
          // Caught here rather than in the service: a failure must render "couldn't load" rather
          // than the zero-filled KPIs it used to resolve, which read as measurements.
          return this.analyticsService.getEmailCtr(slug, classification, period || undefined).pipe(
            finalize(() => this.loading.set(false)),
            catchError(() => {
              this.failed.set(true);
              return of(null);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initKpiCards(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.emailData();
      if (!data) return [];

      const totalSends = data.monthlySends?.reduce((s, v) => s + v, 0) ?? 0;
      const totalOpens = data.monthlyOpens?.reduce((s, v) => s + v, 0) ?? 0;
      const changePct = data.momChangePercentage;

      const sends = data.monthlySends ?? [];
      const opens = data.monthlyOpens ?? [];
      const minLen = Math.min(sends.length, opens.length);
      const lastSends = minLen > 0 ? sends[minLen - 1] : undefined;
      const prevSends = minLen > 1 ? sends[minLen - 2] : undefined;
      const lastOpens = minLen > 0 ? (opens[minLen - 1] ?? 0) : 0;
      const prevOpens = minLen > 1 ? (opens[minLen - 2] ?? 0) : 0;

      // The series are calendar zero-filled, so a trailing no-send month
      // would read as a -100% MoM on sends/opens — a send gap, not a decline.
      // MoM claims require the latest month to have actual sends.
      const lastMonthActive = lastSends !== undefined && lastSends > 0;
      const sendsMom = lastMonthActive ? computeMomPct(data.monthlySends) : null;
      const opensMom = lastMonthActive ? computeMomPct(data.monthlyOpens) : null;

      // Open rate is undefined without sends — the series is calendar
      // zero-filled, so a no-send month must suppress the value and the MoM
      // delta rather than read as a measured 0% (a false -100% decline).
      const currentOpenRate = lastSends !== undefined && lastSends > 0 ? (lastOpens / lastSends) * 100 : null;
      const prevOpenRate = prevSends !== undefined && prevSends > 0 ? (prevOpens / prevSends) * 100 : null;
      const openRateMom =
        currentOpenRate !== null && prevOpenRate !== null && prevOpenRate > 0 ? ((currentOpenRate - prevOpenRate) / prevOpenRate) * 100 : null;

      return [
        {
          id: 'total-sends',
          label: 'Total Sends',
          icon: 'fa-light fa-paper-plane',
          iconClass: 'bg-blue-100 text-blue-600',
          value: formatNumber(totalSends),
          momChange: formatChangePct(sendsMom, 'MoM'),
          momTrend: trendDirection(sendsMom),
          momTrendClass: trendColorClass(sendsMom),
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'total-opens',
          label: 'Total Opens',
          icon: 'fa-light fa-envelope-open',
          iconClass: 'bg-green-100 text-green-600',
          value: formatNumber(totalOpens),
          momChange: formatChangePct(opensMom, 'MoM'),
          momTrend: trendDirection(opensMom),
          momTrendClass: trendColorClass(opensMom),
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'open-rate',
          label: 'Open Rate',
          icon: 'fa-light fa-chart-simple',
          iconClass: 'bg-amber-100 text-amber-600',
          value: currentOpenRate !== null ? `${currentOpenRate.toFixed(1)}%` : '—',
          momChange: formatChangePct(openRateMom, 'MoM'),
          momTrend: trendDirection(openRateMom),
          momTrendClass: trendColorClass(openRateMom),
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'ctr',
          label: 'Click-Through Rate',
          icon: 'fa-light fa-arrow-pointer',
          iconClass: 'bg-violet-100 text-violet-600',
          value: `${formatPercent(data.currentCtr ?? 0, 2)}%`,
          momChange: formatChangePct(changePct, 'MoM'),
          momTrend: trendDirection(changePct),
          momTrendClass: trendColorClass(changePct),
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
      ];
    });
  }

  private initEmailTypeRows(): Signal<EmailTypeRow[]> {
    return computed(() => {
      const data = this.emailData();
      if (!data?.emailTypeBreakdown?.length) return [];

      return data.emailTypeBreakdown.map(
        (et): EmailTypeRow => ({
          emailType: et.emailType,
          campaignCount: et.campaignCount,
          sends: formatNumber(et.totalSends),
          opens: formatNumber(et.totalOpens),
          openRate: `${formatPercent(et.openRate)}%`,
          ctr: `${formatPercent(et.ctr, 2)}%`,
        })
      );
    });
  }

  private initTopCampaigns(): Signal<TopCampaignRow[]> {
    return computed(() => {
      const data = this.emailData();
      if (!data?.emailTypeBreakdown?.length) return [];

      // Sends in the selected period, newest first, capped at EMAIL_SENDS_ROW_LIMIT — the query
      // behind this is unbounded, so an uncapped list builds every row during SSR and hydration.
      // The cap is a render bound, not a ranking: the header says "latest N sends" when it bites.
      // Undated rows sort last so they can't head the table.
      const allCampaigns = data.emailTypeBreakdown.flatMap((et) => et.campaigns ?? []);
      return allCampaigns
        .sort((a, b) => {
          if (a.sendDate !== b.sendDate) {
            if (!a.sendDate) return 1;
            if (!b.sendDate) return -1;
            // Codepoint comparison, not localeCompare: these are opaque YYYY-MM-DD identifiers,
            // and a locale-sensitive collation could order them differently on the server than in
            // the browser — which would make the SSR-rendered list reshuffle on hydration.
            if (b.sendDate < a.sendDate) return -1;
            if (b.sendDate > a.sendDate) return 1;
            return 0;
          }
          return b.sends - a.sends;
        })
        .slice(0, EMAIL_SENDS_ROW_LIMIT)
        .map(
          (c): TopCampaignRow => ({
            name: c.campaignName,
            type: c.emailType,
            sendDate: c.sendDate ? formatIsoDateLabel(c.sendDate) : '—',
            sends: formatNumber(c.sends),
            opens: formatNumber(c.opens),
            openRate: `${formatPercent(c.openRate)}%`,
            ctr: `${formatPercent(c.ctr, 2)}%`,
          })
        );
    });
  }
}
