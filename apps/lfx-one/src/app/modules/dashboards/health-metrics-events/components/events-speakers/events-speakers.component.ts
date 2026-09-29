// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import { HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS, HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED, lfxColors } from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEventsSpeakersNote,
  buildHealthMetricsEventsSpeakersView,
  buildHealthMetricsEventsSpeakersYears,
  formatHealthMetricsEventsCount,
  hexToRgba,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersQuery,
  HealthMetricsEventsSpeakersTab,
  HealthMetricsEventsSpeakersView,
  HealthMetricsEventsSpeakersYearView,
} from '@lfx-one/shared/interfaces';

/**
 * `#spk` — the CFP pipeline: accepted proposals, status mix, proposals per year, the top organizations and
 * the latest proposals. One read carries all four periods, so a period or tab change re-projects it.
 */
@Component({
  selector: 'lfx-events-speakers',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './events-speakers.component.html',
})
export class EventsSpeakersComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav note ("down N% YoY"); empty while a read is pending or failed. */
  public readonly noteChange = output<string>();
  /** Fires once the section settles — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly tab = signal<HealthMetricsEventsSpeakersTab>(HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS[0].id);
  protected readonly tabOptions: FilterPillOption[] = [...HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS];

  protected readonly query: Signal<HealthMetricsEventsSpeakersQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsSpeakers> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEventsSpeakersView> = computed(() =>
    buildHealthMetricsEventsSpeakersView(this.response(), this.chrome.selectedRange(), this.tab())
  );

  // Keyed on the response alone, so a period or tab change does not rebuild the chart.
  protected readonly years: Signal<HealthMetricsEventsSpeakersYearView[]> = computed(() => buildHealthMetricsEventsSpeakersYears(this.response()));
  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => this.buildChart(this.years()));
  /** Names what the canvas depicts; the per-year values live in the adjacent table. */
  protected readonly chartSummaryLabel: Signal<string> = computed(() => {
    const years = this.years();
    if (years.length === 0) return 'Proposals per year';
    return `Bar chart of proposals per year, ${years[0].year} to ${years[years.length - 1].year}. The same figures follow in a table.`;
  });
  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          // An unmeasured year has nothing to label, so its row is dropped.
          label: (item) => (item.parsed.y === null ? '' : `Proposals: ${formatHealthMetricsEventsCount(item.parsed.y)}`),
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

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Every figure is per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onTabChange(id: string): void {
    const option = HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS.find((candidate) => candidate.id === id);
    if (!option) return;

    this.tab.set(option.id);
    // The list's length moves with the tab, and every anchor below with it.
    if (!this.loadFailed() && !this.loading()) this.settled.emit();
  }

  private initResponse(): Signal<HealthMetricsEventsSpeakers> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED);
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
          this.noteChange.emit('');
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEventsSpeakers(query) : of(HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              this.noteChange.emit(this.loadFailed() ? '' : buildHealthMetricsEventsSpeakersNote(response, this.chrome.selectedRange()));
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED }
    );
  }

  /** Re-notes and re-settles the re-projected section; a read in flight or failed does both on its own. */
  private onRangeChange(): void {
    if (this.loadFailed() || this.loading()) return;

    this.noteChange.emit(buildHealthMetricsEventsSpeakersNote(this.response(), this.chrome.selectedRange()));
    this.settled.emit();
  }

  /** Proposals submitted per year; an unmeasured year stays `null` so its slot is empty, and the open year is drawn lighter. */
  private buildChart(years: HealthMetricsEventsSpeakersYearView[]): ChartData<'bar'> {
    const color = lfxColors.blue[500];

    return {
      labels: years.map((year) => String(year.year)),
      datasets: [
        {
          label: 'Proposals',
          data: years.map((year) => year.submitted),
          backgroundColor: years.map((year) => (year.isPartialYear ? hexToRgba(color, 0.4) : color)),
          borderRadius: 2,
          maxBarThickness: 28,
        },
      ],
    } as ChartData<'bar'>;
  }
}
