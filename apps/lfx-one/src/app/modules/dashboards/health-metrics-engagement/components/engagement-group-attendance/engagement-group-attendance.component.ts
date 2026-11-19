// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, model, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_DORMANT_TIP,
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_GROUP_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementGroupRowView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsValueBarComponent } from '../../../components/health-metrics-value-bar/health-metrics-value-bar.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementGroupAttendance,
  HealthMetricsEngagementGroupNoteCounts,
  HealthMetricsEngagementGroupQuery,
  HealthMetricsEngagementGroupRowView,
  HealthMetricsEngagementGroupTypeFilter,
} from '@lfx-one/shared/interfaces';

/**
 * `#committees` — every group ranked dormant-first then lowest attendance. The rank is the view's
 * `SORT_RANK_<period>` applied server-side: sorting the page client-side would only rank 10 rows.
 */
@Component({
  selector: 'lfx-engagement-group-attendance',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsValueBarComponent,
    TableComponent,
    UiBadgeComponent,
    UiPaginationComponent,
    UiTooltipDirective,
  ],
  templateUrl: './engagement-group-attendance.component.html',
})
export class EngagementGroupAttendanceComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Feeds the container's sub-nav note — the counts cover the whole filtered set, not the page.
   * `null` is "no measured counts" — a read starting, a failed read, or no foundation selected.
   */
  public readonly countsChange = output<HealthMetricsEngagementGroupNoteCounts | null>();
  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The header's Group type select lives in the page's section controls, so the page owns the cut. */
  public readonly groupType = model<HealthMetricsEngagementGroupTypeFilter>('all');

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly dormantTip = HEALTH_METRICS_ENGAGEMENT_DORMANT_TIP;
  protected readonly size = HEALTH_METRICS_ENGAGEMENT_GROUP_PAGE_SIZE;
  /**
   * Every scope change restarts paging. The period and foundation come from the page header, which
   * cannot know this table's page, and a page from the wider scope sits past the end of a smaller one.
   */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.chrome.selectedRange()}|${this.groupType()}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEngagementGroupQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementGroupAttendance> = this.initResponse();

  protected readonly rowViews: Signal<HealthMetricsEngagementGroupRowView[]> = computed(() => {
    const range = this.chrome.selectedRange();
    return this.response().rows.map((row) => buildHealthMetricsEngagementGroupRowView(row, range));
  });
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  /** No group was recorded for the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && this.response().counts === null);
  /** The pager counts pages from 0; the URL and the read count them from 1. */
  protected readonly pageIndex = computed(() => this.page() - 1);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL — navigating back to it would be a
          // no-op write during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.groupType === b.groupType && a.page === b.page),
          takeUntilDestroyed()
        )
        .subscribe((query) => this.syncUrl(query));
    }
  }

  protected onPageChange(index: number): void {
    this.page.set(index + 1);
  }

  protected onResetFilters(): void {
    this.groupType.set('all');
  }

  private initQuery(): HealthMetricsEngagementGroupQuery {
    return {
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      groupType: this.groupType(),
      range: this.chrome.selectedRange(),
      page: this.page(),
      size: this.size,
    };
  }

  private initResponse(): Signal<HealthMetricsEngagementGroupAttendance> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED);
    }

    // Latches on the first non-empty slug, as on the Overview: before any foundation resolves the
    // skeleton holds, while one cleared after a read still settles instead of wedging on it.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
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
          (query.foundationSlug ? this.analyticsService.getEngagementGroupAttendance(query) : of(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED)).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED);
            }),
            tap((response) => {
              // An out-of-range page is not a settled read: the clamp fires a follow-up fetch, so
              // `loading` stays set and no counts are reported until the page that has rows arrives.
              if (this.clampPage(response.totalRecords)) {
                // The clamp can land before the sync subscription's first emission, which `skip(1)`
                // drops as already-in-the-URL state — so the replacement page is written back here.
                this.syncUrl(this.query());
                return;
              }
              // An unresolved foundation is not a measured empty scope: the skeleton stays up, so
              // the table cannot caption an unread scope as "no rows".
              this.loading.set(!foundationSeen);
              // No foundation means no read happened, so the default's zeroes are not a measured count.
              this.countsChange.emit(query.foundationSlug && !this.loadFailed() ? response.counts : null);
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && response.counts === null);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED }
    );
  }

  private syncUrl(query: HealthMetricsEngagementGroupQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.groupType]: query.groupType === 'all' ? null : query.groupType,
        [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.groupPage]: query.page > 1 ? query.page : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?groupPage=` past the end of the filtered set selects nothing while the totals join still
   * reports the real count. Land on the last page that has rows, and report the clamp so the caller
   * can hold this read open for the page that replaces it.
   */
  private clampPage(totalRecords: number): boolean {
    const lastPage = Math.max(1, Math.ceil(totalRecords / this.size));
    if (totalRecords === 0 || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    return true;
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.groupPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }
}
