// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { placeHealthMetricsChartTip } from '@lfx-one/shared/utils';

import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsColumnChartView, HealthMetricsLineChartTipPlacement } from '@lfx-one/shared/interfaces';

/**
 * The design's stacked column chart: y labels beside light quarter rules, one column per group with its total above it,
 * and a hover or focus on a column that tints it and opens the chart popup beside it.
 */
@Component({
  selector: 'lfx-health-metrics-column-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-column-chart.component.html',
  // Escape closes the popup however it opened, since hovering a column does not focus it; a resize re-places an open one.
  host: { class: 'block', '(document:keydown.escape)': 'activeIndex.set(null)', '(window:resize)': 'replaceTip()' },
})
export class HealthMetricsColumnChartComponent {
  public readonly chart = input.required<HealthMetricsColumnChartView>();
  public readonly testId = input<string>('health-metrics-column-chart');

  protected readonly activeIndex = signal<number | null>(null);
  protected readonly tipPlacement = signal<HealthMetricsLineChartTipPlacement | null>(null);
  /** The open column, kept so a resize can place its popup again. */
  private activeColumn: HTMLElement | null = null;

  protected onEnter(index: number, event: Event): void {
    this.activeColumn = event.currentTarget as HTMLElement;
    this.activeIndex.set(index);
    this.tipPlacement.set(this.placeTip(this.activeColumn));
  }

  protected onLeave(index: number): void {
    if (this.activeIndex() !== index) return;
    this.activeIndex.set(null);
    this.activeColumn = null;
  }

  protected replaceTip(): void {
    if (this.activeIndex() !== null && this.activeColumn) this.tipPlacement.set(this.placeTip(this.activeColumn));
  }

  /** Beside the column's centre, as the design places it; see `placeHealthMetricsChartTip`. */
  private placeTip(column: HTMLElement): HealthMetricsLineChartTipPlacement {
    const box = column.getBoundingClientRect();
    return placeHealthMetricsChartTip(50, box.left + box.width / 2, document.documentElement.clientWidth);
  }
}
