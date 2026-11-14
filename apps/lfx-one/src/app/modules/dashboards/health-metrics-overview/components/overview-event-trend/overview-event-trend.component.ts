// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, linkedSignal } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_TREND_COLORS,
  HEALTH_METRICS_OVERVIEW_TREND_MIN_SPAN_DAYS,
  HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewPastTrendView, buildHealthMetricsOverviewTrendView, pickHealthMetricsEventsForecastFormat } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { SkeletonModule } from 'primeng/skeleton';

import { HealthMetricsInfoTipComponent } from '../../../components/health-metrics-info-tip/health-metrics-info-tip.component';

import type {
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEventTrendReads,
  HealthMetricsOverviewTrendDrag,
  HealthMetricsOverviewTrendView,
  HealthMetricsOverviewTrendWindow,
} from '@lfx-one/shared/interfaces';

/**
 * The event dialog's Registration trend tab: the event's headline figures and this year's curve against last year's,
 * with the forecast for an upcoming event and none for a past one. It opens on the design's best fit, and a navigator
 * under the chart moves or resizes the visible span. Formats are never summed, so an event with both shows the one with
 * the most registrations. The dialog reads the data, since its header shows the same forecast's days left.
 */
@Component({
  selector: 'lfx-overview-event-trend',
  imports: [HealthMetricsInfoTipComponent, SkeletonModule, UiButtonComponent],
  templateUrl: './overview-event-trend.component.html',
  // On a phone the tab takes the dialog's height, and the chart fills what the metrics leave.
  host: { class: 'flex min-h-0 flex-auto flex-col' },
})
export class OverviewEventTrendComponent {
  public readonly event = input.required<HealthMetricsOverviewEvent>();
  public readonly isPast = input<boolean>(false);
  /** `null` until the read lands, and after it fails. */
  public readonly reads = input<HealthMetricsOverviewEventTrendReads | null>(null);
  public readonly status = input<HealthMetricsOverviewCardStatus>('loading');

  protected readonly colors = HEALTH_METRICS_OVERVIEW_TREND_COLORS;
  protected readonly windowDays = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  protected readonly minSpan = HEALTH_METRICS_OVERVIEW_TREND_MIN_SPAN_DAYS;
  /** Exact px, by metric: on a phone Current spans both rows on the left, with Predicted over Same point last year. */
  protected readonly kpiItemClasses: readonly string[] = [
    'pl-0 max-[640px]:col-start-1 max-[640px]:row-span-2 max-[640px]:row-start-1 max-[640px]:justify-between max-[640px]:py-[12px] max-[640px]:pl-0 max-[640px]:pr-[12px]',
    'border-l border-gray-200 pl-[32px] max-[640px]:col-start-2 max-[640px]:row-start-2 max-[640px]:pb-[12px] max-[640px]:pl-[16px] max-[640px]:pr-0 max-[640px]:pt-[6px]',
    'border-l border-gray-200 pl-[32px] max-[640px]:col-start-2 max-[640px]:row-start-1 max-[640px]:pb-[6px] max-[640px]:pl-[16px] max-[640px]:pr-0 max-[640px]:pt-[12px]',
  ];
  /** Current stays large on a phone, at 40px; the others drop to 16px. */
  protected readonly kpiValueClasses: readonly string[] = [
    'max-[640px]:text-[40px] max-[640px]:leading-[44px]',
    'max-[640px]:text-[16px] max-[640px]:font-normal max-[640px]:leading-[22px]',
    'max-[640px]:text-[16px] max-[640px]:font-normal max-[640px]:leading-[22px]',
  ];
  protected readonly series = computed<HealthMetricsEventsForecastCurveSeries | null>(() => {
    const formats = this.reads()?.curve.formats ?? [];
    const format = pickHealthMetricsEventsForecastFormat(formats);
    return formats.find((candidate) => candidate.format === format) ?? formats[0] ?? null;
  });
  /** The span the reader picked; `null` is the best fit, and a new series starts from it again. */
  protected readonly zoom = linkedSignal<HealthMetricsEventsForecastCurveSeries | null, HealthMetricsOverviewTrendWindow | null>({
    source: this.series,
    computation: () => null,
  });
  protected readonly view = computed<HealthMetricsOverviewTrendView>(() => {
    const reads = this.reads();
    if (this.isPast()) return buildHealthMetricsOverviewPastTrendView(this.event(), reads?.curve ?? null, this.series(), this.zoom());

    const headline = reads?.forecast?.events.find((candidate) => candidate.eventId === this.event().eventId) ?? null;
    return buildHealthMetricsOverviewTrendView(this.event(), headline, this.series(), this.zoom());
  });
  /** "Reset view" shows only once the reader has moved the span off the best fit. */
  protected readonly custom = computed(() => {
    const { window, fitWindow } = this.view();
    return window.start !== fitWindow.start || window.end !== fitWindow.end;
  });

  /** An event with no curve anywhere in the window shows a note; a span that misses the lines keeps its navigator. */
  protected readonly hasCurve = computed(() => {
    const { navigator } = this.view();
    return !!(navigator.currentPath || navigator.lastYearPath || navigator.predictedPath);
  });

  private drag: HealthMetricsOverviewTrendDrag | null = null;

  protected resetZoom(): void {
    this.zoom.set(null);
  }

  /** A press on a handle resizes the span from that side; a press inside it moves the whole span. */
  protected startDrag(kind: HealthMetricsOverviewTrendDrag['kind'], event: PointerEvent, navigator: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    this.drag = { kind, x: event.clientX, width: navigator.getBoundingClientRect().width, from: this.view().window };
  }

  protected moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.width <= 0) return;

    const days = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
    const minSpan = HEALTH_METRICS_OVERVIEW_TREND_MIN_SPAN_DAYS;
    const shift = Math.round(((event.clientX - drag.x) / drag.width) * days);
    const { start, end } = drag.from;
    if (drag.kind === 'start') {
      this.zoom.set({ start: Math.max(0, Math.min(start + shift, end - minSpan)), end });
    } else if (drag.kind === 'end') {
      this.zoom.set({ start, end: Math.min(days, Math.max(end + shift, start + minSpan)) });
    } else {
      const moved = Math.max(0, Math.min(start + shift, days - (end - start)));
      this.zoom.set({ start: moved, end: moved + (end - start) });
    }
  }

  protected endDrag(): void {
    this.drag = null;
  }

  /** The arrow keys move the span a few days at a time, for a reader without a pointer. */
  protected panBy(days: number, event: Event): void {
    event.preventDefault();
    const { start, end } = this.view().window;
    const moved = Math.max(0, Math.min(start + days, HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS - (end - start)));
    this.zoom.set({ start: moved, end: moved + (end - start) });
  }

  /** On a focused handle they move that side, keeping the span on the chart and at least the minimum wide. */
  protected resizeBy(side: 'start' | 'end', days: number, event: Event): void {
    event.preventDefault();
    const { start, end } = this.view().window;
    if (side === 'start') {
      this.zoom.set({ start: Math.max(0, Math.min(start + days, end - this.minSpan)), end });
    } else {
      this.zoom.set({ start, end: Math.min(this.windowDays, Math.max(end + days, start + this.minSpan)) });
    }
  }
}
