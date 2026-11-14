// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ChartComponent } from '@components/chart/chart.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import {
  lfxColors,
  ORG_LENS_ROI_CATEGORY_COLOR,
  ORG_LENS_ROI_CONTRIBUTION_TYPES,
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_PROJECT_BAR_MAX_ROWS,
  ORG_LENS_ROI_RETURN_COLOR,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiProjectBarRow, OrgLensRoiProjectBarSegment, OrgLensRoiProjectRow } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import type { ChartData, ChartOptions } from 'chart.js';
import { map } from 'rxjs';

/** Each project's investment, stacked by contribution category, against the return it is associated with. */
@Component({
  selector: 'lfx-org-roi-projects-bar',
  imports: [ChartComponent, CheckboxComponent],
  templateUrl: './org-roi-projects-bar.component.html',
})
export class OrgRoiProjectsBarComponent {
  /** The selected projects, in the order the picker ranked them. */
  public readonly projects = input.required<OrgLensRoiProjectRow[]>();

  /** Which series are drawn. Both start on; whichever is left on alone is disabled, so the chart is never empty. */
  protected readonly seriesForm = new FormGroup({
    investment: new FormControl(true, { nonNullable: true }),
    return: new FormControl(true, { nonNullable: true }),
  });

  /** The same wording the KPI band uses. This chart stacks investment, so it owes the disclosure. */
  protected readonly investmentExplanation = ORG_LENS_ROI_KPI_EXPLANATION.totalExpenditure;

  protected readonly maxRows = ORG_LENS_ROI_PROJECT_BAR_MAX_ROWS;

  protected readonly hasProjects: Signal<boolean> = computed(() => this.projects().length > 0);

  /** Everything past the ceiling is dropped from the drawing and disclosed, never silently. */
  protected readonly hiddenCount: Signal<number> = computed(() => Math.max(0, this.projects().length - this.maxRows));

  // Raw value, so a series still counts as shown while its checkbox is disabled.
  private readonly series = toSignal(this.seriesForm.valueChanges.pipe(map(() => this.seriesForm.getRawValue())), {
    initialValue: this.seriesForm.getRawValue(),
  });
  protected readonly showInvestment: Signal<boolean> = computed(() => this.series().investment);
  protected readonly showReturn: Signal<boolean> = computed(() => this.series().return);

  protected readonly rows: Signal<OrgLensRoiProjectBarRow[]> = computed(() =>
    this.projects()
      .slice(0, this.maxRows)
      .map((project) => ({
        projectId: project.projectId,
        projectName: project.projectName,
        segments: this.toSegments(project),
        totalExpenditure: project.totalExpenditure,
        totalReturn: project.totalReturn,
      }))
  );

  /**
   * Categories sum to the project's own investment by warehouse construction — verified across all
   * production project rows, worst difference under a billionth of a cent. Nothing here rescales
   * them to fit: a stack that fails to reach its project's investment figure is a defect in the
   * metric layer, and papering over it in the renderer would hide exactly the thing worth knowing.
   * This surfaces the discrepancy instead.
   */
  protected readonly unreconciled: Signal<{ projectName: string; difference: string }[]> = computed(() =>
    this.rows()
      .map((row) => ({
        projectName: row.projectName,
        difference: row.segments.reduce((sum, segment) => sum + segment.expenditure, 0) - row.totalExpenditure,
      }))
      // A cent, not an epsilon: the payload carries currency rounded to the cent, so anything
      // smaller is representation noise rather than a modelling disagreement.
      .filter((entry) => Math.abs(entry.difference) >= 0.01)
      .map((entry) => ({ projectName: entry.projectName, difference: formatCurrency(entry.difference) }))
  );

  /** Only the categories actually present, so an organization with no events gets no dead legend entry. */
  private readonly presentTypes: Signal<OrgLensRoiProjectBarSegment[]> = computed(() => {
    const byType = new Map<string, OrgLensRoiProjectBarSegment>();
    for (const row of this.rows()) {
      for (const segment of row.segments) {
        if (segment.expenditure !== 0 && !byType.has(segment.type)) byType.set(segment.type, segment);
      }
    }
    // Canonical order first, so the stack reads the same way on every project — then anything the
    // warehouse sent that this constant does not know about yet, appended rather than dropped.
    //
    // Filtering to the known vocabulary would silently understate a project: the BFF deliberately
    // forwards unrecognised contribution types (a seed can gain a ninth before this constant does),
    // and `unreconciled` sums the payload's own segments, so a dropped category would leave the
    // chart short of its project's investment with nothing to say so.
    const known = new Set<string>(ORG_LENS_ROI_CONTRIBUTION_TYPES);
    const canonical = ORG_LENS_ROI_CONTRIBUTION_TYPES.map((type) => byType.get(type)).filter(
      (segment): segment is OrgLensRoiProjectBarSegment => segment !== undefined
    );
    const unknown = [...byType.values()].filter((segment) => !known.has(segment.type));
    return [...canonical, ...unknown];
  });

  protected readonly chartHeight: Signal<string> = computed(() => `${Math.max(240, this.rows().length * 44 + 80)}px`);

  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    const count = this.rows().length;
    if (!this.showReturn()) {
      return `Horizontal bar chart of modelled investment, stacked by contribution category, for ${count} projects. The same figures are listed in the table below.`;
    }
    if (!this.showInvestment()) return `Horizontal bar chart of return for ${count} projects. The same figures are listed in the table below.`;
    return `Horizontal bar chart comparing modelled investment, stacked by contribution category, against return for ${count} projects. The same figures are listed in the table below.`;
  });

  /** Column headings for the accessible table: one per category actually drawn, in stack order. */
  protected readonly categoryColumns: Signal<{ type: string; label: string }[]> = computed(() =>
    this.presentTypes().map((category) => ({ type: category.type, label: category.label }))
  );

  /**
   * The accessible equivalent of the canvas.
   *
   * Carries a cell per contribution category, not just the totals. The stack composition *is* what
   * this chart shows — a text alternative giving only investment and return would describe a
   * different, simpler chart, and leave a screen-reader user unable to read the one on the page.
   */
  protected readonly tableRows: Signal<{ projectId: string; projectName: string; investment: string; return: string; categories: string[] }[]> = computed(
    () => {
      const columns = this.presentTypes();
      return this.rows().map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        investment: formatCurrency(row.totalExpenditure),
        return: formatCurrency(row.totalReturn),
        // Absent categories render as a zero rather than a blank, so every row has the same shape
        // and a missing category is stated rather than left to be inferred from an empty cell.
        categories: columns.map((column) => formatCurrency(row.segments.find((segment) => segment.type === column.type)?.expenditure ?? 0)),
      }));
    }
  );

  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => {
    const rows = this.rows();
    const categoryDatasets = this.showInvestment()
      ? this.presentTypes().map((category) => ({
          label: category.label,
          // Stacked against each other, so each category contributes its own slice of the same bar.
          stack: 'investment',
          xAxisID: 'x',
          backgroundColor: category.color,
          borderWidth: 0,
          data: rows.map((row) => row.segments.find((segment) => segment.type === category.type)?.expenditure ?? 0),
        }))
      : [];

    return {
      labels: rows.map((row) => row.projectName),
      datasets: [
        ...categoryDatasets,
        ...(this.showReturn()
          ? [
              {
                label: 'Return',
                // Its own stack, so it sits beside the investment bar rather than on top of it —
                // return is not another kind of investment.
                stack: 'return',
                xAxisID: 'x2',
                backgroundColor: ORG_LENS_ROI_RETURN_COLOR,
                borderWidth: 0,
                data: rows.map((row) => row.totalReturn),
              },
            ]
          : []),
      ],
    };
  });

  protected readonly chartOptions: Signal<ChartOptions<'bar'>> = computed(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      // Two value axes, not one, and deliberately not a logarithmic one. Return runs 36-56x
      // investment, so on a single shared linear axis the investment stack is a sliver and its
      // categories are invisible — the thing this chart exists to show. A log axis would fix the
      // range but break the stack: segments are positioned by cumulative total, so under log
      // scaling a segment's length stops corresponding to its value and the small categories
      // collapse regardless. Separate linear scales keep each bar internally truthful; the
      // disclosure below states that the two are not comparable by length.
      x: {
        display: this.showInvestment(),
        stacked: true,
        position: 'bottom',
        beginAtZero: true,
        title: { display: true, text: 'Investment', font: { size: 11 } },
        ticks: { callback: (value) => formatCurrency(Number(value)) },
        grid: { color: lfxColors.gray[200] },
      },
      x2: {
        display: this.showReturn(),
        stacked: true,
        position: 'top',
        beginAtZero: true,
        title: { display: true, text: 'Return', font: { size: 11 } },
        ticks: { callback: (value) => formatCurrency(Number(value)) },
        grid: { display: false },
      },
      y: { stacked: true, grid: { display: false } },
    },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.x))}` },
      },
    },
  }));

  public constructor() {
    this.seriesForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.lockLastSeries());
  }

  private lockLastSeries(): void {
    const { investment, return: returned } = this.seriesForm.controls;
    if (investment.value && !returned.value) {
      investment.disable({ emitEvent: false });
    } else {
      investment.enable({ emitEvent: false });
    }
    if (returned.value && !investment.value) {
      returned.disable({ emitEvent: false });
    } else {
      returned.enable({ emitEvent: false });
    }
  }

  private toSegments(project: OrgLensRoiProjectRow): OrgLensRoiProjectBarSegment[] {
    return project.categories.map((category) => ({
      type: category.type,
      label: category.label,
      expenditure: category.expenditure,
      color: ORG_LENS_ROI_CATEGORY_COLOR[category.type] ?? lfxColors.gray[400],
    }));
  }
}
