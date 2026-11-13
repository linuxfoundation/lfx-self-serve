// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_TABLE_DASH, HEALTH_METRICS_VALUE_BAR_FILL } from '@lfx-one/shared/constants';
import { clampHealthMetricsPct, healthMetricsBarFillClass } from '@lfx-one/shared/utils';

import type { HealthMetricsBarFillRule } from '@lfx-one/shared/interfaces';

/**
 * A table cell's value with a 62×6 bar after it: neutral at 0%, danger under 20%, warning under 50%, accent above,
 * unless the widget passes its own rule or a single fill. No share shows "—" and no bar.
 */
@Component({
  selector: 'lfx-health-metrics-value-bar',
  templateUrl: './health-metrics-value-bar.component.html',
  // Exact px, not rem: the design's 8px between the value and its bar.
  host: { class: 'inline-flex min-w-0 items-center gap-[8px]' },
})
export class HealthMetricsValueBarComponent {
  /** The formatted value, e.g. `42%`. */
  public readonly value = input.required<string>();
  /** The bar's 0–100 share; `null` for no data. */
  public readonly pct = input.required<number | null>();
  public readonly fillRule = input<HealthMetricsBarFillRule>(HEALTH_METRICS_VALUE_BAR_FILL);
  /** One fill for every share, in place of the rule. */
  public readonly fillClass = input<string>('');

  protected readonly dash = HEALTH_METRICS_TABLE_DASH;
  protected readonly width: Signal<number | null> = computed(() => clampHealthMetricsPct(this.pct()));
  protected readonly fill: Signal<string> = computed(() => {
    const width = this.width();
    if (width === null) return '';
    return this.fillClass() || healthMetricsBarFillClass(width, this.fillRule());
  });
}
