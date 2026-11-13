// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_PROGRESS_BAR_FILL_CLASS, HEALTH_METRICS_TABLE_DASH } from '@lfx-one/shared/constants';
import { clampHealthMetricsPct } from '@lfx-one/shared/utils';

/**
 * A table cell's value over a 6px bar: 4px under the value, or, with a goal, the goal text on the right of the value
 * and the bar 6px under both. The widget sets the width, 140px by default; "—" turns neutral-400.
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
  /** The cell's maximum width, as the widget sets it for either bar. */
  public readonly maxWidthPx = input<number>(140);
  public readonly fillClass = input<string>(HEALTH_METRICS_PROGRESS_BAR_FILL_CLASS);

  protected readonly valueClass: Signal<string> = computed(() => (this.value() === HEALTH_METRICS_TABLE_DASH ? 'text-gray-400' : 'text-gray-900'));
  protected readonly width: Signal<number> = computed(() => clampHealthMetricsPct(this.pct()) ?? 0);
  // Exact px: the design sets a goal bar 6px under its row and a plain one 4px under its value.
  protected readonly gapClass: Signal<string> = computed(() => (this.goal() ? 'gap-[6px]' : 'gap-[4px]'));
}
