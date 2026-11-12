// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { healthMetricsSortIcon } from '@lfx-one/shared/utils';

import type { HealthMetricsColumnSort } from '@lfx-one/shared/interfaces';

/**
 * A Health Metrics table header's label, inside its `th`: the label, a 10px sort arrow 6px after it on a sortable
 * column, and an optional question-mark tip. The `th` owns the type, the alignment and any click to sort.
 */
@Component({
  selector: 'lfx-health-metrics-th',
  imports: [UiTooltipDirective],
  templateUrl: './health-metrics-th.component.html',
  host: { class: 'inline-flex items-center gap-[6px] whitespace-nowrap align-middle' },
})
export class HealthMetricsThComponent {
  public readonly label = input.required<string>();
  /** `null` for a column that does not sort. */
  public readonly sort = input<HealthMetricsColumnSort | null>(null);
  /** Explains the column; empty shows no tip. */
  public readonly tip = input<string>('');

  protected readonly sortIcon: Signal<string> = computed(() => {
    const sort = this.sort();
    return sort === null ? '' : healthMetricsSortIcon(sort);
  });
}
