// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { placeHealthMetricsChartTip } from '@lfx-one/shared/utils';

import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsBarChartView, HealthMetricsLineChartTipPlacement } from '@lfx-one/shared/interfaces';

/**
 * The design's bar chart: y labels beside light quarter rules, one bar per point with its value above it, an optional
 * dashed line with dots over the bars, and a hover or focus on a bar that tints it and opens the chart popup beside it.
 */
@Component({
  selector: 'lfx-health-metrics-bar-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-bar-chart.component.html',
  // Escape closes the popup however it opened, since hovering a bar does not focus it; a resize re-places an open one.
  host: { class: 'block', '(document:keydown.escape)': 'closeTip()', '(window:resize)': 'replaceTip()' },
})
export class HealthMetricsBarChartComponent {
  public readonly chart = input.required<HealthMetricsBarChartView>();
  public readonly testId = input<string>('health-metrics-bar-chart');

  protected readonly activeIndex = signal<number | null>(null);
  protected readonly tipPlacement = signal<HealthMetricsLineChartTipPlacement | null>(null);
  /** The open bar, kept so a resize can place its popup again. */
  private activeBar: HTMLElement | null = null;

  protected onEnter(index: number, event: Event): void {
    this.activeBar = event.currentTarget as HTMLElement;
    this.activeIndex.set(index);
    this.tipPlacement.set(this.placeTip(this.activeBar));
  }

  protected onLeave(index: number): void {
    if (this.activeIndex() === index) this.closeTip();
  }

  /** Closes the popup and forgets its bar, so nothing still points at a bar once it is closed. */
  protected closeTip(): void {
    this.activeIndex.set(null);
    this.activeBar = null;
  }

  protected replaceTip(): void {
    if (this.activeIndex() !== null && this.activeBar) this.tipPlacement.set(this.placeTip(this.activeBar));
  }

  /** Beside the bar's centre, as the design places it; see `placeHealthMetricsChartTip`. */
  private placeTip(bar: HTMLElement): HealthMetricsLineChartTipPlacement {
    const box = bar.getBoundingClientRect();
    return placeHealthMetricsChartTip(50, box.left + box.width / 2, document.documentElement.clientWidth);
  }
}
