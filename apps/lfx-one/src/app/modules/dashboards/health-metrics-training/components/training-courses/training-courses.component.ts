// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, model, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_TRAINING_COURSES_DEFAULT_SORT,
  HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_TRAINING_COURSES_PAGE_SIZE,
  HEALTH_METRICS_TRAINING_COURSES_SEARCH_DEBOUNCE_MS,
  HEALTH_METRICS_TRAINING_COURSES_SORT_COLUMNS,
  HEALTH_METRICS_TRAINING_COURSES_UNMEASURED,
  HEALTH_METRICS_TRAINING_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsTrainingCourseRowView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { catchError, debounce, distinctUntilChanged, map, of, skip, switchMap, tap, timer } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsTrainingCourseRowView,
  HealthMetricsTrainingCourses,
  HealthMetricsTrainingCoursesQuery,
  HealthMetricsTrainingCoursesType,
} from '@lfx-one/shared/interfaces';

/**
 * `#courses` — every course ever enrolled in, ranked by the period's enrollments; a quiet course shows 0. Paged,
 * filtered, searched and sorted server-side: the view's `sort_rank_<period>` only holds across the full set.
 */
@Component({
  selector: 'lfx-training-courses',
  imports: [EmptyStateComponent, HealthMetricsCellComponent, HealthMetricsThComponent, TableComponent, UiPaginationComponent, UiSearchInputComponent],
  templateUrl: './training-courses.component.html',
})
export class TrainingCoursesComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The Course type select in the card header; the page owns it, and this section keeps it in the URL. */
  public readonly type = model<HealthMetricsTrainingCoursesType>('all');

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly size = HEALTH_METRICS_TRAINING_COURSES_PAGE_SIZE;
  /** The field stops at the length the read applies, so it never shows text the search ignores. */
  protected readonly maxSearchLength = HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH;
  protected readonly searchText = signal<string>(this.normalizeSearch(this.initialParams.get(HEALTH_METRICS_TRAINING_QUERY_PARAMS.coursesSearch) ?? ''));
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation without courses, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  // Typing is debounced so a keystroke does not fire a warehouse read; a cleared search applies at once, so a reset never lags.
  protected readonly search: Signal<string> = toSignal(
    toObservable(this.searchText).pipe(
      map((value) => this.normalizeSearch(value)),
      debounce((term) => (term ? timer(HEALTH_METRICS_TRAINING_COURSES_SEARCH_DEBOUNCE_MS) : of(0)))
    ),
    { initialValue: this.searchText() }
  );
  /** Sorted on the server across every page; the default keeps the view's rank. */
  protected readonly sorting = injectHealthMetricsTableSort(HEALTH_METRICS_TRAINING_COURSES_SORT_COLUMNS, HEALTH_METRICS_TRAINING_COURSES_DEFAULT_SORT);
  /** Zero-based, as the pager counts. Any change to the cut or the order restarts paging, since a wider cut's page can sit past a narrower one's end. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(
      () =>
        `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.range()}|${this.type()}|${this.search()}|${JSON.stringify(this.sorting.sort())}`
    ),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 0),
  });

  protected readonly query: Signal<HealthMetricsTrainingCoursesQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsTrainingCourses> = this.initResponse();

  protected readonly rowViews: Signal<HealthMetricsTrainingCourseRowView[]> = computed(() => this.response().rows.map(buildHealthMetricsTrainingCourseRowView));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  /** No course had a learner in the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && isEmptyPeriod(this.response()));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.type === b.type && a.search === b.search && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  /** Clears the search, the type and the page, as the empty state offers; the sort stays. */
  protected onResetFilters(): void {
    this.searchText.set('');
    this.type.set('all');
  }

  private initQuery(): Signal<HealthMetricsTrainingCoursesQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.range(),
      type: this.type(),
      search: this.search(),
      offset: this.page() * this.size,
      pageSize: this.size,
      sort: this.sorting.order(),
    }));
  }

  private initResponse(): Signal<HealthMetricsTrainingCourses> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_TRAINING_COURSES_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getTrainingCourses(query) : of(HEALTH_METRICS_TRAINING_COURSES_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_TRAINING_COURSES_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one does not settle.
              if (this.clampPage(response.totalRecords)) return;

              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && isEmptyPeriod(response));
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_TRAINING_COURSES_UNMEASURED }
    );
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The view only carries the four L2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }

  private syncUrl(): void {
    const query = this.query();
    const page = this.page();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_TRAINING_QUERY_PARAMS.coursesType]: query.type === 'all' ? null : query.type,
        [HEALTH_METRICS_TRAINING_QUERY_PARAMS.coursesSearch]: query.search || null,
        // The URL counts pages from 1.
        [HEALTH_METRICS_TRAINING_QUERY_PARAMS.coursesPage]: page > 0 ? page + 1 : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?trnPage=` past the end selects no rows while the totals still report the real count. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(totalRecords: number): boolean {
    const lastPage = Math.max(0, Math.ceil(totalRecords / this.size) - 1);
    if (totalRecords === 0 || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  /** The URL's 1-based page as the pager's 0-based one. */
  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_TRAINING_QUERY_PARAMS.coursesPage));
    return Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0;
  }

  private normalizeSearch(value: string): string {
    return value.trim().slice(0, HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH);
  }
}

/** Nothing ever enrolled, or no course had enrollments or revenue in the period; an unset count is not zero. */
function isEmptyPeriod(response: HealthMetricsTrainingCourses): boolean {
  return !response.scopeTotal || response.activeTotal === 0;
}
