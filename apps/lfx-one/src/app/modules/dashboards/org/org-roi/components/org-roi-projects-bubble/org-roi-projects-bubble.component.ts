// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import {
  lfxColors,
  ORG_LENS_ROI_BUBBLE_FILL,
  ORG_LENS_ROI_BUBBLE_LOG_FLOOR,
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_NO_VALUE,
  ORG_LENS_ROI_PROJECT_BUBBLE_MAX_POINTS,
  ORG_LENS_ROI_RETURN_COLOR,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiProjectBubblePoint, OrgLensRoiProjectRow } from '@lfx-one/shared/interfaces';
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils';
import type { ChartData, ChartOptions } from 'chart.js';

/** Investment against return on logarithmic axes, so the efficient outliers stay visible. */
@Component({
  selector: 'lfx-org-roi-projects-bubble',
  imports: [ChartComponent],
  templateUrl: './org-roi-projects-bubble.component.html',
})
export class OrgRoiProjectsBubbleComponent {
  /** The selected projects, in the order the picker ranked them. */
  public readonly projects = input.required<OrgLensRoiProjectRow[]>();

  /** The same wording the KPI band uses. The x axis is investment, so this view owes the disclosure. */
  protected readonly investmentExplanation = ORG_LENS_ROI_KPI_EXPLANATION.totalExpenditure;

  protected readonly maxPoints = ORG_LENS_ROI_PROJECT_BUBBLE_MAX_POINTS;

  protected readonly hiddenCount: Signal<number> = computed(() => Math.max(0, this.projects().length - this.maxPoints));

  private readonly drawnProjects: Signal<OrgLensRoiProjectRow[]> = computed(() => this.projects().slice(0, this.maxPoints));

  /** The largest net return in the selection, which every bubble's radius is scaled against. */
  private readonly maxProfitMagnitude: Signal<number> = computed(() =>
    this.drawnProjects().reduce((largest, project) => Math.max(largest, Math.abs(project.profit)), 0)
  );

  protected readonly points: Signal<OrgLensRoiProjectBubblePoint[]> = computed(() => {
    const largest = this.maxProfitMagnitude();
    return this.drawnProjects().map((project) => {
      const x = Math.max(project.totalExpenditure, ORG_LENS_ROI_BUBBLE_LOG_FLOOR);
      const y = Math.max(project.totalReturn, ORG_LENS_ROI_BUBBLE_LOG_FLOOR);
      // Square root, so a bubble's *area* is proportional to its net return. Scaling the radius
      // directly would overstate the largest by the square of its lead.
      const share = largest > 0 ? Math.sqrt(Math.abs(project.profit) / largest) : 0;
      return {
        projectId: project.projectId,
        projectName: project.projectName,
        x,
        y,
        r: 4 + share * 18,
        // A logarithmic axis has no zero, so a project with no investment or no return cannot be
        // placed truthfully. It is lifted to the floor and said so, rather than dropped — dropping
        // it would make an unmeasured project indistinguishable from one that does not exist.
        isFloored: project.totalExpenditure < ORG_LENS_ROI_BUBBLE_LOG_FLOOR || project.totalReturn < ORG_LENS_ROI_BUBBLE_LOG_FLOOR,
      };
    });
  });

  protected readonly hasPoints: Signal<boolean> = computed(() => this.points().length > 0);

  private readonly flooredNames: Signal<string[]> = computed(() =>
    this.points()
      .filter((point) => point.isFloored)
      .map((point) => point.projectName)
  );

  protected readonly hasFlooredPoints: Signal<boolean> = computed(() => this.flooredNames().length > 0);

  protected readonly flooredLabel: Signal<string> = computed(() => this.flooredNames().join(', '));

  protected readonly chartSummaryLabel: Signal<string> = computed(
    () =>
      `Bubble chart of ${this.points().length} projects, plotting modelled investment against modelled return on logarithmic axes, with each bubble sized by net return. The same figures are listed below.`
  );

  /** The accessible equivalent of the canvas, carrying the true unfloored figures. */
  protected readonly tableRows: Signal<{ projectId: string; projectName: string; investment: string; return: string; roi: string }[]> = computed(() =>
    this.drawnProjects().map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      investment: formatCurrency(project.totalExpenditure),
      return: formatCurrency(project.totalReturn),
      // Read from the payload, never re-derived, and blank rather than zero when undefined.
      roi: typeof project.roi === 'number' && Number.isFinite(project.roi) ? `${formatPercent(project.roi * 100)}%` : ORG_LENS_ROI_NO_VALUE,
    }))
  );

  protected readonly chartData: Signal<ChartData<'bubble'>> = computed(() => {
    const projects = this.drawnProjects();
    return {
      datasets: [
        {
          label: 'Projects',
          data: this.points().map((point) => ({ x: point.x, y: point.y, r: point.r })),
          // Loss-making projects are a mainline case here, not an anomaly, so they are coloured
          // apart rather than left to be inferred from position.
          backgroundColor: projects.map((project) => (project.profit < 0 ? ORG_LENS_ROI_BUBBLE_FILL.lossMaking : ORG_LENS_ROI_BUBBLE_FILL.profitable)),
          borderColor: projects.map((project) => (project.profit < 0 ? lfxColors.amber[500] : ORG_LENS_ROI_RETURN_COLOR)),
          borderWidth: 1,
        },
      ],
    };
  });

  protected readonly chartOptions: Signal<ChartOptions<'bubble'>> = computed(() => {
    const points = this.points();
    const projects = this.drawnProjects();
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        // Logarithmic on both axes. Portfolio ROI runs in the thousands of percent, so return spans
        // four orders of magnitude across a portfolio and a linear axis presses every project
        // except the largest into the corner — which is precisely where the efficient
        // low-investment, high-return projects this view exists to find would be hidden.
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Investment', font: { size: 11 } },
          ticks: { callback: (value) => formatCurrency(Number(value)) },
          grid: { color: lfxColors.gray[200] },
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Return', font: { size: 11 } },
          ticks: { callback: (value) => formatCurrency(Number(value)) },
          grid: { color: lfxColors.gray[200] },
        },
      },
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
            title: (items) => points[items[0]?.dataIndex ?? 0]?.projectName ?? '',
            // The project's true figures, not the floored coordinates the bubble was placed at.
            label: (ctx) => {
              const project = projects[ctx.dataIndex];
              if (project === undefined) return '';
              return [
                ` Investment: ${formatCurrency(project.totalExpenditure)}`,
                ` Return: ${formatCurrency(project.totalReturn)}`,
                ` Net return: ${formatCurrency(project.profit)}`,
              ];
            },
          },
        },
      },
    };
  });
}
