// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, linkedSignal } from '@angular/core';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
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
  FilterPillOption,
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
 * under the chart moves or resizes the visible span. Formats are never summed, so an event with both picks one. The
 * dialog reads the data, since its header shows the same forecast's days left.
 */
@Component({
  selector: 'lfx-overview-event-trend',
  imports: [FilterPillsComponent, HealthMetricsInfoTipComponent, SkeletonModule, UiButtonComponent],
  templateUrl: './overview-event-trend.component.html',
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
  protected readonly format = linkedSignal<string | null>(() => pickHealthMetricsEventsForecastFormat(this.reads()?.curve.formats ?? []));
  protected readonly formatOptions = computed<FilterPillOption[]>(() => {
    const formats = this.reads()?.curve.formats ?? [];
    return formats.length > 1 ? formats.map((series) => ({ id: series.format, label: series.format })) : [];
  });
  protected readonly series = computed<HealthMetricsEventsForecastCurveSeries | null>(() => {
    const formats = this.reads()?.curve.formats ?? [];
    return formats.find((candidate) => candidate.format === this.format()) ?? formats[0] ?? null;
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
