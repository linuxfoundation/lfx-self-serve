// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { lfxColors, ORG_LENS_ROI_DEFAULT_METHOD } from '@lfx-one/shared/constants';
import type { OrgLensRoiAnnual, OrgLensRoiMethod, OrgLensSectionOutcome } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { classifySectionError, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import type { ChartData, ChartOptions } from 'chart.js';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

const EMPTY_ANNUAL: OrgLensRoiAnnual = { method: ORG_LENS_ROI_DEFAULT_METHOD, rows: [], apportioned: false };

@Component({
  selector: 'lfx-org-roi-annual-trend',
  imports: [ChartComponent, OrgLensEmptyStateComponent, SkeletonModule],
  templateUrl: './org-roi-annual-trend.component.html',
})
export class OrgRoiAnnualTrendComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly roiService = inject(OrgLensRoiService);

  public readonly method = input.required<OrgLensRoiMethod>();

  protected readonly loading = signal(true);
  /** How the last request ended (spec 053 FR-014/FR-015); emptiness is judged on the rows in hand, below. */
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  /** Bumped by Retry; part of the request key so the same organization and method re-issue the read. */
  private readonly attempt = signal(0);

  private readonly annual: Signal<OrgLensRoiAnnual> = this.initAnnual();

  protected readonly hasRows: Signal<boolean> = computed(() => this.annual().rows.length > 0);
  protected readonly apportioned: Signal<boolean> = computed(() => this.annual().apportioned);

  protected readonly orgName: Signal<string> = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

  /** The shared state to render instead of the chart, or `null` while there are rows to draw. */
  protected readonly emptyState = computed(() => {
    const outcome = this.loadOutcome();
    return sectionEmptyState(outcome === 'records' && !this.hasRows() ? 'empty' : outcome);
  });

  // Only the calendar year still in progress is partial. An organization whose activity stopped in
  // an earlier year has a complete final year, and labelling it "still accruing" would be wrong.
  protected readonly partialYear: Signal<number | null> = computed(() => {
    const lastYear = this.annual().rows.at(-1)?.year ?? null;
    return lastYear !== null && lastYear === new Date().getFullYear() ? lastYear : null;
  });

  /**
   * Screen-reader equivalent of the canvas. Pre-formatted here rather than in the template so the
   * table and the chart tooltips read the same figures through the same formatter.
   */
  protected readonly tableRows: Signal<{ year: number; investment: string; return: string; isPartial: boolean }[]> = computed(() => {
    const partial = this.partialYear();
    return this.annual().rows.map((row) => ({
      year: row.year,
      investment: formatCurrency(row.expenditure),
      return: formatCurrency(row.totalReturn),
      isPartial: row.year === partial,
    }));
  });

  /** Names what the canvas depicts; the per-year values live in the adjacent table. */
  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    const rows = this.annual().rows;
    if (rows.length === 0) return 'Investment and return by year';
    return `Line chart of investment and return by year, ${rows[0].year} to ${rows[rows.length - 1].year}. The same figures follow in a table.`;
  });

  protected readonly chartData: Signal<ChartData<'line'>> = computed(() => {
    const rows = this.annual().rows;
    return {
      labels: rows.map((row) => `${row.year}`),
      datasets: [
        {
          label: 'Investment',
          data: rows.map((row) => row.expenditure),
          borderColor: lfxColors.blue[500],
          backgroundColor: lfxColors.blue[500],
          fill: false,
        },
        {
          label: 'Return',
          data: rows.map((row) => row.totalReturn),
          borderColor: lfxColors.emerald[500],
          backgroundColor: lfxColors.emerald[500],
          fill: false,
        },
      ],
    };
  });

  protected readonly chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 12, usePointStyle: true, color: lfxColors.gray[600] } },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y as number)}`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, maxRotation: 0 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[400], width: 1, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => formatCurrency(v as number) },
        beginAtZero: true,
      },
    },
    datasets: { line: { tension: 0.4, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4 } },
  };

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private initAnnual(): Signal<OrgLensRoiAnnual> {
    // Keyed by string, not the account object: that object is rewritten in place and would retrigger the fetch.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.method()}|${this.attempt()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgLensRoiMethod, string]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.loadOutcome.set('records');
        }),
        switchMap(([orgUid, method]) =>
          this.roiService.getAnnual(orgUid, method).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load ROI annual trend', error);
              this.loading.set(false);
              this.loadOutcome.set(classifySectionError(error));
              return of(EMPTY_ANNUAL);
            })
          )
        )
      ),
      { initialValue: EMPTY_ANNUAL }
    );
  }
}
