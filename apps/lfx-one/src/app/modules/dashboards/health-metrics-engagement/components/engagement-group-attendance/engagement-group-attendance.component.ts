// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_GROUP_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementGroupTrend, selectHealthMetricsEngagementGroupPeriod } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { EngagementAttendanceBarComponent } from '../engagement-attendance-bar/engagement-attendance-bar.component';
import { EngagementGroupAttendanceDrawerComponent } from '../engagement-group-attendance-drawer/engagement-group-attendance-drawer.component';
import { EngagementSparklineComponent } from '../engagement-sparkline/engagement-sparkline.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  FilterPillOption,
  HealthMetricsEngagementGroupAttendance,
  HealthMetricsEngagementGroupCounts,
  HealthMetricsEngagementGroupQuery,
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementGroupTypeFilter,
} from '@lfx-one/shared/interfaces';

/**
 * `#committees` — every group ranked dormant-first then lowest attendance. The rank is the view's
 * `SORT_RANK_<period>` applied server-side: sorting the page client-side would only rank 25 rows.
 */
@Component({
  selector: 'lfx-engagement-group-attendance',
  imports: [
    DatePipe,
    EmptyStateComponent,
    FilterPillsComponent,
    TableComponent,
    TagComponent,
    EngagementAttendanceBarComponent,
    EngagementGroupAttendanceDrawerComponent,
    EngagementSparklineComponent,
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

  /** Feeds the container's sub-nav badges — the counts cover the whole filtered set, not the page. */
  public readonly countsChange = output<HealthMetricsEngagementGroupCounts>();

  protected readonly typeFilters: FilterPillOption[] = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS.map((filter) => ({
    id: filter.key,
    label: filter.label,
  }));

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly groupType = signal<HealthMetricsEngagementGroupTypeFilter>(this.parseInitialGroupType());
  protected readonly page = signal<number>(this.parseInitialPage());
  protected readonly size = signal<number>(HEALTH_METRICS_ENGAGEMENT_GROUP_PAGE_SIZE);
  protected readonly loading = signal<boolean>(true);
  protected readonly selectedRow = signal<HealthMetricsEngagementGroupRow | null>(null);
  protected readonly drawerVisible = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEngagementGroupQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementGroupAttendance> = this.initResponse();

  protected readonly rows = computed(() => this.response().rows);
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly counts = computed(() => this.response().counts);
  protected readonly first = computed(() => (this.page() - 1) * this.size());
  protected readonly countLabel = computed(() => `${this.totalRecords().toLocaleString()} ${this.totalRecords() === 1 ? 'group' : 'groups'}`);

  public constructor() {
    effect(() => this.countsChange.emit(this.counts()));
    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => this.syncUrl(query));
  }

  /** The row's numbers for the selected period; the other three stay on the row for the sparkline. */
  protected periodOf(row: HealthMetricsEngagementGroupRow): ReturnType<typeof selectHealthMetricsEngagementGroupPeriod> {
    return selectHealthMetricsEngagementGroupPeriod(row, this.chrome.selectedRange());
  }

  protected trendOf(row: HealthMetricsEngagementGroupRow): (number | null)[] {
    return buildHealthMetricsEngagementGroupTrend(row);
  }

  protected onFilterChange(key: string): void {
    this.groupType.set(this.toGroupType(key));
    this.page.set(1);
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.size();
    this.size.set(rows);
    this.page.set(Math.floor((event.first ?? 0) / rows) + 1);
  }

  protected onRowSelect(row: HealthMetricsEngagementGroupRow): void {
    this.selectedRow.set(row);
    this.drawerVisible.set(true);
  }

  private initQuery(): HealthMetricsEngagementGroupQuery {
    return {
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      projectSlug: null,
      groupType: this.groupType(),
      range: this.chrome.selectedRange(),
      page: this.page(),
      size: this.size(),
    };
  }

  private initResponse(): Signal<HealthMetricsEngagementGroupAttendance> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
    }

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap(() => this.loading.set(true)),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight
        // request for the previous one. AnalyticsService absorbs errors into the default response.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEngagementGroupAttendance(query) : of(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT)).pipe(
            tap(() => this.loading.set(false))
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT }
    );
  }

  private syncUrl(query: HealthMetricsEngagementGroupQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        groupType: query.groupType === 'all' ? null : query.groupType,
        groupPage: query.page > 1 ? query.page : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  private parseInitialGroupType(): HealthMetricsEngagementGroupTypeFilter {
    return this.toGroupType(this.initialParams.get('groupType') ?? 'all');
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get('groupPage'));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private toGroupType(key: string): HealthMetricsEngagementGroupTypeFilter {
    const match = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS.find((filter) => filter.key === key);
    return match ? match.key : 'all';
  }
}
