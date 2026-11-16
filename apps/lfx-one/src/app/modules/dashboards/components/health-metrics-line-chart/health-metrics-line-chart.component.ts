// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, input, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HEALTH_METRICS_LINE_CHART_LABEL_MIN_PX, HEALTH_METRICS_LINE_CHART_VIEW_WIDTH } from '@lfx-one/shared/constants';
import { distinctUntilChanged, EMPTY, Observable, switchMap } from 'rxjs';

import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsLineChartTickView, HealthMetricsLineChartView } from '@lfx-one/shared/interfaces';

/**
 * The design's line chart: y labels beside light quarter rules, straight lines with a soft fill under the first filled
 * series, hollow dots, and one hover or focus column per x position that draws a guide and opens the chart popup.
 */
@Component({
  selector: 'lfx-health-metrics-line-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-line-chart.component.html',
  // Escape closes the popup however it opened, since hovering a column does not focus it.
  host: { class: 'block', '(document:keydown.escape)': 'activeIndex.set(null)' },
})
export class HealthMetricsLineChartComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly chart = input.required<HealthMetricsLineChartView>();
  public readonly testId = input<string>('health-metrics-line-chart');

  protected readonly viewWidth = HEALTH_METRICS_LINE_CHART_VIEW_WIDTH;
  /** Unique per chart, so two charts on a page never share a fill. */
  protected readonly gradientId = inject(_IdGenerator).getId('health-metrics-line-chart-area-');
  protected readonly gradientFill = `url(#${this.gradientId})`;
  protected readonly activeIndex = signal<number | null>(null);
  /** The popup opens 12px right of its point, or left of it in the chart's right half, so it stays over the plot. */
  protected readonly tipPlacement = computed(() => {
    const index = this.activeIndex();
    const column = index === null ? undefined : this.chart().columns[index];
    if (index === null || !column) return null;
    if (index >= this.chart().columns.length / 2) return { left: null, right: `calc(${100 - column.pointOffsetPct}% + 12px)` };
    return { left: `calc(${column.pointOffsetPct}% + 12px)`, right: null };
  });

  private readonly plot = viewChild<ElementRef<HTMLElement>>('plot');
  /** `null` until measured, so the first paint keeps to the month labels, which crowd least. */
  private readonly plotWidthPx: Signal<number | null> = this.initPlotWidth();
  protected readonly ticks: Signal<HealthMetricsLineChartTickView[]> = this.initTicks();

  protected onEnter(index: number): void {
    this.activeIndex.set(index);
  }

  protected onLeave(index: number): void {
    if (this.activeIndex() === index) this.activeIndex.set(null);
  }

  /** Watches the plot's width while it is on the page; the server never measures it. */
  private initPlotWidth(): Signal<number | null> {
    if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return signal(null);
    return toSignal(
      toObservable(this.plot).pipe(
        distinctUntilChanged(),
        switchMap((plot) => (plot ? observeWidth(plot.nativeElement) : EMPTY))
      ),
      { initialValue: null }
    );
  }

  /** Every point's label when they sit far enough apart, or else the first of each month, skipping any that would crowd the one before it. */
  private initTicks(): Signal<HealthMetricsLineChartTickView[]> {
    return computed(() => {
      const chart = this.chart();
      const width = this.plotWidthPx();
      if (width === null) return chart.monthTicks;
      if (width / Math.max(1, chart.ticks.length - 1) >= HEALTH_METRICS_LINE_CHART_LABEL_MIN_PX) return chart.ticks;

      const kept: HealthMetricsLineChartTickView[] = [];
      for (const tick of chart.monthTicks) {
        const previous = kept.at(-1);
        const apartPx = previous ? ((tick.leftPct - previous.leftPct) / 100) * width : Infinity;
        if (apartPx >= HEALTH_METRICS_LINE_CHART_LABEL_MIN_PX) kept.push(tick);
      }
      return kept;
    });
  }
}

function observeWidth(element: HTMLElement): Observable<number> {
  return new Observable<number>((subscriber) => {
    const observer = new ResizeObserver(([entry]) => subscriber.next(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  });
}
