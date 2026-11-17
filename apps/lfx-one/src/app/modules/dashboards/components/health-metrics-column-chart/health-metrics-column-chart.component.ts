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
  // Escape closes the popup however it opened, since hovering a column does not focus it.
  host: { class: 'block', '(document:keydown.escape)': 'activeIndex.set(null)' },
})
export class HealthMetricsColumnChartComponent {
  public readonly chart = input.required<HealthMetricsColumnChartView>();
  public readonly testId = input<string>('health-metrics-column-chart');

  protected readonly activeIndex = signal<number | null>(null);
  protected readonly tipPlacement = signal<HealthMetricsLineChartTipPlacement | null>(null);

  protected onEnter(index: number, event: Event): void {
    const column = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.activeIndex.set(index);
    this.tipPlacement.set(placeHealthMetricsChartTip(50, column.left + column.width / 2, document.documentElement.clientWidth));
  }

  protected onLeave(index: number): void {
    if (this.activeIndex() === index) this.activeIndex.set(null);
  }
}
