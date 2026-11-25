// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, model, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_ORG_DEFAULT_SORT,
  HEALTH_METRICS_ENGAGEMENT_ORG_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_ORG_SORT_COLUMNS,
  HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
  HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEngagementOrgRowView,
  filterHealthMetricsEngagementOrgRows,
  healthMetricsRowSortValue,
  sortHealthMetricsRows,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { catchError, debounce, distinctUntilChanged, of, skip, switchMap, tap, timer } from 'rxjs';

import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsProgressCellComponent } from '../../../components/health-metrics-progress-cell/health-metrics-progress-cell.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementOrgFilter,
  HealthMetricsEngagementOrgNoteCounts,
  HealthMetricsEngagementOrgParticipation,
  HealthMetricsEngagementOrgQuery,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementOrgRowView,
} from '@lfx-one/shared/interfaces';

/**
 * `#orgs` — every company that turns up, ranked by the view's `SORT_RANK_<period>`. The read carries all four periods,
 * so the period, the search and the activity cut all project the loaded rows rather than re-reading.
 */
@Component({
  selector: 'lfx-engagement-org-participation',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsProgressCellComponent,
    HealthMetricsThComponent,
    TableComponent,
    UiPaginationComponent,
    UiSearchInputComponent,
  ],
  templateUrl: './engagement-org-participation.component.html',
})
export class EngagementOrgParticipationComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Feeds the container's sub-nav note. `null` is "no measured counts" — a read starting, a failed
   * read, or no foundation selected — and renders no note.
   */
  public readonly countsChange = output<HealthMetricsEngagementOrgNoteCounts | null>();
  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The header's activity switch lives in the page's section controls, so the page owns the cut. */
  public readonly filter = model<HealthMetricsEngagementOrgFilter>('all');

  protected readonly size = HEALTH_METRICS_ENGAGEMENT_ORG_PAGE_SIZE;
  protected readonly searchText = signal<string>('');
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  // Typing is debounced, as the cut runs over the whole loaded scope; a cleared search applies at once, so a reset never lags.
  protected readonly search = toSignal(
    toObservable(this.searchText).pipe(debounce((term) => (term ? timer(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS) : of(0)))),
    { initialValue: '' }
  );

  protected readonly query: Signal<HealthMetricsEngagementOrgQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementOrgParticipation> = this.initResponse();

  protected readonly sorting = injectHealthMetricsTableSort(HEALTH_METRICS_ENGAGEMENT_ORG_SORT_COLUMNS, HEALTH_METRICS_ENGAGEMENT_ORG_DEFAULT_SORT);
  /** Narrowing or re-sorting the table must land the reader on rows, so any change to the cut or the order restarts paging. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(
      () =>
        `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.filter()}|${this.search()}|${this.chrome.selectedRange()}|${JSON.stringify(this.sorting.sort())}`
    ),
    computation: () => 0,
  });

  // Built once per response and period rather than per keystroke: the date label builds an `Intl` formatter per call.
  private readonly rowViewsByRow = computed(() => {
    const range = this.chrome.selectedRange();
    return new Map<HealthMetricsEngagementOrgRow, HealthMetricsEngagementOrgRowView>(
      this.response().rows.map((row) => [row, buildHealthMetricsEngagementOrgRowView(row, range)])
    );
  });
  // The cut narrows rows the views are already built for, so a keystroke only filters and sorts.
  protected readonly rowViews = computed<HealthMetricsEngagementOrgRowView[]>(() => {
    const views = this.rowViewsByRow();
    const filtered = filterHealthMetricsEngagementOrgRows(this.response().rows, this.filter(), this.search(), this.chrome.selectedRange())
      .map((row) => views.get(row))
      .filter((view) => view !== undefined);
    return sortHealthMetricsRows(filtered, this.sorting.order(), healthMetricsRowSortValue);
  });
  // Kept inside the loaded rows, so a page picked before a smaller read lands never leaves the table blank.
  protected readonly pageRows = computed(() => {
    const rows = this.rowViews();
    const page = Math.min(this.page(), Math.max(0, Math.ceil(rows.length / this.size) - 1));
    return rows.slice(page * this.size, (page + 1) * this.size);
  });
  protected readonly totalRecords = computed(() => this.rowViews().length);
  /** No rows at all means an empty scope; rows with null scope counts still render. */
  protected readonly scopeEmpty = computed(() => this.response().rows.length === 0);
  /** The foundation has no participating company; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && this.scopeEmpty());

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.filter)
        .pipe(
          // `skip(1)` drops the state just read out of the URL — navigating back to it would be a
          // no-op write during hydration.
          skip(1),
          takeUntilDestroyed()
        )
        .subscribe((filter) => this.syncUrl(filter));
    }
  }

  protected onResetFilters(): void {
    this.searchText.set('');
    this.filter.set('all');
  }

  private initQuery(): HealthMetricsEngagementOrgQuery {
    return { foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '' };
  }

  private initResponse(): Signal<HealthMetricsEngagementOrgParticipation> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getEngagementOrgParticipation(query) : of(HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED)).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED);
            }),
            tap((response) => {
              // An unresolved foundation is not a measured empty scope: the skeleton stays up, so
              // the table cannot read an unread scope as "no rows".
              this.loading.set(!foundationSeen);
              // No foundation means no read happened, so there is no measured count to report.
              this.countsChange.emit(query.foundationSlug && !this.loadFailed() ? response.counts : null);
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && response.rows.length === 0);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED }
    );
  }

  private syncUrl(filter: HealthMetricsEngagementOrgFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.orgFilter]: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }
}
