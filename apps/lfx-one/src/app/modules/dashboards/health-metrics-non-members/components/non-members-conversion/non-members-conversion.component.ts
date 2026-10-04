// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_NON_MEMBERS_CONVERSION_BAR_CLASS,
  HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsNonMembersConversionView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersConversionQuery,
  HealthMetricsNonMembersConversionView,
} from '@lfx-one/shared/interfaces';

/**
 * `#conversion` — the period's estimated pipeline and the warmest high-fit organizations behind it.
 * Opportunity framing only: no risk badges, and the rows are not links.
 */
@Component({
  selector: 'lfx-non-members-conversion',
  imports: [EmptyStateComponent, Skeleton],
  templateUrl: './non-members-conversion.component.html',
})
export class NonMembersConversionComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** High-fit organizations in the period, for the sub-nav badge; `null` while reading, after a failed read, or when not measured. */
  public readonly countChange = output<number | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly barClass = HEALTH_METRICS_NON_MEMBERS_CONVERSION_BAR_CLASS;

  protected readonly query: Signal<HealthMetricsNonMembersConversionQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
    range: this.range(),
  }));
  protected readonly response: Signal<HealthMetricsNonMembersConversion> = this.initResponse();
  protected readonly view: Signal<HealthMetricsNonMembersConversionView> = computed(() => buildHealthMetricsNonMembersConversionView(this.response()));

  private initResponse(): Signal<HealthMetricsNonMembersConversion> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug && a.range === b.range),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.countChange.emit(null);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getNonMembersConversion(query) : of(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              this.countChange.emit(response.measured ? response.highFitCount : null);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED }
    );
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The conversion views carry the four L2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }
}
