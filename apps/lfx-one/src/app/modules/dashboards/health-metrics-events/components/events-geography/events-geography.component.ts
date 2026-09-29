// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_EVENTS_GEOGRAPHY_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsGeographyView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { HealthMetricsEventsGeography, HealthMetricsEventsGeographyQuery, HealthMetricsEventsGeographyView } from '@lfx-one/shared/interfaces';

/**
 * `#geo` — countries represented against the prior period, and the top countries by registrations.
 * One read carries all four periods, so a period change re-projects it.
 */
@Component({
  selector: 'lfx-events-geography',
  imports: [EmptyStateComponent, Skeleton],
  templateUrl: './events-geography.component.html',
})
export class EventsGeographyComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();
  /** The sub-nav badge: countries in the selected period, `null` while loading, failed or unmeasured. */
  public readonly countChange = output<number | null>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEventsGeographyQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsGeography> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEventsGeographyView> = computed(() =>
    buildHealthMetricsEventsGeographyView(this.response(), this.chrome.selectedRange())
  );
  private readonly count: Signal<number | null> = computed(() => (this.loading() || this.loadFailed() ? null : this.view().countries));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Every figure is per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => {
          if (!this.loadFailed() && !this.loading()) this.settled.emit();
        });
      toObservable(this.count)
        .pipe(distinctUntilChanged(), takeUntilDestroyed())
        .subscribe((count) => this.countChange.emit(count));
    }
  }

  private initResponse(): Signal<HealthMetricsEventsGeography> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_GEOGRAPHY_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getEventsGeography(query) : of(HEALTH_METRICS_EVENTS_GEOGRAPHY_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_GEOGRAPHY_UNMEASURED);
            }),
            tap(() => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_GEOGRAPHY_UNMEASURED }
    );
  }
}
