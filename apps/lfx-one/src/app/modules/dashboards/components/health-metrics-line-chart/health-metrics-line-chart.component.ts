// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, input, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HEALTH_METRICS_LINE_CHART_LABEL_MIN_PX, HEALTH_METRICS_LINE_CHART_VIEW_WIDTH } from '@lfx-one/shared/constants';
import { placeHealthMetricsChartTip } from '@lfx-one/shared/utils';
import { distinctUntilChanged, EMPTY, Observable, switchMap } from 'rxjs';

import { HealthMetricsChartTipComponent } from '../health-metrics-chart-tip/health-metrics-chart-tip.component';

import type { HealthMetricsLineChartTickView, HealthMetricsLineChartTipPlacement, HealthMetricsLineChartView } from '@lfx-one/shared/interfaces';

/**
 * The design's line chart: y labels beside light quarter rules, straight lines with a soft fill under the first filled
 * series, hollow dots, and one hover or focus column per x position that draws a guide and opens the chart popup.
 */
@Component({
  selector: 'lfx-health-metrics-line-chart',
  imports: [HealthMetricsChartTipComponent],
  templateUrl: './health-metrics-line-chart.component.html',
  // Escape closes the popup however it opened, since hovering a column does not focus it; a resize re-places an open one.
  host: { class: 'block', '(document:keydown.escape)': 'activeIndex.set(null)', '(window:resize)': 'replaceTip()' },
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
  protected readonly tipPlacement = signal<HealthMetricsLineChartTipPlacement | null>(null);
  /** The open column, kept so a resize can place its popup again. */
  private activeColumn: HTMLElement | null = null;

  private readonly plot = viewChild<ElementRef<HTMLElement>>('plot');
  /** `null` until measured, so the first paint keeps to the month labels, which crowd least. */
  private readonly plotWidthPx: Signal<number | null> = this.initPlotWidth();
  protected readonly ticks: Signal<HealthMetricsLineChartTickView[]> = this.initTicks();

  protected onEnter(index: number, event: Event): void {
    this.activeColumn = event.currentTarget as HTMLElement;
    this.activeIndex.set(index);
    this.tipPlacement.set(this.placeTip(index, this.activeColumn));
  }

  protected onLeave(index: number): void {
    if (this.activeIndex() !== index) return;
    this.activeIndex.set(null);
    this.activeColumn = null;
  }

  protected replaceTip(): void {
    const index = this.activeIndex();
    if (index !== null && this.activeColumn) this.tipPlacement.set(this.placeTip(index, this.activeColumn));
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

  /** Beside the point, as the design places it; see `placeHealthMetricsChartTip`. */
  private placeTip(index: number, element: HTMLElement): HealthMetricsLineChartTipPlacement {
    const offset = this.chart().columns[index]?.pointOffsetPct ?? 50;
    const column = element.getBoundingClientRect();
    return placeHealthMetricsChartTip(offset, column.left + (column.width * offset) / 100, document.documentElement.clientWidth);
  }
}

function observeWidth(element: HTMLElement): Observable<number> {
  return new Observable<number>((subscriber) => {
    const observer = new ResizeObserver(([entry]) => subscriber.next(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  });
}
