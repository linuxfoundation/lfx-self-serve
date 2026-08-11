// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal, signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import {
  lfxColors,
  ORG_LENS_ROI_CATEGORY_COLOR,
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_PROJECT_SANKEY_MAX_PROJECTS,
  ORG_LENS_ROI_PROJECT_SANKEY_MEASURE_LABELS,
  ORG_LENS_ROI_PROJECT_SANKEY_MEASURES,
  ORG_LENS_ROI_RETURN_COLOR,
  ORG_LENS_ROI_SANKEY_ORG_NODE,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiProjectFlowLink, OrgLensRoiProjectRow, OrgLensRoiProjectSankeyMeasure } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';

/** Where the money goes and where it comes back from, as a flow diagram. */
@Component({
  selector: 'lfx-org-roi-projects-sankey',
  imports: [ChartComponent],
  templateUrl: './org-roi-projects-sankey.component.html',
})
export class OrgRoiProjectsSankeyComponent {
  /** The selected projects, in the order the picker ranked them. */
  public readonly projects = input.required<OrgLensRoiProjectRow[]>();

  protected readonly measures = ORG_LENS_ROI_PROJECT_SANKEY_MEASURES;
  protected readonly measureLabels = ORG_LENS_ROI_PROJECT_SANKEY_MEASURE_LABELS;
  protected readonly maxProjects = ORG_LENS_ROI_PROJECT_SANKEY_MAX_PROJECTS;

  /** The same wording the KPI band uses, carried only by the flow that is a modelled cost. */
  protected readonly investmentExplanation = ORG_LENS_ROI_KPI_EXPLANATION.totalExpenditure;

  protected readonly measure = signal<OrgLensRoiProjectSankeyMeasure>('investment');

  protected readonly showsModelledCost: Signal<boolean> = computed(() => this.measure() === 'investment');

  protected readonly hiddenCount: Signal<number> = computed(() => Math.max(0, this.projects().length - this.maxProjects));

  private readonly drawnProjects: Signal<OrgLensRoiProjectRow[]> = computed(() => this.projects().slice(0, this.maxProjects));

  /**
   * Investment fans out through its contribution categories; return comes straight back.
   *
   * The asymmetry is the data's, not a presentational choice: investment is decomposed by category
   * in the warehouse and return is not, so an intermediate node on the return side would be
   * invented rather than reported.
   *
   * A zero flow is dropped. A sankey link of zero width is not drawn but still contributes a node,
   * leaving a labelled stub attached to nothing.
   */
  protected readonly links: Signal<OrgLensRoiProjectFlowLink[]> = computed(() => {
    const projects = this.drawnProjects();
    if (this.measure() === 'return') {
      return projects
        .filter((project) => project.totalReturn > 0)
        .map((project) => ({ from: project.projectName, to: ORG_LENS_ROI_SANKEY_ORG_NODE, flow: project.totalReturn }));
    }

    const categoryTotals = new Map<string, number>();
    const categoryToProject: OrgLensRoiProjectFlowLink[] = [];
    for (const project of projects) {
      for (const category of project.categories) {
        if (category.expenditure <= 0) continue;
        categoryTotals.set(category.label, (categoryTotals.get(category.label) ?? 0) + category.expenditure);
        categoryToProject.push({ from: category.label, to: project.projectName, flow: category.expenditure });
      }
    }

    const orgToCategory = [...categoryTotals.entries()].map(([label, flow]) => ({ from: ORG_LENS_ROI_SANKEY_ORG_NODE, to: label, flow }));
    return [...orgToCategory, ...categoryToProject];
  });

  protected readonly hasLinks: Signal<boolean> = computed(() => this.links().length > 0);

  /**
   * Sankey identifies a node by its label, so the colour has to be looked up by the category's
   * display label rather than its type code. The mapping comes from the payload, which carries
   * both on every category row.
   */
  private readonly categoryColorByLabel: Signal<Map<string, string>> = computed(() => {
    const byLabel = new Map<string, string>();
    for (const project of this.drawnProjects()) {
      for (const category of project.categories) {
        const color = ORG_LENS_ROI_CATEGORY_COLOR[category.type];
        if (color !== undefined) byLabel.set(category.label, color);
      }
    }
    return byLabel;
  });

  protected readonly measureLabel: Signal<string> = computed(() => this.measureLabels[this.measure()]);

  protected readonly chartHeight: Signal<string> = computed(() => `${Math.max(280, this.drawnProjects().length * 46 + 120)}px`);

  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    if (this.measure() === 'return') {
      return `Flow diagram of modelled return from ${this.drawnProjects().length} projects back to your organization. The same figures are listed below.`;
    }
    return `Flow diagram of modelled investment from your organization, through contribution categories, out to ${this.drawnProjects().length} projects. The same figures are listed below.`;
  });

  /**
   * The accessible equivalent of the canvas: every flow as real text.
   *
   * Keyed by position rather than by endpoint labels. Two projects can share a display name, which
   * would give two distinct flows the same key and leave the rendered list one row short of the
   * chart. (The chart itself still merges them — sankey identifies a node by its label — but that
   * is the library's constraint, not one to reproduce here.)
   */
  protected readonly flowRows: Signal<{ key: string; from: string; to: string; amount: string }[]> = computed(() =>
    this.links().map((link, index) => ({ key: `${index}|${link.from}|${link.to}`, from: link.from, to: link.to, amount: formatCurrency(link.flow) }))
  );

  protected readonly chartData: Signal<unknown> = computed(() => ({
    datasets: [
      {
        label: this.measureLabel(),
        data: this.links(),
        colorFrom: (context: { raw?: OrgLensRoiProjectFlowLink }) => this.nodeColor(context.raw?.from ?? ''),
        colorTo: (context: { raw?: OrgLensRoiProjectFlowLink }) => this.nodeColor(context.raw?.to ?? ''),
        colorMode: 'gradient',
        borderWidth: 0,
        // Node heights are driven by the larger of a node's inbound and outbound totals, so a
        // category that feeds several projects is not drawn smaller than the flows leaving it.
        size: 'max',
      },
    ],
  }));

  protected readonly chartOptions: Signal<unknown> = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
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
          label: (ctx: { raw?: OrgLensRoiProjectFlowLink }) =>
            ctx.raw === undefined ? '' : ` ${ctx.raw.from} → ${ctx.raw.to}: ${formatCurrency(ctx.raw.flow)}`,
        },
      },
    },
  }));

  public setMeasure(measure: OrgLensRoiProjectSankeyMeasure): void {
    this.measure.set(measure);
  }

  /** Categories keep the colour they carry on the comparison view; project nodes stay neutral. */
  private nodeColor(node: string): string {
    if (node === ORG_LENS_ROI_SANKEY_ORG_NODE) return this.measure() === 'return' ? ORG_LENS_ROI_RETURN_COLOR : lfxColors.blue[600];
    return this.categoryColorByLabel().get(node) ?? lfxColors.gray[400];
  }
}
