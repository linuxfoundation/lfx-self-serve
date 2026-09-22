// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_ORG_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_ORG_SEARCH_DEBOUNCE_MS,
  HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED,
} from '@lfx-one/shared/constants';
import {
  filterHealthMetricsEngagementOrgRows,
  formatHealthMetricsEngagementAvgReps,
  formatIsoDateLabel,
  selectHealthMetricsEngagementOrgPeriod,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { EngagementAttendanceBarComponent } from '../engagement-attendance-bar/engagement-attendance-bar.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { TablePageEvent } from 'primeng/table';

import type {
  FilterPillOption,
  HealthMetricsEngagementOrgCounts,
  HealthMetricsEngagementOrgFilter,
  HealthMetricsEngagementOrgParticipation,
  HealthMetricsEngagementOrgQuery,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementOrgRowView,
} from '@lfx-one/shared/interfaces';

/**
 * `#orgs` — every organization that turns up, ranked by the view's `SORT_RANK_<period>`. The read
 * carries all four periods, so the period pill, the search box and the lapsed cut all project the
 * loaded rows rather than re-reading.
 */
@Component({
  selector: 'lfx-engagement-org-participation',
  imports: [EmptyStateComponent, FilterPillsComponent, InputTextComponent, TableComponent, EngagementAttendanceBarComponent],
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
   * Feeds the container's sub-nav badge. `null` is "no measured counts" — a read starting, a failed
   * read, or no foundation selected — and renders no badge rather than a believable zero.
   */
  public readonly countsChange = output<HealthMetricsEngagementOrgCounts | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the container knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly filterOptions: FilterPillOption[] = HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS.map((filter) => ({
    id: filter.key,
    label: filter.label,
  }));

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly filter = signal<HealthMetricsEngagementOrgFilter>(this.parseInitialFilter());
  protected readonly size = signal<number>(HEALTH_METRICS_ENGAGEMENT_ORG_PAGE_SIZE);
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  // Debounced: the filter runs over the whole loaded scope, so an undebounced keystroke re-sorts
  // every org the foundation has.
  protected readonly search = toSignal(this.searchForm.controls.search.valueChanges.pipe(debounceTime(HEALTH_METRICS_ENGAGEMENT_ORG_SEARCH_DEBOUNCE_MS)), {
    initialValue: '',
  });

  protected readonly query: Signal<HealthMetricsEngagementOrgQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementOrgParticipation> = this.initResponse();

  /** Narrowing the table must land the reader on rows, so any change to the cut restarts paging. */
  protected readonly first = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.filter()}|${this.search()}|${this.chrome.selectedRange()}`),
    computation: () => 0,
  });

  // Resolved once per response and period rather than per cell or per keystroke: `formatIsoDateLabel`
  // builds a fresh `Intl` formatter per call, which the search must not pay for on every character.
  private readonly rowViewsByRow = computed(() => {
    const range = this.chrome.selectedRange();
    return new Map<HealthMetricsEngagementOrgRow, HealthMetricsEngagementOrgRowView>(
      this.response().rows.map((row) => {
        const period = selectHealthMetricsEngagementOrgPeriod(row, range);

        return [
          row,
          {
            row,
            period,
            lastEngagedLabel: row.lastEngagedDate ? formatIsoDateLabel(row.lastEngagedDate) : '—',
            avgRepsLabel: formatHealthMetricsEngagementAvgReps(period?.avgReps ?? null),
          },
        ];
      })
    );
  });
  // The cut narrows rows the labels are already resolved for, so a keystroke only filters and sorts.
  protected readonly rowViews = computed<HealthMetricsEngagementOrgRowView[]>(() => {
    const views = this.rowViewsByRow();
    return filterHealthMetricsEngagementOrgRows(this.response().rows, this.filter(), this.search(), this.chrome.selectedRange())
      .map((row) => views.get(row))
      .filter((view) => view !== undefined);
  });
  protected readonly totalRecords = computed(() => this.rowViews().length);
  /** The caption counts the whole foundation, not the filtered cut — both come off the view. */
  protected readonly countLabel = computed(() => {
    const counts = this.response().counts;
    if (!counts) return '—';

    // Locale pinned so the server-rendered caption and the hydrated one agree on separators.
    return `${counts.orgs.toLocaleString('en-US')} ${counts.orgs === 1 ? 'organization' : 'organizations'} · ${counts.lapsedOrgs.toLocaleString('en-US')} lapsed`;
  });

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

  protected onFilterChange(key: string): void {
    this.filter.set(this.toFilter(key));
  }

  protected onTablePage(event: TablePageEvent): void {
    this.size.set(event.rows ?? this.size());
    this.first.set(event.first ?? 0);
  }

  private initQuery(): HealthMetricsEngagementOrgQuery {
    return { foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '' };
  }

  private initResponse(): Signal<HealthMetricsEngagementOrgParticipation> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED);
    }

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap(() => {
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
              // An unresolved foundation is not a measured empty scope: the skeleton stays up, as
              // on the Overview, so the table cannot caption an unread scope as "no rows".
              this.loading.set(!query.foundationSlug);
              // No foundation means no read happened, so there is no measured count to report.
              this.countsChange.emit(query.foundationSlug && !this.loadFailed() ? response.counts : null);
              // Emitted separately from the counts: a failed or foundation-less read reports no
              // counts and still settles, and the container would otherwise wait on it forever.
              this.settled.emit();
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
      queryParams: { orgFilter: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  private parseInitialFilter(): HealthMetricsEngagementOrgFilter {
    return this.toFilter(this.initialParams.get('orgFilter') ?? 'all');
  }

  private toFilter(key: string): HealthMetricsEngagementOrgFilter {
    const match = HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS.find((filter) => filter.key === key);
    return match ? match.key : 'all';
  }
}
