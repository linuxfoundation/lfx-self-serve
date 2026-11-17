// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  getYearForRange,
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_PAGE_SIZE,
  HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED,
  HEALTH_METRICS_EVENTS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsForecastNote, buildHealthMetricsEventsForecastRowViews, buildHealthMetricsEventsForecastView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsEventTrendComponent } from '../../../components/health-metrics-event-trend/health-metrics-event-trend.component';
import { HealthMetricsFootnoteComponent } from '../../../components/health-metrics-footnote/health-metrics-footnote.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsProgressCellComponent } from '../../../components/health-metrics-progress-cell/health-metrics-progress-cell.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurveQuery,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastPicker,
  HealthMetricsEventsForecastQuery,
  HealthMetricsEventsForecastRowView,
  HealthMetricsEventsForecastView,
  HealthMetricsEventTrendEvent,
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewEventTrendReads,
} from '@lfx-one/shared/interfaces';

/**
 * `#forecast` — whether each upcoming event will reach its registration goal: the picked event's metrics, verdict and
 * registration trend, then every upcoming event's pace. The event select lives in the card header, which the tab owns.
 */
@Component({
  selector: 'lfx-events-registration-forecast',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsEventTrendComponent,
    HealthMetricsFootnoteComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsProgressCellComponent,
    Skeleton,
    TableComponent,
    UiPaginationComponent,
  ],
  templateUrl: './events-registration-forecast.component.html',
})
export class EventsRegistrationForecastComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The event the reader picked in the header select; `null` until they pick one. */
  public readonly pickedEventId = input<string | null>(null);

  /** The sub-nav note ("N will miss goal"); empty while a read is pending or failed. */
  public readonly countsChange = output<string>();
  /** The header select's events and the one shown; no events in a closed period or while a read is pending. */
  public readonly pickerChange = output<HealthMetricsEventsForecastPicker>();
  /**
   * Fires once the section settles, `true` when the foundation has no upcoming event; its height changes, moving
   * every anchor below. A closed period gives no verdict, so its own note stands and the tab can go blank without it.
   */
  public readonly settled = output<boolean | null>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The event a deep link named, which stands until the reader picks another. */
  private readonly linkedEventId = this.route.snapshot.queryParamMap.get(HEALTH_METRICS_EVENTS_QUERY_PARAMS.forecastEvent);

  protected readonly pageSize = HEALTH_METRICS_EVENTS_FORECAST_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly curveLoading = signal<boolean>(true);
  protected readonly curveFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEventsForecastQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  /** The model is a snapshot of now, so a completed year has nothing left to forecast. */
  protected readonly closedPeriod = computed(() => this.chrome.selectedRange() !== 'YTD');
  /** No upcoming event to forecast; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.closedPeriod() && !this.loading() && !this.loadFailed() && this.response().events.length === 0);
  protected readonly response: Signal<HealthMetricsEventsForecast> = this.initResponse();

  protected readonly closedTitle = computed(() => `${getYearForRange(this.chrome.selectedRange())} is a closed period`);

  /** A picked or linked event that is no longer upcoming falls back to the soonest one. */
  protected readonly selectedEvent = computed<HealthMetricsEventsForecastEvent | null>(() => {
    const events = this.response().events;
    const wanted = this.pickedEventId() ?? this.linkedEventId;
    return events.find((event) => event.eventId === wanted) ?? events[0] ?? null;
  });
  protected readonly view = computed<HealthMetricsEventsForecastView | null>(() => {
    const event = this.selectedEvent();
    return event ? buildHealthMetricsEventsForecastView(event) : null;
  });

  /** With no forecast, Predicted reads "—" and the chart shows its empty message, so no curve is read. */
  protected readonly noForecast = computed(() => this.selectedEvent()?.forecastAvg === null);

  protected readonly curveQuery: Signal<HealthMetricsEventsForecastCurveQuery> = computed(() => ({
    foundationSlug: this.query().foundationSlug,
    eventId: this.noForecast() ? '' : (this.selectedEvent()?.eventId ?? ''),
  }));
  protected readonly curve: Signal<HealthMetricsEventsForecastCurve> = this.initCurve();

  // The registration trend takes the Overview event dialog's inputs.
  protected readonly trendEvent = computed<HealthMetricsEventTrendEvent | null>(() => {
    const event = this.selectedEvent();
    return event ? { eventId: event.eventId, registrations: event.registrationsNow, registrationsGoal: event.goal } : null;
  });
  protected readonly trendReads = computed<HealthMetricsOverviewEventTrendReads>(() => ({ forecast: this.response(), curve: this.curve() }));
  protected readonly trendStatus = computed<HealthMetricsOverviewCardStatus>(() => {
    if (this.curveLoading()) return 'loading';
    return this.curveFailed() ? 'failed' : 'ready';
  });

  protected readonly rowViews: Signal<HealthMetricsEventsForecastRowView[]> = computed(() => buildHealthMetricsEventsForecastRowViews(this.response().events));
  /** A new read starts the table on its first page. */
  protected readonly page = linkedSignal<HealthMetricsEventsForecast, number>({ source: this.response, computation: () => 0 });
  protected readonly pageRows = computed(() => this.rowViews().slice(this.page() * this.pageSize, (this.page() + 1) * this.pageSize));

  private readonly picker = computed<HealthMetricsEventsForecastPicker>(() => {
    const showing = !this.closedPeriod() && !this.loading() && !this.loadFailed();
    return {
      options: showing ? this.response().events.map((event) => ({ eventId: event.eventId, label: event.eventName })) : [],
      eventId: showing ? (this.selectedEvent()?.eventId ?? null) : null,
    };
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.picker)
        .pipe(takeUntilDestroyed())
        .subscribe((picker) => this.pickerChange.emit(picker));
      // Only a pick is written back: the URL keeps naming a deep link's event until the reader picks another.
      toObservable(this.pickedEventId)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe((eventId) => this.syncUrl(eventId));
    }
  }

  private initResponse(): Signal<HealthMetricsEventsForecast> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    // A closed period reads nothing, so its sub-nav note cannot count misses the section hides.
    const request = computed(() => ({ query: this.query(), closed: this.closedPeriod() }));

    return toSignal(
      toObservable(request).pipe(
        distinctUntilChanged((a, b) => a.query.foundationSlug === b.query.foundationSlug && a.closed === b.closed),
        tap(({ query }) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.countsChange.emit('');
          this.reading.emit();
        }),
        switchMap(({ query, closed }) =>
          (query.foundationSlug && !closed ? this.analyticsService.getEventsRegistrationForecast(query) : of(HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              this.countsChange.emit(this.loadFailed() ? '' : buildHealthMetricsEventsForecastNote(response.events));
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(closed ? null : !this.loadFailed() && response.events.length === 0);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED }
    );
  }

  private initCurve(): Signal<HealthMetricsEventsForecastCurve> {
    if (!isPlatformBrowser(this.platformId)) {
      return computed(() => HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED);
    }

    return toSignal(
      toObservable(this.curveQuery).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug && a.eventId === b.eventId),
        tap(() => {
          this.curveLoading.set(true);
          this.curveFailed.set(false);
        }),
        switchMap((query) =>
          (query.foundationSlug && query.eventId
            ? this.analyticsService.getEventsRegistrationForecastCurve(query)
            : of(HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED)
          ).pipe(
            catchError(() => {
              this.curveFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED);
            }),
            tap(() => this.curveLoading.set(false))
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED }
    );
  }

  private syncUrl(eventId: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [HEALTH_METRICS_EVENTS_QUERY_PARAMS.forecastEvent]: eventId },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }
}
