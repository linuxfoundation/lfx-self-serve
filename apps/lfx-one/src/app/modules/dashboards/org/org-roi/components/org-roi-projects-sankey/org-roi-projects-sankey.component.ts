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
  ORG_LENS_ROI_SANKEY_CATEGORY_NODE_PREFIX,
  ORG_LENS_ROI_SANKEY_ORG_NODE,
  ORG_LENS_ROI_SANKEY_ORG_NODE_KEY,
  ORG_LENS_ROI_SANKEY_PROJECT_NODE_PREFIX,
} from '@lfx-one/shared/constants';
import type {
  OrgLensRoiContributionType,
  OrgLensRoiProjectFlowLink,
  OrgLensRoiProjectRow,
  OrgLensRoiProjectSankeyMeasure,
  OrgLensRoiSankeyChartData,
  OrgLensRoiSankeyColorContext,
} from '@lfx-one/shared/interfaces';
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
        .map((project) => ({ from: this.projectNode(project.projectId), to: ORG_LENS_ROI_SANKEY_ORG_NODE_KEY, flow: project.totalReturn }));
    }

    const categoryTotals = new Map<string, number>();
    const categoryToProject: OrgLensRoiProjectFlowLink[] = [];
    for (const project of projects) {
      for (const category of project.categories) {
        if (category.expenditure <= 0) continue;
        const node = this.categoryNode(category.type);
        categoryTotals.set(node, (categoryTotals.get(node) ?? 0) + category.expenditure);
        categoryToProject.push({ from: node, to: this.projectNode(project.projectId), flow: category.expenditure });
      }
    }

    const orgToCategory = [...categoryTotals.entries()].map(([node, flow]) => ({ from: ORG_LENS_ROI_SANKEY_ORG_NODE_KEY, to: node, flow }));
    return [...orgToCategory, ...categoryToProject];
  });

  /**
   * Node keys are type-prefixed ids, not display names, and the labels below map them back for
   * rendering. Sankey identifies a node by its key, so keying on the name merged two projects that
   * happen to share one — and worse, a project named after a contribution category, or "Your
   * organization", would have joined that node and produced a cycle.
   */
  protected readonly nodeLabels: Signal<Record<string, string>> = computed(() => {
    const labels: Record<string, string> = { [ORG_LENS_ROI_SANKEY_ORG_NODE_KEY]: ORG_LENS_ROI_SANKEY_ORG_NODE };
    for (const project of this.drawnProjects()) {
      labels[this.projectNode(project.projectId)] = project.projectName;
      for (const category of project.categories) {
        labels[this.categoryNode(category.type)] = category.label;
      }
    }
    return labels;
  });

  protected readonly hasLinks: Signal<boolean> = computed(() => this.links().length > 0);

  protected readonly measureLabel: Signal<string> = computed(() => this.measureLabels[this.measure()]);

  protected readonly measureLabelLowercase: Signal<string> = computed(() => this.measureLabel().toLowerCase());

  protected readonly chartHeight: Signal<string> = computed(() => `${Math.max(280, this.drawnProjects().length * 46 + 120)}px`);

  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    if (this.measure() === 'return') {
      return `Flow diagram of modelled return from ${this.drawnProjects().length} projects back to your organization. The same figures are listed below.`;
    }
    return `Flow diagram of modelled investment from your organization, through contribution categories, out to ${this.drawnProjects().length} projects. The same figures are listed below.`;
  });

  /** The accessible equivalent of the canvas: every flow as real text, with nodes resolved to names. */
  protected readonly flowRows: Signal<{ key: string; from: string; to: string; amount: string }[]> = computed(() => {
    const labels = this.nodeLabels();
    return this.links().map((link, index) => ({
      key: `${index}|${link.from}|${link.to}`,
      from: labels[link.from] ?? link.from,
      to: labels[link.to] ?? link.to,
      amount: formatCurrency(link.flow),
    }));
  });

  protected readonly chartData: Signal<OrgLensRoiSankeyChartData> = computed(() => ({
    datasets: [
      {
        label: this.measureLabel(),
        data: this.links(),
        colorFrom: (context: OrgLensRoiSankeyColorContext) => this.nodeColor(context.raw?.from ?? ''),
        colorTo: (context: OrgLensRoiSankeyColorContext) => this.nodeColor(context.raw?.to ?? ''),
        colorMode: 'gradient',
        borderWidth: 0,
        // Maps the type-prefixed node keys back to the names a viewer reads.
        labels: this.nodeLabels(),
        // Node heights are driven by the larger of a node's inbound and outbound totals, so a
        // category that feeds several projects is not drawn smaller than the flows leaving it.
        size: 'max',
      },
    ],
  }));

  protected readonly chartOptions: Signal<unknown> = computed(() => {
    const labels = this.nodeLabels();
    return {
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
            // Resolves the node keys to names, so the tooltip never shows `project:<id>`.
            label: (ctx: OrgLensRoiSankeyColorContext) =>
              ctx.raw === undefined ? '' : ` ${labels[ctx.raw.from] ?? ctx.raw.from} → ${labels[ctx.raw.to] ?? ctx.raw.to}: ${formatCurrency(ctx.raw.flow)}`,
          },
        },
      },
    };
  });

  public setMeasure(measure: OrgLensRoiProjectSankeyMeasure): void {
    this.measure.set(measure);
  }

  /** Categories keep the colour they carry on the comparison view; project nodes stay neutral. */
  private nodeColor(node: string): string {
    if (node === ORG_LENS_ROI_SANKEY_ORG_NODE_KEY) return this.measure() === 'return' ? ORG_LENS_ROI_RETURN_COLOR : lfxColors.blue[600];
    const type = node.startsWith(ORG_LENS_ROI_SANKEY_CATEGORY_NODE_PREFIX) ? node.slice(ORG_LENS_ROI_SANKEY_CATEGORY_NODE_PREFIX.length) : '';
    // Looked up as a plain string, not asserted to be a known type. The payload can carry a
    // contribution type this constant does not know yet, which is exactly what the fallback is
    // for — asserting would suppress the check that keeps the fallback honest.
    const colorsByType: Record<string, string> = ORG_LENS_ROI_CATEGORY_COLOR;
    return colorsByType[type] ?? lfxColors.gray[400];
  }

  private projectNode(projectId: string): string {
    return `${ORG_LENS_ROI_SANKEY_PROJECT_NODE_PREFIX}${projectId}`;
  }

  private categoryNode(type: OrgLensRoiContributionType): string {
    return `${ORG_LENS_ROI_SANKEY_CATEGORY_NODE_PREFIX}${type}`;
  }
}
