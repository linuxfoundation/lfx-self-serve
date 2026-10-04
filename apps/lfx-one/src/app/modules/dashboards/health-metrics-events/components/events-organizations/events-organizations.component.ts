// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_BAR_CLASS,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_PAGE_SIZE,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEARCH_DEBOUNCE_MS,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED,
  HEALTH_METRICS_EVENTS_QUERY_PARAMS,
  HEALTH_METRICS_L2_RANGES,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsOrganizationRowView, formatHealthMetricsEventsOrganizationsCountLabel } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  FilterPillOption,
  HealthMetricsEventsOrganizationRowView,
  HealthMetricsEventsOrganizations,
  HealthMetricsEventsOrganizationsQuery,
  HealthMetricsEventsOrganizationsSegment,
  HealthMetricsL2Range,
} from '@lfx-one/shared/interfaces';

/**
 * `#orgs` — every organization active at the foundation's events in the period, ranked by registrations.
 * Paged, filtered and searched server-side: the view's `sort_rank_<period>` only holds across the full set.
 */
@Component({
  selector: 'lfx-events-organizations',
  imports: [AvatarComponent, EmptyStateComponent, FilterPillsComponent, InputTextComponent, TableComponent],
  templateUrl: './events-organizations.component.html',
})
export class EventsOrganizationsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Every active organization in the period, for the sub-nav badge; `null` while a read is pending or failed. */
  public readonly countChange = output<number | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>(this.parseInitialSearch(), { nonNullable: true }) });

  protected readonly segmentOptions: FilterPillOption[] = [...HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS];
  protected readonly barClass = HEALTH_METRICS_EVENTS_ORGANIZATIONS_BAR_CLASS;
  protected readonly segment = signal<HealthMetricsEventsOrganizationsSegment>(
    this.toSegment(this.initialParams.get(HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgSegment))
  );
  protected readonly size = signal<number>(HEALTH_METRICS_EVENTS_ORGANIZATIONS_PAGE_SIZE);
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  // Debounced so a keystroke does not fire a warehouse read; trimmed so padding cannot re-read the same cut.
  protected readonly search: Signal<string> = toSignal(
    this.searchForm.controls.search.valueChanges.pipe(
      debounceTime(HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEARCH_DEBOUNCE_MS),
      map((value) => this.normalizeSearch(value))
    ),
    { initialValue: this.parseInitialSearch() }
  );
  /** Any change to the cut restarts paging, since a page from a wider cut can sit past the end of a narrower one. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.range()}|${this.segment()}|${this.search()}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly query: Signal<HealthMetricsEventsOrganizationsQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsEventsOrganizations> = this.initResponse();

  protected readonly rowViews: Signal<HealthMetricsEventsOrganizationRowView[]> = computed(() =>
    this.response().rows.map(buildHealthMetricsEventsOrganizationRowView)
  );
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly scopeTotal = computed(() => this.response().scopeTotal);
  protected readonly first = computed(() => (this.page() - 1) * this.size());
  protected readonly countLabel = computed(() => formatHealthMetricsEventsOrganizationsCountLabel(this.totalRecords()));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.segment === b.segment && a.search === b.search && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  protected onSegmentChange(id: string): void {
    this.segment.set(this.toSegment(id));
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.size();
    this.size.set(rows);
    this.page.set(Math.floor((event.first ?? 0) / rows) + 1);
  }

  private initQuery(): Signal<HealthMetricsEventsOrganizationsQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.range(),
      segment: this.segment(),
      search: this.search(),
      offset: (this.page() - 1) * this.size(),
      pageSize: this.size(),
    }));
  }

  private initResponse(): Signal<HealthMetricsEventsOrganizations> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED);
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
          this.countChange.emit(null);
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getEventsOrganizations(query) : of(HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED);
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
      { initialValue: HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED }
    );
  }

  private range(): HealthMetricsL2Range {
    const range = this.chrome.selectedRange();
    // The Events pills only offer the view's four periods; anything else falls back to the default.
    return HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === range) ?? 'YTD';
  }

  private syncUrl(): void {
    const query = this.query();
    const page = this.page();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgSegment]: query.segment === 'all' ? null : query.segment,
        [HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgSearch]: query.search || null,
        [HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgPage]: page > 1 ? page : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?orgPage=` past the end selects no rows while the totals still report the real count. Lands on
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
    return this.normalizeSearch(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgSearch) ?? '');
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private normalizeSearch(value: string): string {
    return value.trim().slice(0, HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_SEARCH_LENGTH);
  }

  private toSegment(id: string | null): HealthMetricsEventsOrganizationsSegment {
    return HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS.find((option) => option.id === id)?.id ?? 'all';
  }
}
