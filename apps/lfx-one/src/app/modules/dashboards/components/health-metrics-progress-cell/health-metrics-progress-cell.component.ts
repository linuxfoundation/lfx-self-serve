// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_PROGRESS_BAR_FILL_CLASS } from '@lfx-one/shared/constants';
import { clampHealthMetricsPct } from '@lfx-one/shared/utils';

/**
 * A table cell's value over a 6px bar: 4px under the value up to 140px wide, or, with a goal, the goal text on the
 * right of the value and the bar 6px under both, as wide as the widget allows.
 */
@Component({
  selector: 'lfx-health-metrics-progress-cell',
  templateUrl: './health-metrics-progress-cell.component.html',
  host: { class: 'flex w-full min-w-0 flex-col', '[class]': 'gapClass()', '[style.max-width.px]': 'maxWidthPx()' },
})
export class HealthMetricsProgressCellComponent {
  /** The formatted value, e.g. `640`. */
  public readonly value = input.required<string>();
  /** The bar's 0–100 share; `null` draws an empty track. */
  public readonly pct = input.required<number | null>();
  /** The goal text on the right, e.g. `of 1,000`; empty for a bar under the value alone. */
  public readonly goal = input<string>('');
  /** The widget's width for a goal bar; a bar under the value alone stops at 140px. */
  public readonly maxWidthPx = input<number>(140);
  public readonly fillClass = input<string>(HEALTH_METRICS_PROGRESS_BAR_FILL_CLASS);

  protected readonly width: Signal<number> = computed(() => clampHealthMetricsPct(this.pct()) ?? 0);
  // Exact px: the design sets a goal bar 6px under its row and a plain one 4px under its value.
  protected readonly gapClass: Signal<string> = computed(() => (this.goal() ? 'gap-[6px]' : 'gap-[4px]'));
}
