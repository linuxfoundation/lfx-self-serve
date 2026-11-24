// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { placeHealthMetricsChartTip } from '@lfx-one/shared/utils';

import type { HealthMetricsLineChartTipPlacement } from '@lfx-one/shared/interfaces';

/**
 * The chart popup's open column and placement, shared by the column and bar charts. A host binds Escape to `close()`
 * and a window resize to `replace()`, since hovering a column does not focus it.
 */
export class HealthMetricsChartTipState {
  public readonly activeIndex = signal<number | null>(null);
  public readonly placement = signal<HealthMetricsLineChartTipPlacement | null>(null);
  /** The open column, kept so a resize can place its popup again. */
  private anchor: HTMLElement | null = null;

  public enter(index: number, event: Event): void {
    this.anchor = event.currentTarget as HTMLElement;
    this.activeIndex.set(index);
    this.placement.set(this.place(this.anchor));
  }

  public leave(index: number): void {
    if (this.activeIndex() === index) this.close();
  }

  /** Closes the popup and forgets its column, so nothing still points at a column once it is closed. */
  public close(): void {
    this.activeIndex.set(null);
    this.anchor = null;
  }

  public replace(): void {
    if (this.activeIndex() !== null && this.anchor) this.placement.set(this.place(this.anchor));
  }

  /** Beside the column's centre, as the design places it; see `placeHealthMetricsChartTip`. */
  private place(column: HTMLElement): HealthMetricsLineChartTipPlacement {
    const box = column.getBoundingClientRect();
    return placeHealthMetricsChartTip(50, box.left + box.width / 2, document.documentElement.clientWidth);
  }
}
