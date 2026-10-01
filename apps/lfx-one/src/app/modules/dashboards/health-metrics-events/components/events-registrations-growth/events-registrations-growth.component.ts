// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED,
  lfxColors,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsRegistrationsGrowthView, formatHealthMetricsEventsCount, hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthMetric,
  HealthMetricsEventsRegistrationsGrowthQuery,
  HealthMetricsEventsRegistrationsGrowthRowView,
  HealthMetricsEventsRegistrationsGrowthView,
  HealthMetricsEventsSectionKey,
} from '@lfx-one/shared/interfaces';

/**
 * `#reg` — registrations or attendees by year, split in-person versus virtual. The section is not
 * period-scoped: it always shows the foundation's full history, so the period pill never re-reads it.
 */
@Component({
  selector: 'lfx-events-registrations-growth',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './events-registrations-growth.component.html',
})
export class EventsRegistrationsGrowthComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the years settle — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();
  /** The cross-link to the forecast; the L2 shell owns scrolling, so a repeat click still lands. */
  public readonly sectionPicked = output<HealthMetricsEventsSectionKey>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly metric = signal<HealthMetricsEventsRegistrationsGrowthMetric>(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS[0].id);
  protected readonly metricOptions: FilterPillOption[] = [...HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS];

  protected readonly query: Signal<HealthMetricsEventsRegistrationsGrowthQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsRegistrationsGrowth> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEventsRegistrationsGrowthView> = computed(() =>
    buildHealthMetricsEventsRegistrationsGrowthView(this.response(), this.metric())
  );

  protected readonly yearCountLabel = computed(() => `${this.view().yearCount} ${this.view().yearCount === 1 ? 'year' : 'years'}`);
  protected readonly countLabel = computed(() => `total ${this.metric()}`);
  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => this.buildChart(this.view().rows));
  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { boxWidth: 10, boxHeight: 10, color: lfxColors.gray[500], font: { size: 11 } },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => this.tooltipTitle(items[0]?.dataIndex),
          // A gap year has nothing to label, so its row is dropped.
          label: (item) => (item.parsed.y === null ? '' : `${item.dataset.label}: ${formatHealthMetricsEventsCount(item.parsed.y)}`),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        beginAtZero: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 } },
      },
    },
  };

  protected onMetricChange(id: string): void {
    const option = HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS.find((candidate) => candidate.id === id);
    if (option) this.metric.set(option.id);
  }

  protected onViewForecast(): void {
    this.sectionPicked.emit('forecast');
  }

  private initResponse(): Signal<HealthMetricsEventsRegistrationsGrowth> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEventsRegistrationsGrowth(query) : of(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED);
            }),
            tap(() => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED }
    );
  }

  /** Total, In-person and Virtual per year; a gap year stays `null` so its slot is empty, and a partial year is drawn lighter. */
  private buildChart(rows: HealthMetricsEventsRegistrationsGrowthRowView[]): ChartData<'bar'> {
    const series = (label: string, color: string, pick: (row: HealthMetricsEventsRegistrationsGrowthRowView) => number | null) => ({
      label,
      data: rows.map(pick),
      backgroundColor: rows.map((row) => (row.isPartialYear ? hexToRgba(color, 0.4) : color)),
      borderRadius: 2,
      maxBarThickness: 18,
    });

    return {
      labels: rows.map((row) => String(row.year)),
      datasets: [
        series('Total', lfxColors.blue[500], (row) => row.total),
        series('In-person', lfxColors.emerald[500], (row) => row.inPerson),
        series('Virtual', lfxColors.violet[500], (row) => row.virtual),
      ],
    } as ChartData<'bar'>;
  }

  private tooltipTitle(index: number | undefined): string {
    const row = index === undefined ? undefined : this.view().rows[index];
    if (!row) return '';
    if (!row.recorded) return `${row.year} · no events recorded`;

    return row.isPartialYear ? `${row.year} · partial year` : String(row.year);
  }
}
