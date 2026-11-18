// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS, HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsRegistrationsGrowthChart } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsColumnChartComponent } from '../../../components/health-metrics-column-chart/health-metrics-column-chart.component';

import type {
  HealthMetricsColumnChartView,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthMetric,
  HealthMetricsEventsRegistrationsGrowthQuery,
} from '@lfx-one/shared/interfaces';

/**
 * `#reg` — registrations or attendees by year, in-person stacked under virtual. The section is not period-scoped: it
 * always shows the foundation's full history, so the period pill never re-reads it. The metric switch is in the header.
 */
@Component({
  selector: 'lfx-events-registrations-growth',
  imports: [EmptyStateComponent, HealthMetricsColumnChartComponent, Skeleton],
  templateUrl: './events-registrations-growth.component.html',
})
export class EventsRegistrationsGrowthComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Registrations or attendees, as the card header's switch picks. */
  public readonly metric = input<HealthMetricsEventsRegistrationsGrowthMetric>(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS[0].id);

  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEventsRegistrationsGrowthQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsRegistrationsGrowth> = this.initResponse();
  protected readonly chart: Signal<HealthMetricsColumnChartView> = computed(() =>
    // The UTC year, as the server's year window counts it.
    buildHealthMetricsEventsRegistrationsGrowthChart(this.response(), this.metric(), new Date().getUTCFullYear())
  );

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
            tap((response) => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link. Only a read with no
              // year is empty; a metric with no figures still draws its years, so the header switch can go back.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && response.years.length === 0);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED }
    );
  }
}
