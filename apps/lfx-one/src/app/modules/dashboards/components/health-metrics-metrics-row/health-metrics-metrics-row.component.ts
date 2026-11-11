// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import type { HealthMetricsMetricItem, HealthMetricsMetricTrendTone } from '@lfx-one/shared/interfaces';

/**
 * The drill-down tabs' headline numbers: a ruled grid, one column per item, each a 12px label over a light 34px value,
 * an optional trend under it, a muted description and a small bar. On phones it is two per row with 28px values.
 */
@Component({
  selector: 'lfx-health-metrics-metrics-row',
  imports: [UiTooltipDirective],
  templateUrl: './health-metrics-metrics-row.component.html',
  host: { class: 'block' },
})
export class HealthMetricsMetricsRowComponent {
  public readonly items = input.required<readonly HealthMetricsMetricItem[]>();
  public readonly testId = input<string>('hm-metrics-row');

  /** Trend ink: a rise, a fall, flat or not available, and plain context. */
  protected readonly trendClasses: Record<HealthMetricsMetricTrendTone, string> = {
    up: 'text-emerald-600',
    down: 'text-red-600',
    flat: 'text-gray-400',
    context: 'text-gray-500',
  };
  protected readonly leadClasses: Record<'up' | 'down', string> = { up: 'text-emerald-600', down: 'text-red-600' };
  protected readonly itemClasses: Signal<string[]> = this.initItemClasses();

  private initItemClasses(): Signal<string[]> {
    return computed(() => {
      const count = this.items().length;
      return this.items().map((_, index) => this.itemClass(index, count));
    });
  }

  // Exact px, not rem: the design's 18/24px padding and dividers, 14/12px with a 16px divider gap on phones.
  private itemClass(index: number, count: number): string {
    const desktop = index === 0 ? 'pl-0' : 'border-l border-gray-200 pl-[24px]';
    // Phones: two per row, the second of each pair divided, rows after the first ruled, an odd last item spanning the row.
    const phoneColumn = index % 2 === 1 ? 'max-[640px]:pl-[16px]' : 'max-[640px]:border-l-0 max-[640px]:pl-0';
    const phoneRow = index >= 2 ? 'max-[640px]:border-t max-[640px]:border-gray-200' : '';
    const phoneSpan = index === count - 1 && index % 2 === 0 ? 'max-[640px]:col-span-full' : '';
    return [desktop, phoneColumn, phoneRow, phoneSpan].filter(Boolean).join(' ');
  }
}
