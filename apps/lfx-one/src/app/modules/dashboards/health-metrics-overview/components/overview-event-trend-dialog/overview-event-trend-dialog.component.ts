// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, ElementRef, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { HEALTH_METRICS_OVERVIEW_FILL_CLASSES, HEALTH_METRICS_OVERVIEW_STROKES, HEALTH_METRICS_OVERVIEW_TREND_BAND_FILL } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewEventMeta, buildHealthMetricsOverviewTrendView, pickHealthMetricsEventsForecastFormat } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, forkJoin, of, tap } from 'rxjs';

import type {
  FilterPillOption,
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewTrendDialogData,
  HealthMetricsOverviewTrendView,
} from '@lfx-one/shared/interfaces';

/**
 * The design's registration trend for one upcoming event, opened through `DialogService`: its headline figures and
 * this year's curve against last year's and the forecast. Formats are never summed, so an event with both picks one.
 */
@Component({
  selector: 'lfx-overview-event-trend-dialog',
  imports: [FilterPillsComponent, SkeletonModule],
  templateUrl: './overview-event-trend-dialog.component.html',
})
export class OverviewEventTrendDialogComponent {
  /** Names the dialog; see `nameDynamicDialog`. */
  public static readonly headingId = 'overview-trend-title';

  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<HealthMetricsOverviewTrendDialogData>);

  protected readonly event = this.dialogConfig.data!.event;
  protected readonly headingId = OverviewEventTrendDialogComponent.headingId;
  protected readonly strokes = HEALTH_METRICS_OVERVIEW_STROKES;
  protected readonly bandFill = HEALTH_METRICS_OVERVIEW_TREND_BAND_FILL;
  protected readonly thisYearClass = HEALTH_METRICS_OVERVIEW_FILL_CLASSES.purple;
  protected readonly meta = buildHealthMetricsOverviewEventMeta(this.event);
  protected readonly status = signal<HealthMetricsOverviewCardStatus>('loading');
  private readonly reads = this.initReads();
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  protected readonly format = linkedSignal<string | null>(() => pickHealthMetricsEventsForecastFormat(this.reads()?.curve.formats ?? []));
  protected readonly formatOptions = computed<FilterPillOption[]>(() => {
    const formats = this.reads()?.curve.formats ?? [];
    return formats.length > 1 ? formats.map((series) => ({ id: series.format, label: series.format })) : [];
  });
  protected readonly view = computed<HealthMetricsOverviewTrendView>(() => {
    const reads = this.reads();
    const headline = reads?.forecast.events.find((candidate) => candidate.eventId === this.event.eventId) ?? null;
    const formats = reads?.curve.formats ?? [];
    const series = formats.find((candidate) => candidate.format === this.format()) ?? formats[0] ?? null;
    return buildHealthMetricsOverviewTrendView(this.event, headline, series);
  });

  public constructor() {
    // The title takes focus, so a screen reader names the event and no ring lands on the close button.
    afterNextRender(() => this.heading().nativeElement.focus());
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /** Headline and curve for the event; a failed read leaves the dialog to say so instead of drawing nothing. */
  private initReads() {
    const foundationSlug = this.projectContextService.selectedFoundation()?.slug ?? '';
    return toSignal<{ forecast: HealthMetricsEventsForecast; curve: HealthMetricsEventsForecastCurve } | null>(
      forkJoin({
        forecast: this.analyticsService.getEventsRegistrationForecast({ foundationSlug }),
        curve: this.analyticsService.getEventsRegistrationForecastCurve({ foundationSlug, eventId: this.event.eventId }),
      }).pipe(
        tap(() => this.status.set('ready')),
        catchError(() => {
          this.status.set('failed');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }
}
