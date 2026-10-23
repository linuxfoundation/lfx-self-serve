// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { A11yModule } from '@angular/cdk/a11y';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { buildHealthMetricsOverviewEventMeta, buildHealthMetricsOverviewTrendView, pickHealthMetricsEventsForecastFormat } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, forkJoin, of, switchMap, tap } from 'rxjs';

import type {
  FilterPillOption,
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewTrendView,
} from '@lfx-one/shared/interfaces';

/**
 * The design's registration trend for one upcoming event: its headline figures and this year's curve against last
 * year's and the forecast. Formats are never summed, so an event with both picks one, opening on the larger.
 */
@Component({
  selector: 'lfx-overview-event-trend-dialog',
  imports: [A11yModule, FilterPillsComponent, SkeletonModule],
  templateUrl: './overview-event-trend-dialog.component.html',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class OverviewEventTrendDialogComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly event = input.required<HealthMetricsOverviewEvent>();
  public readonly closed = output<void>();

  protected readonly status = signal<HealthMetricsOverviewCardStatus>('loading');
  protected readonly meta = computed(() => buildHealthMetricsOverviewEventMeta(this.event()));
  protected readonly titleId = computed(() => `overview-trend-title-${this.event().eventId}`);
  private readonly reads = this.initReads();
  protected readonly format = linkedSignal<string | null>(() => pickHealthMetricsEventsForecastFormat(this.reads()?.curve.formats ?? []));
  protected readonly formatOptions = computed<FilterPillOption[]>(() => {
    const formats = this.reads()?.curve.formats ?? [];
    return formats.length > 1 ? formats.map((series) => ({ id: series.format, label: series.format })) : [];
  });
  protected readonly view = computed<HealthMetricsOverviewTrendView>(() => {
    const reads = this.reads();
    const headline = reads?.forecast.events.find((candidate) => candidate.eventId === this.event().eventId) ?? null;
    const formats = reads?.curve.formats ?? [];
    const series = formats.find((candidate) => candidate.format === this.format()) ?? formats[0] ?? null;
    return buildHealthMetricsOverviewTrendView(this.event(), headline, series);
  });

  /** Headline and curve for the event; a failed read leaves the dialog to say so instead of drawing nothing. */
  private initReads() {
    return toSignal<{ forecast: HealthMetricsEventsForecast; curve: HealthMetricsEventsForecastCurve } | null>(
      toObservable(computed(() => ({ eventId: this.event().eventId, foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '' }))).pipe(
        tap(() => this.status.set('loading')),
        switchMap(({ eventId, foundationSlug }) =>
          forkJoin({
            forecast: this.analyticsService.getEventsRegistrationForecast({ foundationSlug }),
            curve: this.analyticsService.getEventsRegistrationForecastCurve({ foundationSlug, eventId }),
          }).pipe(
            tap(() => this.status.set('ready')),
            catchError(() => {
              this.status.set('failed');
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }
}
