// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_MEMBERS_DIRECTORY_ALL_TIERS_OPTION,
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_TIER_LENGTH,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NOT_TRACKED,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_OPTIONS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE_OPTIONS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_SEARCH_DEBOUNCE_MS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIERS_UNAVAILABLE_OPTION,
  HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  HEALTH_METRICS_L2_RANGES,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersDirectoryRows,
  buildHealthMetricsMembersDirectorySearchPlaceholder,
  buildHealthMetricsMembersDirectorySummary,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, debounceTime, distinctUntilChanged, map, merge, of, skip, startWith, Subject, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

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
 * `#list` — the foundation's whole member directory, highest annual dues first.
 * Paged, filtered and searched server-side so the sort holds across every member, not one page.
 */
@Component({
  selector: 'lfx-members-directory',
  imports: [EmptyStateComponent, InputTextComponent, SelectComponent, TableComponent],
  templateUrl: './members-directory.component.html',
})
export class MembersDirectoryComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Every member of the foundation, for the sub-nav badge; `null` while a read is pending or failed. */
  public readonly countChange = output<number | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(this.parseInitialSearch(), { nonNullable: true }),
    tier: new FormControl<string>(this.parseInitialTier(), { nonNullable: true }),
    nps: new FormControl<string>(this.toNps(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryNps)), { nonNullable: true }),
  });

  protected readonly npsOptions: FilterOption<string>[] = [...HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_OPTIONS];
  protected readonly pageSizeOptions: number[] = [...HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE_OPTIONS];
  protected readonly tierPillClass = HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS;
  protected readonly notTracked = HEALTH_METRICS_MEMBERS_DIRECTORY_NOT_TRACKED;
  protected readonly size = signal<number>(HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE);
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  /** Clears the search past the debounce, so "clear" lands in the same read as the tier and NPS reset. */
  private readonly searchReset = new Subject<string>();

  // Debounced so a keystroke does not fire a warehouse read; trimmed so padding cannot re-read the same cut.
  protected readonly search: Signal<string> = toSignal(
    merge(
      this.filterForm.controls.search.valueChanges.pipe(
        debounceTime(HEALTH_METRICS_MEMBERS_DIRECTORY_SEARCH_DEBOUNCE_MS),
        map((value) => this.normalizeSearch(value))
      ),
      this.searchReset
    ),
    { initialValue: this.parseInitialSearch() }
  );
  protected readonly tier: Signal<string> = toSignal(this.filterForm.controls.tier.valueChanges.pipe(map((value) => value ?? '')), {
    initialValue: this.filterForm.controls.tier.value,
  });
  protected readonly nps: Signal<HealthMetricsMembersNpsCategory | ''> = toSignal(
    this.filterForm.controls.nps.valueChanges.pipe(
      startWith(this.filterForm.controls.nps.value),
      map((value) => this.toNps(value))
    ),
    { requireSync: true }
  );
  /** Any change to the cut restarts paging, since a page from a wider cut can sit past the end of a narrower one. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.range()}|${this.tier()}|${this.nps()}|${this.search()}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly query: Signal<HealthMetricsMembersDirectoryQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersDirectory> = this.initResponse();

  protected readonly rowViews: Signal<HealthMetricsMembersDirectoryRowView[]> = computed(() => buildHealthMetricsMembersDirectoryRows(this.response().rows));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly scopeTotal = computed(() => this.response().scopeTotal);
  protected readonly first = computed(() => (this.page() - 1) * this.size());
  protected readonly filtered = computed(() => this.tier() !== '' || this.nps() !== '' || this.search() !== '');
  protected readonly summary = computed(() => buildHealthMetricsMembersDirectorySummary(this.scopeTotal(), this.response().atRiskCount));
  protected readonly totalRecordsLabel = computed(() => this.totalRecords().toLocaleString('en-US'));
  protected readonly scopeTotalLabel = computed(() => this.scopeTotal().toLocaleString('en-US'));
  // Count-free until a read lands, so the box never offers to search "0 members".
  protected readonly searchPlaceholder = computed(() =>
    this.response() === HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED ? 'Search members…' : buildHealthMetricsMembersDirectorySearchPlaceholder(this.scopeTotal())
  );
  protected readonly noMatchLabel = computed(() => (this.search() ? `No member matches “${this.search()}”.` : 'No member matches these filters.'));
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

  protected onTablePage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.size();
    this.size.set(rows);
    this.page.set(Math.floor((event.first ?? 0) / rows) + 1);
  }

  protected clearFilters(): void {
    this.filterForm.setValue({ search: '', tier: '', nps: '' });
    this.searchReset.next('');
  }

  private initQuery(): Signal<HealthMetricsMembersDirectoryQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.range(),
      tier: this.tier(),
      nps: this.nps(),
      search: this.search(),
      offset: (this.page() - 1) * this.size(),
      pageSize: this.size(),
    }));
  }

  private initResponse(): Signal<HealthMetricsMembersDirectory> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;
    // The badge counts the whole foundation, so only a new foundation or period blanks it; paging and filters keep it.
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
          (query.foundationSlug ? this.analyticsService.getMembersDirectory(query) : of(HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED);
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
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryPage]: page > 1 ? page : null,
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
    const lastPage = Math.max(1, Math.ceil(totalRecords / this.size()));
    if (totalRecords === 0 || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialSearch(): string {
    return this.normalizeSearch(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directorySearch) ?? '');
  }

  // Tier names come from the view, so the URL value is only bounded here; the read validates it again.
  private parseInitialTier(): string {
    const tier = (this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryTier) ?? '').trim();
    return tier.length > HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_TIER_LENGTH ? '' : tier;
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private normalizeSearch(value: string): string {
    return value.trim().slice(0, HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH);
  }

  private toNps(value: string | null): HealthMetricsMembersNpsCategory | '' {
    return HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES.find((category) => category === value) ?? '';
  }
}
