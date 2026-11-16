// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_BASE_PATH,
  HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEngagementParticipationMetrics,
  buildHealthMetricsEngagementParticipationRowView,
  selectHealthMetricsEngagementParticipationPeriod,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsValueBarComponent } from '../../../components/health-metrics-value-bar/health-metrics-value-bar.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementMeetingParticipation,
  HealthMetricsEngagementParticipationPeriod,
  HealthMetricsEngagementParticipationQuery,
  HealthMetricsEngagementParticipationRowView,
  HealthMetricsEngagementSectionKey,
  HealthMetricsMetricItem,
} from '@lfx-one/shared/interfaces';

/**
 * `#participation` — the foundation-wide roll-up the view computes itself, plus one row per meeting
 * type. The metrics read the view's `all` row rather than summing the type rows, which would
 * double-count a meeting belonging to more than one group.
 */
@Component({
  selector: 'lfx-engagement-meeting-participation',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsValueBarComponent,
    RouterLink,
    SkeletonModule,
    TableComponent,
    UiNoteComponent,
  ],
  templateUrl: './engagement-meeting-participation.component.html',
})
export class EngagementMeetingParticipationComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** A meeting type's row scrolls to Group attendance; the L2 shell owns scrolling. */
  public readonly sectionPicked = output<HealthMetricsEngagementSectionKey>();
  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly boardRoute = [HEALTH_METRICS_BASE_PATH, 'members'];
  /** Clears a cohort or page the URL already carries, so the row lands on board attendance itself. */
  protected readonly boardQueryParams = {
    [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardCohort]: null,
    [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardPage]: null,
  };

  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEngagementParticipationQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementMeetingParticipation> = this.initResponse();

  protected readonly totalPeriod = computed(() => {
    const total = this.response().total;
    return total ? selectHealthMetricsEngagementParticipationPeriod(total, this.chrome.selectedRange()) : null;
  });
  /** No meetings were held in the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && isEmptyPeriod(this.totalPeriod()));
  protected readonly metrics: Signal<HealthMetricsMetricItem[]> = computed(() =>
    buildHealthMetricsEngagementParticipationMetrics(this.response().total, this.chrome.selectedRange())
  );
  protected readonly rowViews: Signal<HealthMetricsEngagementParticipationRowView[]> = computed(() => {
    const range = this.chrome.selectedRange();
    return this.response().rows.map((row) => buildHealthMetricsEngagementParticipationRowView(row, range));
  });
  // The roll-up's own meeting count decides this, not a row's: the note qualifies the headline rate.
  protected readonly lowConfidence = computed(() => {
    const period = this.totalPeriod();
    return period !== null && period.meetingsHeld !== null && period.meetingsHeld > 0 && period.meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE;
  });

  protected onRowPicked(governance: boolean): void {
    if (governance) {
      void this.router.navigate(this.boardRoute, { fragment: 'board', queryParams: this.boardQueryParams, queryParamsHandling: 'merge' });
      return;
    }
    this.sectionPicked.emit('committees');
  }

  private initQuery(): HealthMetricsEngagementParticipationQuery {
    return {
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.chrome.selectedRange(),
    };
  }

  private initResponse(): Signal<HealthMetricsEngagementMeetingParticipation> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED);
    }

    // Latches on the first non-empty slug, as on the Overview: before any foundation resolves the
    // skeleton holds, while one cleared after a read still settles instead of wedging on it.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug && a.range === b.range),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight
        // request for the previous one.
        switchMap((query) =>
          (query.foundationSlug
            ? this.analyticsService.getEngagementMeetingParticipation(query)
            : of(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED)
          ).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED);
            }),
            tap((response) => {
              // An unresolved foundation is not a measured empty scope: the skeleton stays up, so
              // the metrics cannot report an unread period as having no meetings.
              this.loading.set(!foundationSeen);
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) {
                this.settled.emit(
                  !this.loadFailed() && isEmptyPeriod(response.total && selectHealthMetricsEngagementParticipationPeriod(response.total, query.range))
                );
              }
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED }
    );
  }
}

/** No roll-up for the period, or one that held no meetings; an unmeasured count is not a zero. */
function isEmptyPeriod(period: HealthMetricsEngagementParticipationPeriod | null): boolean {
  return !period || period.meetingsHeld === 0;
}
