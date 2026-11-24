// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import {
  lfxColors,
  ORG_LENS_ROI_ANNUAL_APPORTIONMENT_NOTE,
  ORG_LENS_ROI_ANNUAL_SERIES_LABELS,
  ORG_LENS_ROI_ANNUAL_SERIES_MODE_LABELS,
  ORG_LENS_ROI_ANNUAL_SERIES_MODES,
  ORG_LENS_ROI_DEFAULT_METHOD,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiAnnual, OrgLensRoiAnnualRow, OrgLensRoiAnnualSeriesMode, OrgLensRoiMethod, OrgLensSectionOutcome } from '@lfx-one/shared/interfaces';
import { cumulativeAnnualRows, formatCurrency } from '@lfx-one/shared/utils';
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

  protected readonly seriesModes = ORG_LENS_ROI_ANNUAL_SERIES_MODES;
  protected readonly seriesModeLabels = ORG_LENS_ROI_ANNUAL_SERIES_MODE_LABELS;

  protected readonly loading = signal(true);
  /** How the last request ended (spec 053 FR-014/FR-015); emptiness is judged on the rows in hand, below. */
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  /** Bumped by Retry; part of the request key so the same organization and method re-issue the read. */
  private readonly attempt = signal(0);

  /** Each year on its own, or as a running total. Presentation only; the request never varies by it. */
  protected readonly seriesMode = signal<OrgLensRoiAnnualSeriesMode>('yearly');

  private readonly annual: Signal<OrgLensRoiAnnual> = this.initAnnual();

  /** What the canvas and the table both draw: the rows as the selected mode states them. */
  private readonly seriesRows: Signal<OrgLensRoiAnnualRow[]> = this.initSeriesRows();

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
    return this.seriesRows().map((row) => ({
      year: row.year,
      investment: formatCurrency(row.expenditure),
      return: formatCurrency(row.totalReturn),
      isPartial: row.year === partial,
    }));
  });

  /**
   * The table's caption carries the mode on its own. Its column headers deliberately do not: the
   * caption plus the canvas legend already say which reading this is, and the headers are the
   * stable handles the tests and a screen reader's table navigation key off.
   */
  protected readonly tableCaption: Signal<string> = computed(() =>
    this.seriesMode() === 'cumulative' ? 'Cumulative investment and return by year' : 'Investment and return by year'
  );

  /** Both modes owe the disclosure; only its trailing clause can be stated the same way. */
  protected readonly apportionmentNote: Signal<string> = computed(() => ORG_LENS_ROI_ANNUAL_APPORTIONMENT_NOTE[this.seriesMode()]);

  /** Names what the canvas depicts; the values themselves live in the adjacent table. */
  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    const rows = this.seriesRows();
    if (rows.length === 0) return 'Investment and return by year';
    const span = `${rows[0].year} to ${rows[rows.length - 1].year}`;
    if (this.seriesMode() === 'cumulative') {
      return `Line chart of cumulative investment and return by year, ${span}, each point the running total through that year. The same figures follow in a table.`;
    }
    return `Line chart of investment and return by year, ${span}. The same figures follow in a table.`;
  });

  protected readonly chartData: Signal<ChartData<'line'>> = computed(() => {
    const rows = this.seriesRows();
    // The dataset names carry the mode into the legend and, through `ctx.dataset.label`, into every
    // tooltip — which is why `chartOptions` below needs no mode of its own.
    const labels = ORG_LENS_ROI_ANNUAL_SERIES_LABELS[this.seriesMode()];
    // A running total only ever rises, but Chart.js derives its default cubic control points in
    // PIXEL space from both neighbours, so a small step followed by a large one pulls the curve
    // under the earlier total: [100, 101, 300] on a 600x250 plot dips to ~84 between the first two
    // points, drawing a fall that cannot happen. 'monotone' holds the spline to the data's own
    // direction. It ignores `tension`, so this is scoped to the cumulative reading and year over
    // year keeps the existing smoothing.
    const cubicInterpolationMode = this.seriesMode() === 'cumulative' ? 'monotone' : 'default';
    return {
      labels: rows.map((row) => `${row.year}`),
      datasets: [
        {
          label: labels.investment,
          data: rows.map((row) => row.expenditure),
          borderColor: lfxColors.blue[500],
          backgroundColor: lfxColors.blue[500],
          fill: false,
          cubicInterpolationMode,
        },
        {
          label: labels.return,
          data: rows.map((row) => row.totalReturn),
          borderColor: lfxColors.emerald[500],
          backgroundColor: lfxColors.emerald[500],
          fill: false,
          cubicInterpolationMode,
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

  public setSeriesMode(mode: OrgLensRoiAnnualSeriesMode): void {
    this.seriesMode.set(mode);
  }

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private initSeriesRows(): Signal<OrgLensRoiAnnualRow[]> {
    return computed(() => {
      const rows = this.annual().rows;
      // Passed through untouched year over year: the server already orders ascending, and there the
      // order only labels the x axis. Cumulatively it decides the values, so the util sorts.
      return this.seriesMode() === 'cumulative' ? cumulativeAnnualRows(rows) : rows;
    });
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
