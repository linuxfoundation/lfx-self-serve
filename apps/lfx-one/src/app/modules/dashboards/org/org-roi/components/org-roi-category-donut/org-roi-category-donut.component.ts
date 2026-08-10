// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import {
  lfxColors,
  ORG_LENS_ROI_CATEGORY_REMAINDER_THRESHOLD,
  ORG_LENS_ROI_DONUT_PALETTE,
  ORG_LENS_ROI_DONUT_REMAINDER_COLOR,
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_NO_VALUE,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiCategoryRow, OrgLensRoiCategorySlice, OrgLensRoiInvestmentBreakdown } from '@lfx-one/shared/interfaces';
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import type { ChartData, ChartOptions } from 'chart.js';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

const EMPTY_BREAKDOWN: OrgLensRoiInvestmentBreakdown = { rows: [], total: 0 };

/** Investment by contribution category (US3, FR-023 to FR-026). */
@Component({
  selector: 'lfx-org-roi-category-donut',
  imports: [ChartComponent, SkeletonModule],
  templateUrl: './org-roi-category-donut.component.html',
})
export class OrgRoiCategoryDonutComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly roiService = inject(OrgLensRoiService);

  /**
   * FR-039a. The same string the KPI band shows, not a paraphrase of it — the two surfaces state
   * the same disclosure, so they cannot drift apart when either is edited (DR-015).
   */
  protected readonly investmentExplanation = ORG_LENS_ROI_KPI_EXPLANATION.totalExpenditure;

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly forbidden = signal(false);

  /** FR-024 — currency or share of total. Presentation only; the underlying values never change. */
  protected readonly asShare = signal(false);

  private readonly breakdown: Signal<OrgLensRoiInvestmentBreakdown> = this.initBreakdown();

  protected readonly total: Signal<number> = computed(() => this.breakdown().total);

  /**
   * Gate on the slices, not on the row count. An organization can have category rows that sum to
   * zero investment, and there is nothing to draw from those — keying the template off row count
   * alone rendered a blank canvas beside an empty legend instead of saying so.
   */
  protected readonly hasSlices: Signal<boolean> = computed(() => this.slices().length > 0);

  /**
   * The reconciliation anchor (FR-026, SC-011). It is the sum of exactly the rows drawn below, and
   * the warehouse already guarantees it equals the KPI investment figure — a dbt singular test
   * asserts it per account. Nothing here rescales to force the two to agree: if they ever differ,
   * that is a defect to raise, not a discrepancy to paper over (FR-011b).
   */
  protected readonly totalLabel: Signal<string> = computed(() => {
    const total = this.total();
    return Number.isFinite(total) ? formatCurrency(total) : ORG_LENS_ROI_NO_VALUE;
  });

  /**
   * FR-025 — categories under the display threshold collapse into one labelled remainder, so a
   * $1,190 education line does not render as an invisible sliver with an unreachable legend entry.
   */
  protected readonly slices: Signal<OrgLensRoiCategorySlice[]> = computed(() => {
    const { rows, total } = this.breakdown();
    if (rows.length === 0 || !(total > 0)) return [];

    const kept: OrgLensRoiCategorySlice[] = [];
    const collapsed: OrgLensRoiCategoryRow[] = [];

    for (const row of rows) {
      const share = row.expenditure / total;
      if (share < ORG_LENS_ROI_CATEGORY_REMAINDER_THRESHOLD) {
        collapsed.push(row);
        continue;
      }
      kept.push({
        key: row.type,
        label: row.label,
        expenditure: row.expenditure,
        share,
        color: ORG_LENS_ROI_DONUT_PALETTE[kept.length % ORG_LENS_ROI_DONUT_PALETTE.length],
      });
    }

    if (collapsed.length === 0) return kept;

    // A remainder standing for a single category is strictly worse than the category itself: it
    // hides a real name behind "Other (1 category)" and saves no space.
    if (collapsed.length === 1) {
      const only = collapsed[0];
      return [
        ...kept,
        {
          key: only.type,
          label: only.label,
          expenditure: only.expenditure,
          share: only.expenditure / total,
          color: ORG_LENS_ROI_DONUT_REMAINDER_COLOR,
        },
      ];
    }

    const collapsedTotal = collapsed.reduce((sum, row) => sum + row.expenditure, 0);
    return [
      ...kept,
      {
        key: 'remainder',
        label: `Other (${collapsed.length} categories)`,
        expenditure: collapsedTotal,
        share: collapsedTotal / total,
        color: ORG_LENS_ROI_DONUT_REMAINDER_COLOR,
      },
    ];
  });

  /**
   * The legend is rendered as real text beside the canvas rather than mirrored into an `sr-only`
   * table as the annual trend does. Both satisfy "a canvas cannot be the only presentation of its
   * data"; a visible list is the better fit here because there are at most nine categories, and
   * because FR-024's currency/share toggle needs somewhere visible to take effect — switching only
   * the tooltips would leave the choice invisible until the viewer hovered a slice.
   *
   * Pre-formatted so the legend and the tooltip cannot disagree.
   */
  protected readonly legendRows: Signal<{ key: string; label: string; amount: string; share: string; display: string; color: string }[]> = computed(() => {
    const asShare = this.asShare();
    return this.slices().map((slice) => {
      const amount = formatCurrency(slice.expenditure);
      const share = `${formatPercent(slice.share * 100)}%`;
      return { key: slice.key, label: slice.label, amount, share, display: asShare ? share : amount, color: slice.color };
    });
  });

  /**
   * Counts the underlying categories, not the slices. A remainder slice stands for several, so
   * announcing the slice count told a screen-reader user "6 categories" for an organization with
   * eight — a number no sighted user is shown to contradict.
   */
  protected readonly chartSummaryLabel: Signal<string> = computed(
    () => `Doughnut chart of modelled investment across ${this.breakdown().rows.length} contribution categories. The same figures are listed beside it.`
  );

  protected readonly chartData: Signal<ChartData<'doughnut'>> = computed(() => {
    const slices = this.slices();
    return {
      labels: slices.map((slice) => slice.label),
      datasets: [
        {
          data: slices.map((slice) => slice.expenditure),
          backgroundColor: slices.map((slice) => slice.color),
          borderColor: lfxColors.gray[50],
          borderWidth: 2,
        },
      ],
    };
  });

  protected readonly chartOptions: Signal<ChartOptions<'doughnut'>> = computed(() => {
    const asShare = this.asShare();
    const total = this.total();
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        // The adjacent list is the legend; the canvas one would only repeat it.
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          titleColor: lfxColors.gray[900],
          bodyColor: lfxColors.gray[600],
          borderColor: lfxColors.gray[200],
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (ctx) => {
              const value = ctx.parsed;
              if (!asShare) return ` ${ctx.label}: ${formatCurrency(value)}`;
              return ` ${ctx.label}: ${formatPercent(total > 0 ? (value / total) * 100 : 0)}%`;
            },
          },
        },
      },
    };
  });

  public toggleShare(asShare: boolean): void {
    this.asShare.set(asShare);
  }

  private initBreakdown(): Signal<OrgLensRoiInvestmentBreakdown> {
    // Keyed by the account id alone: category investment carries no estimation method, so a method
    // change is not a reason to refetch this surface.
    const accountId$ = toObservable(computed(() => this.accountContext.selectedAccount()?.accountId ?? ''));

    return toSignal(
      accountId$.pipe(
        filter((orgUid) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
        }),
        switchMap((orgUid) =>
          this.roiService.getInvestmentBreakdown(orgUid).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load ROI investment breakdown', error);
              this.loading.set(false);
              // Only a 403 may show the no-access message; a 503 must not.
              if ((error as { status?: number })?.status === 403) this.forbidden.set(true);
              else this.failed.set(true);
              return of(EMPTY_BREAKDOWN);
            })
          )
        )
      ),
      { initialValue: EMPTY_BREAKDOWN }
    );
  }
}
