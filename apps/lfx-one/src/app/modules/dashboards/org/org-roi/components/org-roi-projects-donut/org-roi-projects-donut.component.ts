// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import {
  lfxColors,
  ORG_LENS_ROI_DEFAULT_METHOD,
  ORG_LENS_ROI_DONUT_PALETTE,
  ORG_LENS_ROI_DONUT_REMAINDER_COLOR,
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_PROJECT_DONUT_COVERAGE,
  ORG_LENS_ROI_PROJECT_DONUT_MAX_SLICES,
  ORG_LENS_ROI_PROJECT_MEASURE_LABELS,
  ORG_LENS_ROI_PROJECT_MEASURES,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod, OrgLensRoiProjectMeasure, OrgLensRoiProjectRow, OrgLensRoiProjects } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import type { ChartData, ChartOptions } from 'chart.js';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

const EMPTY_PROJECTS: OrgLensRoiProjects = { method: ORG_LENS_ROI_DEFAULT_METHOD, rows: [] };

interface ProjectSlice {
  key: string;
  label: string;
  /** The true signed measure. Negative for a loss-making project on the Net Return tab. */
  value: number;
  /** What the arc is sized by — never negative, because an arc cannot be. */
  weight: number;
  color: string;
}

/** Highest-contributing projects by a selectable measure (US4, FR-027, FR-028). */
@Component({
  selector: 'lfx-org-roi-projects-donut',
  imports: [ChartComponent, SkeletonModule],
  templateUrl: './org-roi-projects-donut.component.html',
})
export class OrgRoiProjectsDonutComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly roiService = inject(OrgLensRoiService);

  public readonly method = input.required<OrgLensRoiMethod>();

  protected readonly measures = ORG_LENS_ROI_PROJECT_MEASURES;
  protected readonly measureLabels = ORG_LENS_ROI_PROJECT_MEASURE_LABELS;

  /** FR-039a — the same wording the KPI band uses, shown only where an investment figure is (DR-015). */
  protected readonly investmentExplanation = ORG_LENS_ROI_KPI_EXPLANATION.totalExpenditure;

  protected readonly measure = signal<OrgLensRoiProjectMeasure>('investment');

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly forbidden = signal(false);

  private readonly projects: Signal<OrgLensRoiProjects> = this.initProjects();

  protected readonly hasRows: Signal<boolean> = computed(() => this.projects().rows.length > 0);

  protected readonly showsInvestment: Signal<boolean> = computed(() => this.measure() === 'investment');

  protected readonly measureLabel: Signal<string> = computed(() => this.measureLabels[this.measure()]);

  /** Ranked by the selected measure, signed values intact. */
  private readonly ranked: Signal<{ row: OrgLensRoiProjectRow; value: number }[]> = computed(() => {
    const measure = this.measure();
    return this.projects()
      .rows.map((row) => ({ row, value: this.measureValue(row, measure) }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((a, b) => b.value - a.value || a.row.projectId.localeCompare(b.row.projectId));
  });

  /**
   * Net return is negative for 6.45% of project rows across 775 organizations — a mainline path,
   * not an edge case. A doughnut arc cannot be negative, so the geometry is clamped at zero while
   * the label keeps the true signed figure (FR-028). The projects concerned are named explicitly
   * below rather than silently vanishing into a zero-width arc.
   */
  protected readonly negatives: Signal<{ count: number; total: number; rows: { key: string; label: string; amount: string }[] }> = computed(() => {
    const losing = this.ranked().filter((entry) => entry.value < 0);
    return {
      count: losing.length,
      total: losing.reduce((sum, entry) => sum + entry.value, 0),
      // Each carries its own signed figure; a count alone would not satisfy FR-028.
      rows: losing.map((entry) => ({ key: entry.row.projectId, label: entry.row.projectName, amount: formatCurrency(entry.value) })),
    };
  });

  protected readonly negativeSummary: Signal<string> = computed(() => {
    const { count, total } = this.negatives();
    const subject = count === 1 ? '1 project has' : `${count.toLocaleString('en-US')} projects have`;
    return `${subject} a negative net return, totalling ${formatCurrency(total)}. A negative value cannot be drawn as a slice, so it is excluded from the chart and listed here instead.`;
  });

  /**
   * FR-027 — slices cover the leading share of the measure and everything else collapses into one
   * remainder labelled with its project count. The cap is a second stop condition: a flat portfolio
   * would otherwise reach the coverage target only after hundreds of unreadable slivers.
   */
  protected readonly slices: Signal<ProjectSlice[]> = computed(() => {
    const ranked = this.ranked();
    const totalWeight = ranked.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
    if (ranked.length === 0 || !(totalWeight > 0)) return [];

    const kept: ProjectSlice[] = [];
    let covered = 0;
    let index = 0;

    while (index < ranked.length && kept.length < ORG_LENS_ROI_PROJECT_DONUT_MAX_SLICES && covered < ORG_LENS_ROI_PROJECT_DONUT_COVERAGE) {
      const entry = ranked[index];
      const weight = Math.max(0, entry.value);
      // A non-positive value contributes no arc; stop rather than emit invisible slices.
      if (weight <= 0) break;
      kept.push({
        key: entry.row.projectId,
        label: entry.row.projectName,
        value: entry.value,
        weight,
        color: ORG_LENS_ROI_DONUT_PALETTE[kept.length % ORG_LENS_ROI_DONUT_PALETTE.length],
      });
      covered += weight / totalWeight;
      index += 1;
    }

    const rest = ranked.slice(index);
    if (rest.length === 0) return kept;

    const restValue = rest.reduce((sum, entry) => sum + entry.value, 0);
    const restWeight = rest.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
    return [
      ...kept,
      {
        key: 'remainder',
        label: rest.length === 1 ? 'Other (1 project)' : `Other (${rest.length.toLocaleString('en-US')} projects)`,
        value: restValue,
        weight: restWeight,
        color: ORG_LENS_ROI_DONUT_REMAINDER_COLOR,
      },
    ];
  });

  /**
   * The accessible equivalent of the canvas and its legend, in real text beside it. Each entry
   * carries the **signed** value, so a remainder that nets out negative reads as such rather than
   * as the clamped magnitude its arc was drawn from (FR-028).
   */
  protected readonly legendRows: Signal<{ key: string; label: string; amount: string; color: string }[]> = computed(() =>
    this.slices().map((slice) => ({ key: slice.key, label: slice.label, amount: formatCurrency(slice.value), color: slice.color }))
  );

  protected readonly chartSummaryLabel: Signal<string> = computed(
    () => `Doughnut chart of the leading projects by ${this.measureLabels[this.measure()].toLowerCase()}. The same figures are listed beside it.`
  );

  protected readonly chartData: Signal<ChartData<'doughnut'>> = computed(() => {
    const slices = this.slices();
    return {
      labels: slices.map((slice) => slice.label),
      datasets: [
        {
          // Clamped weights, not the signed values — see `negatives` for how those are reported.
          data: slices.map((slice) => slice.weight),
          backgroundColor: slices.map((slice) => slice.color),
          borderColor: lfxColors.gray[50],
          borderWidth: 2,
        },
      ],
    };
  });

  protected readonly chartOptions: Signal<ChartOptions<'doughnut'>> = computed(() => {
    const slices = this.slices();
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
            // The tooltip reports the signed value, not the clamped weight the arc was drawn from.
            label: (ctx) => ` ${ctx.label}: ${formatCurrency(slices[ctx.dataIndex]?.value ?? 0)}`,
          },
        },
      },
    };
  });

  public setMeasure(measure: OrgLensRoiProjectMeasure): void {
    this.measure.set(measure);
  }

  /** Never re-derived: profit is defined once in the metric layer and carried through (FR-007). */
  private measureValue(row: OrgLensRoiProjectRow, measure: OrgLensRoiProjectMeasure): number {
    if (measure === 'investment') return row.totalExpenditure;
    if (measure === 'return') return row.totalReturn;
    return row.profit;
  }

  private initProjects(): Signal<OrgLensRoiProjects> {
    // Keyed by string, not the account object: that object is rewritten in place and would retrigger the fetch.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.method()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgLensRoiMethod]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
        }),
        switchMap(([orgUid, method]) =>
          this.roiService.getProjects(orgUid, method).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load ROI projects', error);
              this.loading.set(false);
              // Only a 403 may show the no-access message; a 503 must not.
              if ((error as { status?: number })?.status === 403) this.forbidden.set(true);
              else this.failed.set(true);
              return of(EMPTY_PROJECTS);
            })
          )
        )
      ),
      { initialValue: EMPTY_PROJECTS }
    );
  }
}
