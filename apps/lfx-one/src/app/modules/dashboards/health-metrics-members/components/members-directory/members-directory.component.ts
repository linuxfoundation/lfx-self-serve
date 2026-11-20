// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ALL_TIERS_OPTION,
  HEALTH_METRICS_MEMBERS_DIRECTORY_DEFAULT_SORT,
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_TIER_LENGTH,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_OPTIONS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_DIRECTORY_SEARCH_DEBOUNCE_MS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_SORT_COLUMNS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIERS_UNAVAILABLE_OPTION,
  HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersDirectoryRows } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { catchError, debounce, distinctUntilChanged, map, of, skip, switchMap, tap, timer } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersEngagementBadgeComponent } from '../members-engagement-badge/members-engagement-badge.component';

import type {
  FilterOption,
  HealthMetricsL2Range,
  HealthMetricsMembersDirectory,
  HealthMetricsMembersDirectoryQuery,
  HealthMetricsMembersDirectoryRowView,
  HealthMetricsMembersDirectoryTierOption,
  HealthMetricsMembersNpsCategory,
} from '@lfx-one/shared/interfaces';

/**
 * `#list` — every member, highest annual dues first. Paged, filtered, searched and sorted server-side so the order
 * holds across every member, not one page.
 */
@Component({
  selector: 'lfx-members-directory',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsThComponent,
    MembersEngagementBadgeComponent,
    TableComponent,
    UiOptionComponent,
    UiPaginationComponent,
    UiSearchInputComponent,
    UiSelectComponent,
  ],
  templateUrl: './members-directory.component.html',
})
export class MembersDirectoryComponent {
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

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly npsOptions: readonly FilterOption<string>[] = HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_OPTIONS;
  protected readonly size = HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE;
  protected readonly searchText = signal<string>(this.normalizeSearch(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directorySearch) ?? ''));
  protected readonly tierValue = signal<string | null>(this.parseInitialTier());
  protected readonly npsValue = signal<string | null>(this.toNps(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryNps)));
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  // Typing is debounced so a keystroke does not fire a warehouse read; a cleared search applies at once, so a reset never lags.
  protected readonly search: Signal<string> = toSignal(
    toObservable(this.searchText).pipe(
      map((value) => this.normalizeSearch(value)),
      debounce((term) => (term ? timer(HEALTH_METRICS_MEMBERS_DIRECTORY_SEARCH_DEBOUNCE_MS) : of(0)))
    ),
    { initialValue: this.searchText() }
  );
  protected readonly tier = computed(() => this.tierValue() ?? '');
  protected readonly nps = computed(() => this.toNps(this.npsValue()));
  /** Sorted on the server across every page; the default keeps the view's rank. */
  protected readonly sorting = injectHealthMetricsTableSort(HEALTH_METRICS_MEMBERS_DIRECTORY_SORT_COLUMNS, HEALTH_METRICS_MEMBERS_DIRECTORY_DEFAULT_SORT);
  /** Zero-based, as the pager counts. Any change to the cut or the order restarts paging, since a wider cut's page can sit past a narrower one's end. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(
      () =>
        `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.range()}|${this.tier()}|${this.nps()}|${this.search()}|${JSON.stringify(this.sorting.sort())}`
    ),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 0),
  });

  protected readonly query: Signal<HealthMetricsMembersDirectoryQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersDirectory> = this.initResponse();

  protected readonly rowViews: Signal<HealthMetricsMembersDirectoryRowView[]> = computed(() => buildHealthMetricsMembersDirectoryRows(this.response().rows));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  /** The foundation had no member in the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && !this.response().scopeTotal);
  // Keeps a URL-seeded tier selectable before (or without) the read listing it.
  protected readonly tierOptions: Signal<HealthMetricsMembersDirectoryTierOption[]> = this.initTierOptions();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.tier === b.tier && a.nps === b.nps && a.search === b.search && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  /** Clears the search, both selects and the page, as the empty state offers; the sort stays. */
  protected onResetFilters(): void {
    this.searchText.set('');
    this.tierValue.set('');
    this.npsValue.set('');
  }

  private initQuery(): Signal<HealthMetricsMembersDirectoryQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.range(),
      tier: this.tier(),
      nps: this.nps(),
      search: this.search(),
      offset: this.page() * this.size,
      pageSize: this.size,
      sort: this.sorting.order(),
    }));
  }

  private initResponse(): Signal<HealthMetricsMembersDirectory> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getMembersDirectory(query) : of(HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one does not settle.
              if (this.clampPage(response.totalRecords)) return;

              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && !response.scopeTotal);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED }
    );
  }

  /** Read once per foundation, not per page; a failed read leaves "All tiers", a notice and the selected tier. */
  private initTierOptions(): Signal<HealthMetricsMembersDirectoryTierOption[]> {
    // `null` is a failed read, kept apart from a foundation with no tiers.
    const tiers: Signal<string[] | null> = isPlatformBrowser(this.platformId)
      ? toSignal(
          toObservable(computed(() => this.projectContextService.selectedFoundation()?.slug ?? '')).pipe(
            distinctUntilChanged(),
            switchMap((slug) =>
              slug
                ? this.analyticsService.getMembersDirectoryTiers(slug).pipe(
                    map((response): string[] | null => response.tiers),
                    catchError(() => of(null))
                  )
                : of([] as string[])
            )
          ),
          { initialValue: [] as string[] }
        )
      : signal<string[]>([]);

    return computed(() => {
      const read = tiers();
      const listed = read ?? [];
      const selected = this.tier();
      const options = selected && !listed.includes(selected) ? [...listed, selected] : listed;
      const notice = read === null ? [HEALTH_METRICS_MEMBERS_DIRECTORY_TIERS_UNAVAILABLE_OPTION] : [];
      return [HEALTH_METRICS_MEMBERS_DIRECTORY_ALL_TIERS_OPTION, ...notice, ...options.map((tier) => ({ label: tier, value: tier }))];
    });
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The directory's activity columns carry the view's four periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }

  private syncUrl(): void {
    const query = this.query();
    const page = this.page();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryTier]: query.tier || null,
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryNps]: query.nps || null,
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directorySearch]: query.search || null,
        // The URL counts pages from 1.
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryPage]: page > 0 ? page + 1 : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?memPage=` past the end selects no rows while the totals still report the real count. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(totalRecords: number): boolean {
    const lastPage = Math.max(0, Math.ceil(totalRecords / this.size) - 1);
    if (totalRecords === 0 || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  // Tier names come from the view, so the URL value is only bounded here; the read validates it again.
  private parseInitialTier(): string {
    const tier = (this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryTier) ?? '').trim();
    return tier.length > HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_TIER_LENGTH ? '' : tier;
  }

  /** The URL's 1-based page as the pager's 0-based one. */
  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryPage));
    return Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0;
  }

  private normalizeSearch(value: string): string {
    return value.trim().slice(0, HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH);
  }

  private toNps(value: string | null): HealthMetricsMembersNpsCategory | '' {
    return HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES.find((category) => category === value) ?? '';
  }
}
