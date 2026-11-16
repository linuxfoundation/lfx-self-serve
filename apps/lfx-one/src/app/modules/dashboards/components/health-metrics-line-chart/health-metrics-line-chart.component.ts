// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, computed, inject, input, signal } from '@angular/core';
import { HEALTH_METRICS_LINE_CHART_VIEW_WIDTH } from '@lfx-one/shared/constants';

import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsLineChartView } from '@lfx-one/shared/interfaces';

/**
 * The design's line chart: y labels beside light quarter rules, straight lines with a soft fill under the first filled
 * series, hollow dots, and one hover or focus column per x position that draws a guide and opens the chart popup.
 */
@Component({
  selector: 'lfx-health-metrics-line-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-line-chart.component.html',
  // Escape closes the popup however it opened, since hovering a column does not focus it.
  host: { class: 'block', '(document:keydown.escape)': 'activeIndex.set(null)' },
})
export class HealthMetricsLineChartComponent {
  public readonly chart = input.required<HealthMetricsLineChartView>();
  public readonly testId = input<string>('health-metrics-line-chart');

  protected readonly viewWidth = HEALTH_METRICS_LINE_CHART_VIEW_WIDTH;
  /** Unique per chart, so two charts on a page never share a fill. */
  protected readonly gradientId = inject(_IdGenerator).getId('health-metrics-line-chart-area-');
  protected readonly gradientFill = `url(#${this.gradientId})`;
  protected readonly activeIndex = signal<number | null>(null);
  /** The popup opens right of its column, or left of it in the chart's right half, so it stays over the plot. */
  protected readonly tipOnLeft = computed(() => {
    const index = this.activeIndex();
    return index !== null && index >= this.chart().columns.length / 2;
  });

  protected onEnter(index: number): void {
    this.activeIndex.set(index);
  }

  protected onLeave(index: number): void {
    if (this.activeIndex() === index) this.activeIndex.set(null);
  }
}
