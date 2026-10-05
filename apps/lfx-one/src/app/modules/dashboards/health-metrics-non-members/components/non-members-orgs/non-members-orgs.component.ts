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
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE_OPTIONS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_PROVISIONAL_NOTE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_SEARCH_DEBOUNCE_MS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED,
  HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsNonMembersOrgRows, buildHealthMetricsNonMembersOrgsSummary } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, debounceTime, distinctUntilChanged, map, merge, of, skip, Subject, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  FilterPillOption,
  HealthMetricsL2Range,
  HealthMetricsNonMembersOrgRowView,
  HealthMetricsNonMembersOrgs,
  HealthMetricsNonMembersOrgsFilter,
  HealthMetricsNonMembersOrgsQuery,
} from '@lfx-one/shared/interfaces';

/**
 * `#orgs` — the non-member organizations active at the foundation in the period, busiest first.
 * Paged, filtered and searched server-side so the ranking holds across every organization, not one page.
 */
@Component({
  selector: 'lfx-non-members-orgs',
  imports: [EmptyStateComponent, FilterPillsComponent, InputTextComponent, TableComponent],
  templateUrl: './non-members-orgs.component.html',
})
export class NonMembersOrgsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Every active organization in the period, for the sub-nav badge; `null` while a new foundation or period is read, or after a failed read. */
  public readonly countChange = output<number | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly searchForm = new FormGroup({
    search: new FormControl<string>(this.parseInitialSearch(), { nonNullable: true }),
  });

  protected readonly filterOptions: FilterPillOption[] = [...HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS];
  protected readonly pageSizeOptions: number[] = [...HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE_OPTIONS];
  protected readonly provisionalNote = HEALTH_METRICS_NON_MEMBERS_ORGS_PROVISIONAL_NOTE;
  protected readonly maxSearchLength = HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH;
  protected readonly size = signal<number>(HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE);
  protected readonly filter = signal<HealthMetricsNonMembersOrgsFilter>(
    this.toFilter(this.initialParams.get(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsFilter))
  );
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation with no active organizations, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  /** Clears the search past the debounce, so "clear" lands in the same read as the filter reset. */
  private readonly searchReset = new Subject<string>();

  // Debounced so a keystroke does not fire a warehouse read; trimmed so padding cannot re-read the same cut.
  protected readonly search: Signal<string> = toSignal(
    merge(
      this.searchForm.controls.search.valueChanges.pipe(
        debounceTime(HEALTH_METRICS_NON_MEMBERS_ORGS_SEARCH_DEBOUNCE_MS),
        map((value) => this.normalizeSearch(value))
      ),
      this.searchReset
    ),
    { initialValue: this.parseInitialSearch() }
  );
  /** Any change to the cut restarts paging, since a page from a wider cut can sit past the end of a narrower one. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.range()}|${this.filter()}|${this.search()}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly query: Signal<HealthMetricsNonMembersOrgsQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsNonMembersOrgs> = this.initResponse();

  protected readonly rowViews: Signal<HealthMetricsNonMembersOrgRowView[]> = computed(() => buildHealthMetricsNonMembersOrgRows(this.response().rows));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly scopeTotal = computed(() => this.response().scopeTotal);
  protected readonly first = computed(() => (this.page() - 1) * this.size());
  protected readonly filtered = computed(() => this.filter() !== 'all' || this.search() !== '');
  protected readonly summary = computed(() => buildHealthMetricsNonMembersOrgsSummary(this.scopeTotal(), this.response().newCount));
  protected readonly totalRecordsLabel = computed(() => this.totalRecords().toLocaleString('en-US'));
  protected readonly scopeTotalLabel = computed(() => this.scopeTotal().toLocaleString('en-US'));
  protected readonly noMatchLabel = computed(() => (this.search() ? `No organization matches “${this.search()}”.` : 'No organization matches this filter.'));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.filter === b.filter && a.search === b.search && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  protected onFilterChange(id: string): void {
    this.filter.set(this.toFilter(id));
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.size();
    this.size.set(rows);
    this.page.set(Math.floor((event.first ?? 0) / rows) + 1);
  }

  protected clearFilters(): void {
    this.searchForm.setValue({ search: '' });
    this.searchReset.next('');
    this.filter.set('all');
  }

  private initQuery(): Signal<HealthMetricsNonMembersOrgsQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.range(),
      filter: this.filter(),
      search: this.search(),
      offset: (this.page() - 1) * this.size(),
      pageSize: this.size(),
    }));
  }

  private initResponse(): Signal<HealthMetricsNonMembersOrgs> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;
    // The badge counts the whole period, so only a new foundation or period blanks it; paging and filters keep it.
    let countScope: string | null = null;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          const scope = `${query.foundationSlug}|${query.range}`;
          if (scope !== countScope) {
            countScope = scope;
            this.countChange.emit(null);
          }
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getNonMembersOrgs(query) : of(HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one neither settles nor reports a count.
              if (this.clampPage(response.totalRecords)) return;

              this.loading.set(!foundationSeen);
              this.countChange.emit(query.foundationSlug && !this.loadFailed() ? response.scopeTotal : null);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED }
    );
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The participation view carries the four L2 periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }

  private syncUrl(): void {
    const query = this.query();
    const page = this.page();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsFilter]: query.filter === 'all' ? null : query.filter,
        [HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsSearch]: query.search || null,
        [HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsPage]: page > 1 ? page : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?nonPage=` past the end selects no rows while the totals still report the real count. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(totalRecords: number): boolean {
    const lastPage = Math.max(1, Math.ceil(totalRecords / this.size()));
    if (totalRecords === 0 || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialSearch(): string {
    return this.normalizeSearch(this.initialParams.get(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsSearch) ?? '');
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private normalizeSearch(value: string): string {
    return value.trim().slice(0, HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH);
  }

  private toFilter(value: string | null): HealthMetricsNonMembersOrgsFilter {
    return HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS.find((option) => option.id === value)?.id ?? 'all';
  }
}
