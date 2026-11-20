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
  HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED,
  HEALTH_METRICS_MEMBERS_BOARD_COHORTS,
  HEALTH_METRICS_MEMBERS_BOARD_DEFAULT_SORT,
  HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS,
  HEALTH_METRICS_MEMBERS_BOARD_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_BOARD_SORT_COLUMNS,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersBoardChart,
  buildHealthMetricsMembersBoardMeetingRows,
  buildHealthMetricsMembersBoardMetrics,
  buildHealthMetricsMembersBoardNote,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsBarChartComponent } from '../../../components/health-metrics-bar-chart/health-metrics-bar-chart.component';
import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsProgressCellComponent } from '../../../components/health-metrics-progress-cell/health-metrics-progress-cell.component';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsBarChartView,
  HealthMetricsL2Range,
  HealthMetricsMembersBoardAttendance,
  HealthMetricsMembersBoardAttendanceQuery,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardMeetingRowView,
  HealthMetricsMetricItem,
} from '@lfx-one/shared/interfaces';

/**
 * `#board` — board or voting-member attendance in the selected period: the latest meeting's share, the latest meetings
 * as a chart, and every meeting paged and sorted server-side.
 */
@Component({
  selector: 'lfx-members-board-attendance',
  imports: [
    EmptyStateComponent,
    HealthMetricsBarChartComponent,
    HealthMetricsCellComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsProgressCellComponent,
    HealthMetricsThComponent,
    Skeleton,
    TableComponent,
    UiPaginationComponent,
  ],
  templateUrl: './members-board-attendance.component.html',
})
export class MembersBoardAttendanceComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav note, always from the board cohort; empty while a new foundation or period reads, or after a failed read. */
  public readonly noteChange = output<string>();
  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The header's cohort switch lives in the page's section controls, so the page owns the cohort. */
  public readonly cohort = model<HealthMetricsMembersBoardCohort>(HEALTH_METRICS_MEMBERS_BOARD_COHORTS[0]);

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly size = HEALTH_METRICS_MEMBERS_BOARD_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a period without meetings, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** The foundation, range and cohort the shown response belongs to, so a new scope holds the skeleton. */
  private readonly responseScope = signal<string | null>(null);

  private readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  private readonly range = computed<HealthMetricsL2Range>(() => {
    const range = this.chrome.selectedRange();
    // The views carry the four Level 2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  });
  private readonly scope = computed(() => `${this.foundationSlug()}|${this.range()}|${this.cohort()}`);

  /** Sorted on the server across every page; the default is the newest meeting first. The cohort switch keeps it. */
  protected readonly sorting = injectHealthMetricsTableSort(HEALTH_METRICS_MEMBERS_BOARD_SORT_COLUMNS, HEALTH_METRICS_MEMBERS_BOARD_DEFAULT_SORT);
  /** Zero-based, as the pager counts. A new foundation, period, cohort or order restarts paging. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.scope()}|${JSON.stringify(this.sorting.sort())}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 0),
  });

  protected readonly query: Signal<HealthMetricsMembersBoardAttendanceQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersBoardAttendance> = this.initResponse();

  protected readonly metrics: Signal<HealthMetricsMetricItem[]> = computed(() =>
    buildHealthMetricsMembersBoardMetrics(this.cohort(), this.response().cohorts, this.range())
  );
  /** The chart stays oldest first whatever the table's sort. */
  protected readonly chart: Signal<HealthMetricsBarChartView> = computed(() => buildHealthMetricsMembersBoardChart(this.response().trend, this.cohort()));
  protected readonly rowViews: Signal<HealthMetricsMembersBoardMeetingRowView[]> = computed(() =>
    buildHealthMetricsMembersBoardMeetingRows(this.response().rows, this.cohort())
  );
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly meetingNoun = computed(() => HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS[this.cohort()]);
  /** Holds the skeleton until a scope's first read lands; paging and sorting keep the figures and load in the table. */
  protected readonly firstRead = computed(
    () => this.loading() && (this.response() === HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED || this.responseScope() !== this.scope())
  );
  protected readonly noMeetings = computed(() => this.totalRecords() === 0 && this.response().trend.length === 0);
  /** No cohort met in the period; the shell shows the section's empty state instead, and a quiet cohort keeps its own note. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && isEmptyScope(this.response()));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.cohort === b.cohort && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  private initQuery(): Signal<HealthMetricsMembersBoardAttendanceQuery> {
    return computed(() => ({
      foundationSlug: this.foundationSlug(),
      range: this.range(),
      cohort: this.cohort(),
      offset: this.page() * this.size,
      pageSize: this.size,
      sort: this.sorting.order(),
    }));
  }

  private initResponse(): Signal<HealthMetricsMembersBoardAttendance> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;
    // The note reads the board cohort whichever is shown, so only a new foundation or period blanks it.
    let noteScope: string | null = null;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          const scope = `${query.foundationSlug}|${query.range}`;
          if (scope !== noteScope) {
            noteScope = scope;
            this.noteChange.emit('');
          }
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersBoardAttendance(query) : of(HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one neither settles, reports a note nor ends the skeleton.
              if (this.clampPage(response)) return;

              this.responseScope.set(`${query.foundationSlug}|${query.range}|${query.cohort}`);

              this.loading.set(!foundationSeen);
              this.noteChange.emit(query.foundationSlug && !this.loadFailed() ? buildHealthMetricsMembersBoardNote(response.cohorts.board) : '');
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              // Judged on every cohort, not the selected one, so an empty cohort never hides the switch to go back.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && isEmptyScope(response));
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED }
    );
  }

  private syncUrl(): void {
    const page = this.page();
    const cohort = this.cohort();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardCohort]: cohort === HEALTH_METRICS_MEMBERS_BOARD_COHORTS[0] ? null : cohort,
        // The URL counts pages from 1.
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardPage]: page > 0 ? page + 1 : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?boardPage=` past the end selects no rows while the count still reports the real total. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(response: HealthMetricsMembersBoardAttendance): boolean {
    const lastPage = Math.max(0, Math.ceil(response.totalRecords / this.size) - 1);
    // The sentinel's zero is no count, so a failed read keeps the page; an empty period moves to the first page.
    if (response === HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  /** The URL's 1-based page as the pager's 0-based one. */
  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardPage));
    return Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0;
  }
}

/** No cohort met in the period, and the selected cohort's meetings agree, so a missing summary never hides real rows. */
function isEmptyScope(response: HealthMetricsMembersBoardAttendance): boolean {
  const noCohortMet = Object.values(response.cohorts).every((cohort) => !cohort?.meetingsInRangeCount);
  return noCohortMet && response.totalRecords === 0 && response.trend.length === 0;
}
