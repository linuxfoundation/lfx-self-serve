// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { healthMetricsSortIcon } from '@lfx-one/shared/utils';

import type { HealthMetricsColumnSort } from '@lfx-one/shared/interfaces';

/**
 * A Health Metrics table header's content, inside its `th`: the label, an optional question-mark tip, then a sortable
 * column's 10px arrow. The `th` owns the alignment and its `aria-sort`; a click on the label or the arrow emits `sorted`.
 */
@Component({
  selector: 'lfx-health-metrics-th',
  imports: [UiTooltipDirective],
  templateUrl: './health-metrics-th.component.html',
  host: { class: 'group/hmth inline-flex items-center whitespace-nowrap align-middle' },
})
export class HealthMetricsThComponent {
  public readonly label = input.required<string>();
  /** `null` for a column that does not sort. */
  public readonly sort = input<HealthMetricsColumnSort | null>(null);
  /** Explains the column; empty shows no tip. */
  public readonly tip = input<string>('');

  /** The user asked to sort by this column; the table picks the direction. */
  public readonly sorted = output<void>();

  protected readonly arrowClasses: Signal<string> = computed(() => {
    const sort = this.sort();
    if (sort === null) return '';

    // Exact px, not rem: the design's 10px arrow 6px after the label or tip. An unsorted column keeps no room for it until
    // hover or focus, when its width, opacity and gap open over 0.2s.
    const shown = 'ml-[6px] w-[10px] opacity-100';
    const hidden =
      'ml-0 w-0 opacity-0 group-hover/hmth:ml-[6px] group-hover/hmth:w-[10px] group-hover/hmth:opacity-100 group-focus-within/hmth:ml-[6px] group-focus-within/hmth:w-[10px] group-focus-within/hmth:opacity-100';
    const motion = 'transition-[width,opacity,margin] duration-200 ease-[ease] motion-reduce:transition-none';
    return `inline-block cursor-pointer overflow-hidden text-[10px] ${healthMetricsSortIcon(sort)} ${motion} ${sort === 'none' ? hidden : shown}`;
  });
}
