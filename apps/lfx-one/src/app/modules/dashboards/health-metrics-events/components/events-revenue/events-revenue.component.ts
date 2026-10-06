// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_EVENTS_REVENUE_PENDING_NOTE,
  HEALTH_METRICS_EVENTS_REVENUE_UNCONVERTED_NOTE,
  HEALTH_METRICS_EVENTS_REVENUE_UNCONVERTED_SCREEN_READER_TEXT,
  HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsRevenueView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { HealthMetricsEventsRevenue, HealthMetricsEventsRevenueQuery, HealthMetricsEventsRevenueView } from '@lfx-one/shared/interfaces';

/**
 * `#rev` — registration and sponsorship revenue, in USD, and each event against its goals. One read
 * carries all four periods, so a period change re-projects the loaded response rather than re-reading.
 */
@Component({
  selector: 'lfx-events-revenue',
  imports: [EmptyStateComponent, Skeleton, TableComponent],
  templateUrl: './events-revenue.component.html',
})
export class EventsRevenueComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the revenue settles — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly pendingNote = HEALTH_METRICS_EVENTS_REVENUE_PENDING_NOTE;
  protected readonly unconvertedNote = HEALTH_METRICS_EVENTS_REVENUE_UNCONVERTED_NOTE;
  protected readonly unconvertedScreenReaderText = HEALTH_METRICS_EVENTS_REVENUE_UNCONVERTED_SCREEN_READER_TEXT;

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEventsRevenueQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsRevenue> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEventsRevenueView> = computed(() =>
    buildHealthMetricsEventsRevenueView(this.response(), this.chrome.selectedRange())
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The headline and the table are per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  private initResponse(): Signal<HealthMetricsEventsRevenue> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getEventsRevenue(query) : of(HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED);
            }),
            tap(() => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED }
    );
  }

  /** Re-settles the re-projected section; a read in flight or failed settles on its own. */
  private onRangeChange(): void {
    if (this.loadFailed() || this.loading()) return;

    this.settled.emit();
  }
}
