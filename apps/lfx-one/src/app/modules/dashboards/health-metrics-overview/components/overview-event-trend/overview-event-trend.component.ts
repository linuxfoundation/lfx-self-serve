// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, linkedSignal } from '@angular/core';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { HEALTH_METRICS_OVERVIEW_FILL_CLASSES, HEALTH_METRICS_OVERVIEW_PROGRESS_TINT, HEALTH_METRICS_OVERVIEW_STROKES } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewPastTrendView, buildHealthMetricsOverviewTrendView, pickHealthMetricsEventsForecastFormat } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';

import type {
  FilterPillOption,
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEventTrendReads,
  HealthMetricsOverviewTrendView,
} from '@lfx-one/shared/interfaces';

/**
 * The event dialog's Registration trend tab: the event's headline figures and this year's curve against last year's,
 * with the forecast for an upcoming event and none for a past one. Formats are never summed, so an event with both
 * picks one. The dialog reads the data, since its header shows the same forecast's days left.
 */
@Component({
  selector: 'lfx-overview-event-trend',
  imports: [FilterPillsComponent, SkeletonModule],
  templateUrl: './overview-event-trend.component.html',
})
export class OverviewEventTrendComponent {
  public readonly event = input.required<HealthMetricsOverviewEvent>();
  public readonly isPast = input<boolean>(false);
  /** `null` until the read lands, and after it fails. */
  public readonly reads = input<HealthMetricsOverviewEventTrendReads | null>(null);
  public readonly status = input<HealthMetricsOverviewCardStatus>('loading');

  protected readonly strokes = HEALTH_METRICS_OVERVIEW_STROKES;
  protected readonly bandFill = HEALTH_METRICS_OVERVIEW_PROGRESS_TINT;
  protected readonly thisYearClass = HEALTH_METRICS_OVERVIEW_FILL_CLASSES.purple;
  protected readonly format = linkedSignal<string | null>(() => pickHealthMetricsEventsForecastFormat(this.reads()?.curve.formats ?? []));
  protected readonly formatOptions = computed<FilterPillOption[]>(() => {
    const formats = this.reads()?.curve.formats ?? [];
    return formats.length > 1 ? formats.map((series) => ({ id: series.format, label: series.format })) : [];
  });
  protected readonly view = computed<HealthMetricsOverviewTrendView>(() => {
    const reads = this.reads();
    const formats = reads?.curve.formats ?? [];
    const series = formats.find((candidate) => candidate.format === this.format()) ?? formats[0] ?? null;
    if (this.isPast()) return buildHealthMetricsOverviewPastTrendView(this.event(), reads?.curve ?? null, series);

    const headline = reads?.forecast?.events.find((candidate) => candidate.eventId === this.event().eventId) ?? null;
    return buildHealthMetricsOverviewTrendView(this.event(), headline, series);
  });

  /** An event the view holds no curve for shows a note in place of an empty chart. */
  protected readonly hasCurve = computed(() => {
    const view = this.view();
    return !!(view.currentPath || view.lastYearPath || view.predictedPath);
  });
}
