// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PAGE_SIZE, HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED } from '@lfx-one/shared/constants';
import { selectHealthMetricsEngagementNonMemberPeriod, sortHealthMetricsEngagementNonMemberRows } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { TablePageEvent } from 'primeng/table';

import type {
  HealthMetricsEngagementNonMemberCounts,
  HealthMetricsEngagementNonMemberParticipation,
  HealthMetricsEngagementNonMemberQuery,
  HealthMetricsEngagementNonMemberRowView,
} from '@lfx-one/shared/interfaces';

/**
 * `#nonmem` — organizations turning up without paying for membership, ranked by the view's
 * `SORT_RANK_<period>`. The view carries no project key, so the section is foundation-scoped and the
 * period pill re-sorts the loaded rows rather than re-reading.
 */
@Component({
  selector: 'lfx-engagement-non-member-participation',
  imports: [EmptyStateComponent, TableComponent],
  templateUrl: './engagement-non-member-participation.component.html',
})
export class EngagementNonMemberParticipationComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Feeds the container's sub-nav badge. `null` is "no measured counts" — a read starting, a failed
   * read, or no foundation selected — and renders no badge rather than a believable zero.
   */
  public readonly countsChange = output<HealthMetricsEngagementNonMemberCounts | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly size = signal<number>(HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PAGE_SIZE);
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEngagementNonMemberQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementNonMemberParticipation> = this.initResponse();

  /** Re-sorting the table must land the reader on rows, so any change to the order restarts paging. */
  protected readonly first = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.chrome.selectedRange()}`),
    computation: () => 0,
  });

  protected readonly rowViews = computed<HealthMetricsEngagementNonMemberRowView[]>(() => {
    const range = this.chrome.selectedRange();
    return sortHealthMetricsEngagementNonMemberRows(this.response().rows, range).map((row) => ({
      row,
      period: selectHealthMetricsEngagementNonMemberPeriod(row, range),
    }));
  });
  protected readonly totalRecords = computed(() => this.rowViews().length);
  /** The caption counts the whole foundation's scope, which the view denormalizes onto every row. */
  protected readonly countLabel = computed(() => {
    const counts = this.response().counts;
    if (!counts) return '—';

    // Locale pinned so the server-rendered caption and the hydrated one agree on separators.
    return `${counts.orgs.toLocaleString('en-US')} ${counts.orgs === 1 ? 'organization' : 'organizations'}`;
  });

  protected onTablePage(event: TablePageEvent): void {
    this.size.set(event.rows ?? this.size());
    this.first.set(event.first ?? 0);
  }

  private initQuery(): HealthMetricsEngagementNonMemberQuery {
    return { foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '' };
  }

  private initResponse(): Signal<HealthMetricsEngagementNonMemberParticipation> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED);
    }

    // Latches on the first non-empty slug, as on the Overview: before any foundation resolves the
    // skeleton holds, while one cleared after a read still settles instead of wedging on it.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.countsChange.emit(null);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight
        // request for the previous one.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEngagementNonMemberParticipation(query) : of(HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED)).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED);
            }),
            tap((response) => {
              // An unresolved foundation is not a measured empty scope: the skeleton stays up, so
              // the table cannot caption an unread scope as "no rows".
              this.loading.set(!foundationSeen);
              // No foundation means no read happened, so there is no measured count to report.
              this.countsChange.emit(query.foundationSlug && !this.loadFailed() ? response.counts : null);
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED }
    );
  }
}
