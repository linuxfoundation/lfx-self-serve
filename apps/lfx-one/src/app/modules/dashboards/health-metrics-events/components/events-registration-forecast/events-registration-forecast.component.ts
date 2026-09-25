// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import {
  getYearForRange,
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_HIDDEN_LEGEND_LABELS,
  HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED,
  HEALTH_METRICS_EVENTS_QUERY_PARAMS,
  lfxColors,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEventsForecastNote,
  buildHealthMetricsEventsForecastRowViews,
  filterHealthMetricsEventsForecastable,
  formatHealthMetricsEventsCount,
  formatIsoDateLabel,
  formatNumber,
  hexToRgba,
  isHealthMetricsEventsForecastGoalSuspect,
  pickHealthMetricsEventsForecastFormat,
  resolveHealthMetricsEventsForecastVerdict,
  truncateHealthMetricsEventsPillName,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurveQuery,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastQuery,
} from '@lfx-one/shared/interfaces';

/**
 * `#forecast` — where each upcoming event's registrations will land against its goal. The headline
 * is event-wide; the chart plots one registration format at a time, since the model never sums them.
 */
@Component({
  selector: 'lfx-events-registration-forecast',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './events-registration-forecast.component.html',
})
export class EventsRegistrationForecastComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav note ("N will miss goal"); empty while a read is pending or failed. */
  public readonly countsChange = output<string>();
  /** Fires once the event list settles — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly curveLoading = signal<boolean>(true);
  protected readonly curveFailed = signal<boolean>(false);
  /** The event the reader picked, or the one the URL named; resolved against the list below. */
  protected readonly pickedEventId = signal<string | null>(this.initialParams.get(HEALTH_METRICS_EVENTS_QUERY_PARAMS.forecastEvent));

  protected readonly query: Signal<HealthMetricsEventsForecastQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  /** The model is a snapshot of now, so a completed year has nothing left to forecast. */
  protected readonly closedPeriod = computed(() => this.chrome.selectedRange() !== 'YTD');
  protected readonly response: Signal<HealthMetricsEventsForecast> = this.initResponse();

  protected readonly closedTitle = computed(() => `${getYearForRange(this.chrome.selectedRange())} is a closed period`);

  protected readonly forecastable = computed(() => filterHealthMetricsEventsForecastable(this.response().events));
  protected readonly eventOptions = computed<FilterPillOption[]>(() =>
    this.forecastable().map((event) => {
      // The date is in the accessible name too, so same-named editions stay distinct to a screen reader.
      const dateLabel = event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—';
      return {
        id: event.eventId,
        label: `${truncateHealthMetricsEventsPillName(event.eventName)} · ${dateLabel}`,
        fullLabel: `${event.eventName} · ${dateLabel}`,
      };
    })
  );
  /** A deep link to an event that is no longer upcoming falls back to the soonest one. */
  protected readonly selectedEvent = computed<HealthMetricsEventsForecastEvent | null>(() => {
    const events = this.forecastable();
    return events.find((event) => event.eventId === this.pickedEventId()) ?? events[0] ?? null;
  });

  protected readonly curveQuery: Signal<HealthMetricsEventsForecastCurveQuery> = computed(() => ({
    foundationSlug: this.query().foundationSlug,
    eventId: this.selectedEvent()?.eventId ?? '',
  }));
  protected readonly curve: Signal<HealthMetricsEventsForecastCurve> = this.initCurve();

  /** Resets to the format with more registrations whenever a new curve lands. */
  protected readonly format = linkedSignal<HealthMetricsEventsForecastCurve, string | null>({
    source: this.curve,
    computation: (curve) => pickHealthMetricsEventsForecastFormat(curve.formats),
  });
  protected readonly formatOptions = computed<FilterPillOption[]>(() =>
    this.curve().formats.length > 1 ? this.curve().formats.map((series) => ({ id: series.format, label: series.format })) : []
  );
  protected readonly series = computed<HealthMetricsEventsForecastCurveSeries | null>(() => {
    const formats = this.curve().formats;
    return formats.find((series) => series.format === this.format()) ?? formats[0] ?? null;
  });

  protected readonly verdict = computed(() => {
    const event = this.selectedEvent();
    return event ? resolveHealthMetricsEventsForecastVerdict(event) : null;
  });
  // Every label the template shows, resolved once per selection so change detection formats nothing.
  protected readonly forecastLabel = computed(() => formatHealthMetricsEventsCount(this.selectedEvent()?.forecastAvg ?? null));
  protected readonly rangeLabel = computed(() => {
    const event = this.selectedEvent();
    if (!event || event.forecastLow === null || event.forecastHigh === null) return '';

    return `${formatHealthMetricsEventsCount(event.forecastLow)}–${formatHealthMetricsEventsCount(event.forecastHigh)}`;
  });
  protected readonly nowLabel = computed(() => formatHealthMetricsEventsCount(this.selectedEvent()?.registrationsNow ?? null));
  protected readonly lastYearLabel = computed(() => {
    const event = this.selectedEvent();
    return event?.isNewEvent ? 'first edition' : formatHealthMetricsEventsCount(event?.priorYearSamePoint ?? null);
  });
  protected readonly goalLabel = computed(() => {
    const goal = this.selectedEvent()?.goal ?? null;
    return goal === null || goal <= 0 ? 'not set' : formatHealthMetricsEventsCount(goal);
  });
  protected readonly daysLeftLabel = computed(() => formatHealthMetricsEventsCount(this.selectedEvent()?.daysLeft ?? null));
  protected readonly gapLabel = computed(() => formatHealthMetricsEventsCount(this.verdict()?.gap ?? null));
  protected readonly ratioLabel = computed(() => (this.verdict()?.ratio ?? 0).toFixed(1));
  /** A mis-entered goal can sit far above the forecast or far below it; the copy names which. */
  protected readonly goalSuspectAbove = computed(() => (this.verdict()?.ratio ?? 0) >= 1);
  protected readonly verdictClass = computed(() => {
    switch (this.verdict()?.tone) {
      case 'ok':
        return 'border-emerald-200 bg-emerald-50 text-emerald-800';
      case 'watch':
        return 'border-amber-200 bg-amber-50 text-amber-800';
      case 'act':
        return 'border-red-200 bg-red-50 text-red-800';
      default:
        return 'border-gray-200 bg-gray-50 text-gray-700';
    }
  });

  protected readonly rowViews = computed(() => buildHealthMetricsEventsForecastRowViews(this.response().events));

  protected readonly chartData: Signal<ChartData<'line'>> = computed(() => this.buildChart());
  protected readonly chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: lfxColors.gray[500],
          font: { size: 11 },
          filter: (item) => !HEALTH_METRICS_EVENTS_FORECAST_HIDDEN_LEGEND_LABELS.includes(item.text),
        },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          // Rounded to match the headline; a null point has nothing to label, so its row is dropped.
          label: (item) => (item.parsed.y === null ? '' : `${item.dataset.label}: ${formatNumber(Math.round(item.parsed.y))}`),
        },
      },
    },
    scales: {
      // A category axis renders in array order, and the read returns days ascending to 0 on the right.
      x: {
        title: { display: true, text: 'Days to event', color: lfxColors.gray[400], font: { size: 10 } },
        grid: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 }, maxTicksLimit: 8 },
      },
      y: {
        beginAtZero: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 } },
      },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.3, borderWidth: 2 } },
  };

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // `skip(1)` drops the id just read out of the URL — writing it back would be a no-op navigation.
      toObservable(this.pickedEventId)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe((eventId) => this.syncUrl(eventId));
    }
  }

  protected onEventChange(eventId: string): void {
    this.pickedEventId.set(eventId);
  }

  protected onFormatChange(format: string): void {
    this.format.set(format);
  }

  /** The L2 shell scrolls to a section from the URL fragment, so the link only sets it. */
  protected onViewPastEvents(): void {
    void this.router.navigate([], { relativeTo: this.route, fragment: 'past', queryParamsHandling: 'preserve' });
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
              if (foundationSeen) this.settled.emit();
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

  private buildChart(): ChartData<'line'> {
    const points = this.series()?.points ?? [];
    const event = this.selectedEvent();
    const goal = event && event.goal !== null && event.goal > 0 && !isHealthMetricsEventsForecastGoalSuspect(event) ? event.goal : null;
    // Today is the last measured day; the model's `pred_type` draws that line, not the days-left count.
    const todayIndex = points.map((point) => point.actual !== null).lastIndexOf(true);
    const showLastYear = !event?.isNewEvent && points.some((point) => point.priorYear !== null);

    return {
      labels: points.map((point) => point.daysToEvent),
      datasets: [
        // The band's ceiling fills down to its floor, so it is drawn first and the lines sit on top.
        {
          label: 'Confidence range',
          data: points.map((point) => point.forecastHigh),
          borderColor: 'transparent',
          backgroundColor: hexToRgba(lfxColors.violet[500], 0.08),
          pointRadius: 0,
          fill: '+1',
        },
        {
          label: 'Forecast low',
          data: points.map((point) => point.forecastLow),
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          pointRadius: 0,
          fill: false,
        },
        { label: 'This year', data: points.map((point) => point.actual), borderColor: lfxColors.blue[500], backgroundColor: 'transparent', spanGaps: false },
        ...(showLastYear
          ? [
              {
                label: 'Last year',
                data: points.map((point) => point.priorYear),
                borderColor: lfxColors.gray[400],
                backgroundColor: 'transparent',
                borderDash: [4, 4],
              },
            ]
          : []),
        {
          label: 'Forecast',
          data: points.map((point) => point.forecastAvg),
          borderColor: lfxColors.violet[500],
          backgroundColor: 'transparent',
          borderDash: [6, 4],
        },
        ...(goal === null
          ? []
          : [
              {
                label: 'Goal',
                data: points.map(() => goal),
                borderColor: lfxColors.red[500],
                backgroundColor: 'transparent',
                borderDash: [2, 3],
                borderWidth: 1,
              },
            ]),
        // No annotation plugin is loaded, so today is a lone point on the measured line.
        {
          label: 'Today',
          data: points.map((point, index) => (index === todayIndex ? point.actual : null)),
          borderColor: lfxColors.blue[500],
          backgroundColor: lfxColors.blue[500],
          pointRadius: 4,
          showLine: false,
        },
      ],
    };
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
