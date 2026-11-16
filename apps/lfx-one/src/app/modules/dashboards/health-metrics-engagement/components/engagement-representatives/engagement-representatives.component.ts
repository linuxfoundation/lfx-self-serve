// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, model, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
  HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_REP_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEngagementRepRowView,
  filterHealthMetricsEngagementRepRows,
  parseHealthMetricsEngagementRepFilter,
  selectHealthMetricsEngagementRepCounts,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { catchError, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementRepFilter,
  HealthMetricsEngagementRepNoteCounts,
  HealthMetricsEngagementRepQuery,
  HealthMetricsEngagementRepRow,
  HealthMetricsEngagementRepRowView,
  HealthMetricsEngagementRepresentatives,
  HealthMetricsRange,
} from '@lfx-one/shared/interfaces';

/**
 * `#reps` — the people behind the member companies, longest-absent first. The read carries all four
 * periods, so the period, the search and the three cuts project the loaded rows rather than re-reading.
 */
@Component({
  selector: 'lfx-engagement-representatives',
  imports: [EmptyStateComponent, HealthMetricsCellComponent, TableComponent, UiBadgeComponent, UiPaginationComponent, UiSearchInputComponent],
  templateUrl: './engagement-representatives.component.html',
})
export class EngagementRepresentativesComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Feeds the container's sub-nav note. This view counts its scope per period, so the note follows
   * the pill; `null` is "no measured counts" and renders no note.
   */
  public readonly countsChange = output<HealthMetricsEngagementRepNoteCounts | null>();
  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The header's switch lives in the page's section controls, so the page owns the cut. */
  public readonly filter = model<HealthMetricsEngagementRepFilter>('all');

  protected readonly size = HEALTH_METRICS_ENGAGEMENT_REP_PAGE_SIZE;
  protected readonly searchText = signal<string>('');
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  // Debounced, as the cut runs over the whole loaded scope; `skip(1)` drops the empty start the signal already holds,
  // so the debounce never runs on a value nobody typed.
  protected readonly search = toSignal(toObservable(this.searchText).pipe(skip(1), debounceTime(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS)), {
    initialValue: '',
  });

  protected readonly query: Signal<HealthMetricsEngagementRepQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementRepresentatives> = this.initResponse();

  /** Narrowing the table must land the reader on rows, so any change to the cut restarts paging. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.filter()}|${this.search()}|${this.chrome.selectedRange()}`),
    computation: () => 0,
  });

  private readonly rowViewsByRow: Signal<Map<HealthMetricsEngagementRepRow, HealthMetricsEngagementRepRowView>> = this.initRowViewsByRow();
  protected readonly rowViews: Signal<HealthMetricsEngagementRepRowView[]> = this.initRowViews();
  protected readonly pageRows = computed(() => this.rowViews().slice(this.page() * this.size, (this.page() + 1) * this.size));
  protected readonly totalRecords = computed(() => this.rowViews().length);
  /** The whole foundation's scope is empty when the read carried no rows at all — a filtered cut
   * with zero matches over a non-empty scope is a real measured zero. */
  /** No representative was invited in the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && isEmptyScope(this.response(), this.chrome.selectedRange()));

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

      // A link elsewhere on the tab (e.g. "Never attended") can set the filter after this section loaded.
      this.route.queryParamMap
        .pipe(
          map((params) => parseHealthMetricsEngagementRepFilter(params.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.repFilter))),
          distinctUntilChanged(),
          skip(1),
          takeUntilDestroyed()
        )
        .subscribe((filter) => this.filter.set(filter));

      // The note counts are per period, so a pill change re-reports them off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.emitCounts());
    }
  }

  protected onResetFilters(): void {
    this.searchText.set('');
    this.filter.set('all');
  }

  // Keyed off the response alone because these labels are all-time: `formatIsoDateLabel` builds a
  // fresh `Intl` formatter per call, and the period pill must not pay for one per loaded row.
  // Built once per response and period rather than per keystroke: the date label builds an `Intl` formatter per call.
  private initRowViewsByRow(): Signal<Map<HealthMetricsEngagementRepRow, HealthMetricsEngagementRepRowView>> {
    return computed(() => {
      const range = this.chrome.selectedRange();
      return new Map<HealthMetricsEngagementRepRow, HealthMetricsEngagementRepRowView>(
        this.response().rows.map((row) => [row, buildHealthMetricsEngagementRepRowView(row, range)])
      );
    });
  }

  private initRowViews(): Signal<HealthMetricsEngagementRepRowView[]> {
    return computed(() => {
      const views = this.rowViewsByRow();

      return filterHealthMetricsEngagementRepRows(this.response().rows, this.filter(), this.search(), this.chrome.selectedRange())
        .map((row) => views.get(row))
        .filter((view) => view !== undefined);
    });
  }

  private initQuery(): HealthMetricsEngagementRepQuery {
    return { foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '' };
  }

  private initResponse(): Signal<HealthMetricsEngagementRepresentatives> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getEngagementRepresentatives(query) : of(HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED)).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED);
            }),
            tap((response) => {
              // An unresolved foundation is not a measured empty scope: the skeleton stays up, so
              // the table cannot caption an unread scope as "no rows".
              this.loading.set(!foundationSeen);
              // No foundation means no read happened, so there is no measured count to report.
              this.countsChange.emit(
                query.foundationSlug && !this.loadFailed() ? selectHealthMetricsEngagementRepCounts(response.counts, this.chrome.selectedRange()) : null
              );
              // Held until a foundation has been seen: settling an unread section releases the
              // L2 shell's pending deep link before any real read can re-arm it.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && isEmptyScope(response, this.chrome.selectedRange()));
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED }
    );
  }

  /** Re-reports the note counts off the already-loaded response; a failed or unread scope stays `null`. */
  private emitCounts(): void {
    // A read in flight still holds the previous foundation's payload, so a pill change mid-load
    // would republish counts the note has already been told to drop.
    if (this.loadFailed() || this.loading()) return;

    this.countsChange.emit(selectHealthMetricsEngagementRepCounts(this.response().counts, this.chrome.selectedRange()));
    // A period change re-projects the table, moving the section's height.
    this.settled.emit(isEmptyScope(this.response(), this.chrome.selectedRange()));
  }

  private syncUrl(filter: HealthMetricsEngagementRepFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.repFilter]: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }
}

/** No representative invited in the period, as the unfiltered table shows it; unmeasured counts only caption the rows. */
function isEmptyScope(response: HealthMetricsEngagementRepresentatives, range: HealthMetricsRange): boolean {
  return filterHealthMetricsEngagementRepRows(response.rows, 'all', '', range).length === 0;
}
