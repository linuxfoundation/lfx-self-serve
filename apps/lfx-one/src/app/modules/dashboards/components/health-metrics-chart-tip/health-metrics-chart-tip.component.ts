// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import type { HealthMetricsChartTipView } from '@lfx-one/shared/interfaces';

/**
 * The design's chart popup: a title over label–value rows. A row's dot is its series colour, kept as empty space for a
 * row without one so the labels line up, or left out; a rule can set a row apart. The chart places it.
 */
@Component({
  selector: 'lfx-health-metrics-chart-tip',
  templateUrl: './health-metrics-chart-tip.component.html',
  host: { class: 'block' },
})
export class HealthMetricsChartTipComponent {
  public readonly tip = input.required<HealthMetricsChartTipView>();
}
