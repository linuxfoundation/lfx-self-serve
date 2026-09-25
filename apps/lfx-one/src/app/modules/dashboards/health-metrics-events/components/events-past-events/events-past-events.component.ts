// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { HEALTH_METRICS_EVENTS_PAST_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsPastView, formatHealthMetricsEventsCount, formatHealthMetricsEventsPastClosedLabel } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEventsPast,
  HealthMetricsEventsPastQuery,
  HealthMetricsEventsPastView,
  HealthMetricsEventsSectionKey,
} from '@lfx-one/shared/interfaces';

/**
 * `#past` — how each closed event finished against its goal. One read carries all four periods,
 * so a period change re-projects the loaded response rather than re-reading.
 */
@Component({
  selector: 'lfx-events-past-events',
  imports: [EmptyStateComponent, Skeleton, TableComponent],
  templateUrl: './events-past-events.component.html',
})
export class EventsPastEventsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav badge: events closed in the selected period; `null` while a read is pending or failed, and `0` for a foundation with none. */
  public readonly countChange = output<number | null>();
  /** Fires once the event list settles — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();
  /** The cross-link back to the forecast; the L2 shell owns scrolling, so a repeat click still lands. */
  public readonly sectionPicked = output<HealthMetricsEventsSectionKey>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEventsPastQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsPast> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEventsPastView> = computed(() => buildHealthMetricsEventsPastView(this.response(), this.chrome.selectedRange()));

  protected readonly closedLabel = computed(() => formatHealthMetricsEventsPastClosedLabel(this.view().eventCount));
  protected readonly registrationsLabel = computed(() => formatHealthMetricsEventsCount(this.view().registrations));
  protected readonly goalMetLabel = computed(() => formatHealthMetricsEventsCount(this.view().goalMetCount));
  protected readonly goalSetLabel = computed(() => formatHealthMetricsEventsCount(this.view().goalSetCount));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The badge and the list are per period, so a pill change re-reports both off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onViewForecast(): void {
    this.sectionPicked.emit('forecast');
  }

  private initResponse(): Signal<HealthMetricsEventsPast> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_PAST_UNMEASURED);
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
          this.countChange.emit(null);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEventsPast(query) : of(HEALTH_METRICS_EVENTS_PAST_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_PAST_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              if (!this.loadFailed() && foundationSeen) {
                this.countChange.emit(buildHealthMetricsEventsPastView(response, this.chrome.selectedRange()).eventCount);
              }
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_PAST_UNMEASURED }
    );
  }

  /** Re-reports the badge and re-settles the re-projected list; a failed or unread scope stays `null`. */
  private onRangeChange(): void {
    // A read in flight still holds the previous foundation's payload, and its own settle is still to come.
    if (this.loadFailed() || this.loading()) return;

    this.countChange.emit(this.view().eventCount);
    this.settled.emit();
  }
}
