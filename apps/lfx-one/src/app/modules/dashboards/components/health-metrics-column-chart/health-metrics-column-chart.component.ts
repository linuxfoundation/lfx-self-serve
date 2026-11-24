// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import { HealthMetricsChartTipState } from '../health-metrics-chart-tip/health-metrics-chart-tip-state';
import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsColumnChartView } from '@lfx-one/shared/interfaces';

/**
 * The design's stacked column chart: y labels beside light quarter rules, one column per group with its total above it,
 * and a hover or focus on a column that tints it and opens the chart popup beside it.
 */
@Component({
  selector: 'lfx-health-metrics-column-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-column-chart.component.html',
  // Escape closes the popup however it opened, since hovering a column does not focus it; a resize re-places an open one.
  host: { class: 'block', '(document:keydown.escape)': 'tip.close()', '(window:resize)': 'tip.replace()' },
})
export class HealthMetricsColumnChartComponent {
  public readonly chart = input.required<HealthMetricsColumnChartView>();
  public readonly testId = input<string>('health-metrics-column-chart');

  protected readonly tip = new HealthMetricsChartTipState();
}
