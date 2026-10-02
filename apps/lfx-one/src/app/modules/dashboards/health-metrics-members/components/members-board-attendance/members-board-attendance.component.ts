// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_BASE_PATH,
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS,
  HEALTH_METRICS_MEMBERS_BOARD_COHORTS,
  HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS,
  HEALTH_METRICS_MEMBERS_BOARD_NEVER_ATTENDED_LINK,
  HEALTH_METRICS_MEMBERS_BOARD_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  lfxColors,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersBoardCountLabel,
  buildHealthMetricsMembersBoardMeetingRows,
  buildHealthMetricsMembersBoardNote,
  buildHealthMetricsMembersBoardSummary,
  buildHealthMetricsMembersBoardTrend,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsL2Range,
  HealthMetricsMembersBoardAttendance,
  HealthMetricsMembersBoardAttendanceQuery,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardMeetingRowView,
  HealthMetricsMembersBoardSummaryView,
  HealthMetricsMembersBoardTrendBarView,
} from '@lfx-one/shared/interfaces';
import type { TablePageEvent } from 'primeng/table';

/**
 * `#board` — board or voting-member attendance in the selected period: the latest meeting's share,
 * the latest meetings as a chart, and every meeting paged server-side.
 */
@Component({
  selector: 'lfx-members-board-attendance',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, RouterLink, Skeleton, TableComponent],
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
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly basePath = HEALTH_METRICS_BASE_PATH;
  protected readonly neverAttendedLink = HEALTH_METRICS_MEMBERS_BOARD_NEVER_ATTENDED_LINK;
  protected readonly cohortOptions: FilterPillOption[] = [...HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS];
  protected readonly size = HEALTH_METRICS_MEMBERS_BOARD_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a period without meetings, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly cohort = signal<HealthMetricsMembersBoardCohort>(this.parseInitialCohort());
  /** The foundation, range and cohort the shown response belongs to, so a new scope holds the skeleton. */
  private readonly responseScope = signal<string | null>(null);

  private readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  private readonly range = computed<HealthMetricsL2Range>(() => {
    const range = this.chrome.selectedRange();
    // The views carry the four Level 2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  });
  private readonly scope = computed(() => `${this.foundationSlug()}|${this.range()}|${this.cohort()}`);

  /** A new foundation, period or cohort restarts paging, since its meetings share nothing with the last. */
  protected readonly page = linkedSignal<string, number>({
    source: this.scope,
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly query: Signal<HealthMetricsMembersBoardAttendanceQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersBoardAttendance> = this.initResponse();

  protected readonly summary: Signal<HealthMetricsMembersBoardSummaryView> = computed(() => {
    const cohort = this.cohort();
    const other = HEALTH_METRICS_MEMBERS_BOARD_COHORTS.find((candidate) => candidate !== cohort) ?? cohort;
    const { cohorts } = this.response();
    return buildHealthMetricsMembersBoardSummary(cohort, cohorts[cohort], cohorts[other]);
  });
  protected readonly trend: Signal<HealthMetricsMembersBoardTrendBarView[]> = computed(() => buildHealthMetricsMembersBoardTrend(this.response().trend));
  protected readonly rowViews: Signal<HealthMetricsMembersBoardMeetingRowView[]> = computed(() =>
    buildHealthMetricsMembersBoardMeetingRows(this.response().rows)
  );
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly countLabel = computed(() => buildHealthMetricsMembersBoardCountLabel(this.totalRecords()));
  protected readonly meetingNoun = computed(() => HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS[this.cohort()]);
  protected readonly first = computed(() => (this.page() - 1) * this.size);
  /** Holds the skeleton until a scope's first read lands; paging keeps the figures and loads in the table. */
  protected readonly firstRead = computed(
    () => this.loading() && (this.response() === HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED || this.responseScope() !== this.scope())
  );
  protected readonly noMeetings = computed(() => this.totalRecords() === 0 && this.trend().length === 0);
  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => this.buildChart(this.trend(), this.summary().isBelowExpectedLevel));
  protected readonly chartLabel = computed(
    () => `Attendance at the latest ${this.trend().length} ${this.meetingNoun()}s, oldest first. The following table lists the same values.`
  );
  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => this.tooltipTitle(items[0]?.dataIndex),
          label: (item) => (item.parsed.y === null ? '' : `${item.parsed.y}%`),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        beginAtZero: true,
        max: 100,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 }, callback: (value) => `${value}%` },
      },
    },
  };

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

  protected onCohortChange(id: string): void {
    const cohort = HEALTH_METRICS_MEMBERS_BOARD_COHORTS.find((candidate) => candidate === id);
    if (cohort) this.cohort.set(cohort);
  }

  protected onTablePage(event: TablePageEvent): void {
    this.page.set(Math.floor((event.first ?? 0) / this.size) + 1);
  }

  private initQuery(): Signal<HealthMetricsMembersBoardAttendanceQuery> {
    return computed(() => ({
      foundationSlug: this.foundationSlug(),
      range: this.range(),
      cohort: this.cohort(),
      offset: (this.page() - 1) * this.size,
      pageSize: this.size,
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
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED }
    );
  }

  /** Earlier meetings pale, the view's latest solid — red when the view flags it below the expected level. */
  private buildChart(bars: HealthMetricsMembersBoardTrendBarView[], latestBelow: boolean): ChartData<'bar'> {
    const latestColor = latestBelow ? lfxColors.red[600] : lfxColors.blue[600];
    return {
      labels: bars.map((bar) => bar.label),
      datasets: [
        {
          label: 'Attendance',
          data: bars.map((bar) => bar.pct),
          backgroundColor: bars.map((bar) => (bar.isLatest ? latestColor : lfxColors.blue[200])),
          borderRadius: 2,
          maxBarThickness: 28,
        },
      ],
    } as ChartData<'bar'>;
  }

  private tooltipTitle(index: number | undefined): string {
    const bar = index === undefined ? undefined : this.trend()[index];
    return bar ? `${bar.dateLabel} · ${bar.committeeName}` : '';
  }

  private syncUrl(): void {
    const page = this.page();
    const cohort = this.cohort();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardCohort]: cohort === HEALTH_METRICS_MEMBERS_BOARD_COHORTS[0] ? null : cohort,
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardPage]: page > 1 ? page : null,
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
    const lastPage = Math.max(1, Math.ceil(response.totalRecords / this.size));
    // The sentinel's zero is no count, so a failed read keeps the page; an empty period moves to page 1.
    if (response === HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialCohort(): HealthMetricsMembersBoardCohort {
    const value = this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardCohort);
    return HEALTH_METRICS_MEMBERS_BOARD_COHORTS.find((candidate) => candidate === value) ?? HEALTH_METRICS_MEMBERS_BOARD_COHORTS[0];
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }
}
