// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, model, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_L2_RANGES, HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsTrainingEnrollmentView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsColumnChartComponent } from '../../../components/health-metrics-column-chart/health-metrics-column-chart.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentQuery,
  HealthMetricsTrainingEnrollmentView,
} from '@lfx-one/shared/interfaces';

/**
 * `#enroll` — the period's enrollments, certifications and revenue, and the selected measure by delivery type over the
 * current year and the five before it. The page's Enrollments / Revenue header switch picks the measure.
 */
@Component({
  selector: 'lfx-training-enroll',
  imports: [EmptyStateComponent, HealthMetricsColumnChartComponent, HealthMetricsMetricsRowComponent, Skeleton],
  templateUrl: './training-enroll.component.html',
})
export class TrainingEnrollComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The header switch's measure; the page owns the switch in the card header. */
  public readonly metric = model<HealthMetricsTrainingEnrollmentMetric>('enrollments');

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);

  // Every period comes back in one read, so a period change re-projects it and never re-reads.
  protected readonly query: Signal<HealthMetricsTrainingEnrollmentQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsTrainingEnrollment> = this.initResponse();
  protected readonly view: Signal<HealthMetricsTrainingEnrollmentView> = computed(() =>
    buildHealthMetricsTrainingEnrollmentView(this.response(), this.range(), this.metric())
  );
  /** Nothing was enrolled or earned in the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && isEmptyPeriod(this.response(), this.range()));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Whether the period has anything to show moves with it, so a period change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => {
          if (!this.loadFailed() && !this.loading()) this.settled.emit(isEmptyPeriod(this.response(), this.range()));
        });
    }
  }

  private initResponse(): Signal<HealthMetricsTrainingEnrollment> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED);
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
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getTrainingEnrollment(query) : of(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && isEmptyPeriod(response, this.range()));
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED }
    );
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The training views carry the four L2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }
}

/** Unmeasured, or nothing enrolled, certified or earned in the period. */
function isEmptyPeriod(response: HealthMetricsTrainingEnrollment, range: HealthMetricsL2Range): boolean {
  const totals = response.periods[range]?.totals;
  return !response.measured || !(totals?.enrollments || totals?.certifications || totals?.revenueUsd);
}
