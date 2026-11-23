// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import { HealthMetricsChartTipState } from '../health-metrics-chart-tip/health-metrics-chart-tip-state';
import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsBarChartView } from '@lfx-one/shared/interfaces';

/**
 * The design's bar chart: y labels beside light quarter rules, one bar per point with its value above it, an optional
 * dashed line with dots over the bars, and a hover or focus on a bar that tints it and opens the chart popup beside it.
 */
@Component({
  selector: 'lfx-health-metrics-bar-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-bar-chart.component.html',
  // Escape closes the popup however it opened, since hovering a bar does not focus it; a resize re-places an open one.
  host: { class: 'block', '(document:keydown.escape)': 'tip.close()', '(window:resize)': 'tip.replace()' },
})
export class HealthMetricsBarChartComponent {
  public readonly chart = input.required<HealthMetricsBarChartView>();
  public readonly testId = input<string>('health-metrics-bar-chart');

  protected readonly tip = new HealthMetricsChartTipState();
}
