// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_MEMBERS_AT_RISK_BAR_CLASS,
  HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS,
  HEALTH_METRICS_MEMBERS_AT_RISK_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersAtRiskAging,
  buildHealthMetricsMembersAtRiskCountLabel,
  buildHealthMetricsMembersAtRiskNote,
  buildHealthMetricsMembersAtRiskRows,
  buildHealthMetricsMembersAtRiskSummary,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import type {
  FilterPillOption,
  HealthMetricsMembersAtRisk,
  HealthMetricsMembersAtRiskAgingView,
  HealthMetricsMembersAtRiskFilter,
  HealthMetricsMembersAtRiskQuery,
  HealthMetricsMembersAtRiskRowView,
  HealthMetricsMembersAtRiskSummaryView,
} from '@lfx-one/shared/interfaces';
import type { TablePageEvent } from 'primeng/table';

/**
 * `#risk` — members 60+ days overdue on dues in the view's own dues-at-risk order, with the foundation's aging and risk totals.
 * A snapshot of now, so the period picker does not apply; paged server-side in the view's own order.
 */
@Component({
  selector: 'lfx-members-at-risk',
  imports: [EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './members-at-risk.component.html',
})
export class MembersAtRiskComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav note, "12 overdue · $480K"; blank for a new foundation, empty when a read fails or finds no one at risk. */
  public readonly noteChange = output<string>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly filterOptions: FilterPillOption[] = [...HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS];
  protected readonly barClass = HEALTH_METRICS_MEMBERS_AT_RISK_BAR_CLASS;
  protected readonly tierPillClass = HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS;
  protected readonly size = HEALTH_METRICS_MEMBERS_AT_RISK_PAGE_SIZE;
  protected readonly bucket = signal<HealthMetricsMembersAtRiskFilter>(this.toBucket(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.atRiskBucket)));
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation with no one at risk, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** The foundation the shown response belongs to, so a new foundation's read holds the skeleton, not the old figures. */
  private readonly responseSlug = signal<string | null>(null);

  /** A new foundation or bucket restarts paging, since a page from a wider cut can sit past the end of a narrower one. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.bucket()}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly query: Signal<HealthMetricsMembersAtRiskQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersAtRisk> = this.initResponse();

  protected readonly summary: Signal<HealthMetricsMembersAtRiskSummaryView> = computed(() => buildHealthMetricsMembersAtRiskSummary(this.response().summary));
  protected readonly aging: Signal<HealthMetricsMembersAtRiskAgingView[]> = computed(() => buildHealthMetricsMembersAtRiskAging(this.response().aging));
  protected readonly rowViews: Signal<HealthMetricsMembersAtRiskRowView[]> = computed(() => buildHealthMetricsMembersAtRiskRows(this.response().rows));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly countLabel = computed(() => buildHealthMetricsMembersAtRiskCountLabel(this.totalRecords()));
  protected readonly first = computed(() => (this.page() - 1) * this.size);
  /** Holds the skeleton until a foundation's first read lands; later reads keep the figures and load in the table. */
  protected readonly firstRead = computed(
    () =>
      this.loading() &&
      (this.response() === HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED || this.responseSlug() !== (this.projectContextService.selectedFoundation()?.slug ?? ''))
  );
  /** The hero counts the whole foundation whatever the pill, so only its measured zero can say no one is at risk. */
  protected readonly noneAtRisk = computed(() => this.response().summary.memberCount === 0);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.bucket === b.bucket && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  protected onBucketChange(id: string): void {
    this.bucket.set(this.toBucket(id));
  }

  protected onTablePage(event: TablePageEvent): void {
    this.page.set(Math.floor((event.first ?? 0) / this.size) + 1);
  }

  private initQuery(): Signal<HealthMetricsMembersAtRiskQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      bucket: this.bucket(),
      offset: (this.page() - 1) * this.size,
      pageSize: this.size,
    }));
  }

  private initResponse(): Signal<HealthMetricsMembersAtRisk> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;
    // The note sums the whole foundation, so only a new foundation blanks it; paging and the pill keep it.
    let noteScope: string | null = null;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          if (query.foundationSlug !== noteScope) {
            noteScope = query.foundationSlug;
            this.noteChange.emit('');
          }
          this.reading.emit();
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight read.
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersAtRisk(query) : of(HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one neither settles, reports a note nor ends the skeleton.
              if (this.clampPage(response)) return;

              this.responseSlug.set(query.foundationSlug);

              this.loading.set(!foundationSeen);
              this.noteChange.emit(query.foundationSlug && !this.loadFailed() ? buildHealthMetricsMembersAtRiskNote(response.summary) : '');
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED }
    );
  }

  private syncUrl(): void {
    const page = this.page();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.atRiskBucket]: this.bucket() === 'all' ? null : this.bucket(),
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.atRiskPage]: page > 1 ? page : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?riskPage=` past the end selects no rows while the totals still report the real count. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(response: HealthMetricsMembersAtRisk): boolean {
    const lastPage = Math.max(1, Math.ceil(response.totalRecords / this.size));
    // The sentinel's zero is no count, so a failed read keeps the page; an empty bucket moves to page 1.
    if (response === HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.atRiskPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private toBucket(value: string | null): HealthMetricsMembersAtRiskFilter {
    return HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS.find((option) => option.id === value)?.id ?? 'all';
  }
}
