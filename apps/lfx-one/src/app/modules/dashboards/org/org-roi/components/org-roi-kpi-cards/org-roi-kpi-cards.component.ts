// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { ORG_LENS_ROI_KPI_EXPLANATION, ORG_LENS_ROI_KPI_ICON_CLASS, ORG_LENS_ROI_NO_VALUE } from '@lfx-one/shared/constants';
import type { OrgLensRoiSummary, StatCardItem } from '@lfx-one/shared/interfaces';
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils';

import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';

@Component({
  selector: 'lfx-org-roi-kpi-cards',
  imports: [StatCardGridComponent],
  templateUrl: './org-roi-kpi-cards.component.html',
})
export class OrgRoiKpiCardsComponent {
  public readonly summary = input.required<OrgLensRoiSummary>();

  protected readonly explanation = ORG_LENS_ROI_KPI_EXPLANATION;

  protected readonly cards: Signal<StatCardItem[]> = computed(() => {
    const summary = this.summary();
    const projectLabel = summary.nProjects === 1 ? '1 project' : `${summary.nProjects.toLocaleString('en-US')} projects`;
    return [
      {
        label: 'Total Investment',
        value: this.money(summary.totalExpenditure),
        subLine: `Modelled cost across ${projectLabel}`,
        icon: 'fa-light fa-hand-holding-dollar',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.totalExpenditure,
      },
      {
        label: 'Total Return',
        value: this.money(summary.totalReturn),
        subLine: `Net ${this.money(summary.profit)}`,
        icon: 'fa-light fa-arrow-trend-up',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.totalReturn,
      },
      {
        label: 'Portfolio ROI',
        value: this.ratioAsPercent(summary.roi),
        icon: 'fa-light fa-percent',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.roi,
      },
      {
        label: 'Benefit-Cost Ratio',
        value: this.multiple(summary.bcr),
        icon: 'fa-light fa-scale-balanced',
        iconContainerClass: ORG_LENS_ROI_KPI_ICON_CLASS.bcr,
      },
    ];
  });

  /**
   * A measure is renderable only if it is actually a finite number. `=== null` is not enough: an
   * absent key is `undefined`, which slips past it and reaches `toFixed()`. The measures are
   * nullable by design — the warehouse returns NULL rather than zero when there is no investment to
   * divide by — so anything non-numeric renders as the no-value indicator, never as 0.
   */
  private isRenderable(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private money(value: number | null): string {
    return this.isRenderable(value) ? formatCurrency(value) : ORG_LENS_ROI_NO_VALUE;
  }

  private ratioAsPercent(value: number | null): string {
    return this.isRenderable(value) ? `${formatPercent(value * 100)}%` : ORG_LENS_ROI_NO_VALUE;
  }

  /** A ratio, not a percentage, so it does not go through the percentage formatter. */
  private multiple(value: number | null): string {
    return this.isRenderable(value) ? `${value.toFixed(1)}×` : ORG_LENS_ROI_NO_VALUE;
  }
}
