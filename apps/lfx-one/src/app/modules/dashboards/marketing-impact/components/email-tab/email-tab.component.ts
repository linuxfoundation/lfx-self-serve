// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { computeMomPct, formatChangePct, formatNumber, formatPercent, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { FOCUS_TO_CLASSIFICATION } from '@lfx-one/shared/constants';
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

  // === Computed Signals ===
  protected readonly emailData: Signal<EmailCtrResponse | null> = this.initEmailData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly emailTypeRows: Signal<EmailTypeRow[]> = this.initEmailTypeRows();
  protected readonly hasEmailTypes = computed(() => this.emailTypeRows().length > 0);
  protected readonly topCampaigns: Signal<TopCampaignRow[]> = this.initTopCampaigns();
  protected readonly hasTopCampaigns = computed(() => this.topCampaigns().length > 0);
  protected readonly topCampaignsCountLabel = computed(() => {
    const count = this.topCampaigns().length;
    return `${formatNumber(count)} ${count === 1 ? 'send' : 'sends'}`;
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
          const classification = FOCUS_TO_CLASSIFICATION[focus];
          return this.analyticsService.getEmailCtr(slug, classification, period || undefined).pipe(
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
          value: `${formatPercent(data.currentCtr ?? 0)}%`,
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
          openRate: `${et.openRate.toFixed(1)}%`,
          ctr: `${formatPercent(et.ctr)}%`,
        })
      );
    });
  }

  private initTopCampaigns(): Signal<TopCampaignRow[]> {
    return computed(() => {
      const data = this.emailData();
      if (!data?.emailTypeBreakdown?.length) return [];

      // Every send in the selected period, newest first — deliberately uncapped so the table is a
      // complete listing rather than a top-N. Undated rows sort last so they can't head the table.
      const allCampaigns = data.emailTypeBreakdown.flatMap((et) => et.campaigns ?? []);
      return allCampaigns
        .sort((a, b) => {
          if (a.sendDate !== b.sendDate) {
            if (!a.sendDate) return 1;
            if (!b.sendDate) return -1;
            return b.sendDate.localeCompare(a.sendDate);
          }
          return b.sends - a.sends;
        })
        .map(
          (c): TopCampaignRow => ({
            name: c.campaignName,
            type: c.emailType,
            sendDate: c.sendDate ? this.formatSendDate(c.sendDate) : '—',
            sends: formatNumber(c.sends),
            opens: formatNumber(c.opens),
            openRate: `${c.openRate.toFixed(1)}%`,
            ctr: `${formatPercent(c.ctr)}%`,
          })
        );
    });
  }

  /** Formats a YYYY-MM-DD send date as "Jul 14, 2026", parsing parts explicitly to avoid TZ drift. */
  private formatSendDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
}
