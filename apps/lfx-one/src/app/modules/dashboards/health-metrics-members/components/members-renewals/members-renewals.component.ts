// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, model, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  HEALTH_METRICS_MEMBERS_RENEWALS_DEFAULT_SORT,
  HEALTH_METRICS_MEMBERS_RENEWALS_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_RENEWALS_SORT_COLUMNS,
  HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_PHRASES,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersRenewalRows, buildHealthMetricsMembersRenewalsMetrics } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';

import type {
  HealthMetricsMembersRenewalRowView,
  HealthMetricsMembersRenewals,
  HealthMetricsMembersRenewalsQuery,
  HealthMetricsMembersRenewalsWindow,
  HealthMetricsMetricItem,
} from '@lfx-one/shared/interfaces';

/**
 * `#renewals` — memberships renewing inside the chosen window, highest dues first, with the value they carry. A
 * snapshot of now, so the period picker does not apply; paged and sorted server-side.
 */
@Component({
  selector: 'lfx-members-renewals',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsThComponent,
    Skeleton,
    TableComponent,
    UiPaginationComponent,
  ],
  templateUrl: './members-renewals.component.html',
})
export class MembersRenewalsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Fires once the section settles; its height changes, moving every anchor below. `false` once renewals are due;
   * a window with none gives no verdict, keeping its own note and the header's window switch to widen it.
   */
  public readonly settled = output<boolean | null>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  /** The header's window switch lives in the page's section controls, so the page owns the window. */
  public readonly window = model<HealthMetricsMembersRenewalsWindow>(HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS[0]);

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly size = HEALTH_METRICS_MEMBERS_RENEWALS_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation with no renewals due, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** The foundation the shown response belongs to, so a new foundation's read holds the skeleton, not the old figures. */
  private readonly responseSlug = signal<string | null>(null);
  /** The window the shown response belongs to, so a window change holds its own skeleton. */
  private readonly responseWindow = signal<HealthMetricsMembersRenewalsWindow | null>(null);

  /** Sorted on the server across every page; the default is the highest dues first. */
  protected readonly sorting = injectHealthMetricsTableSort(HEALTH_METRICS_MEMBERS_RENEWALS_SORT_COLUMNS, HEALTH_METRICS_MEMBERS_RENEWALS_DEFAULT_SORT);
  /** Zero-based, as the pager counts. A new foundation, window or order restarts paging, since a wider window's page can sit past a narrower one's end. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.window()}|${JSON.stringify(this.sorting.sort())}`),
    computation: (_scope, previous) => (previous === undefined ? this.parseInitialPage() : 0),
  });

  protected readonly query: Signal<HealthMetricsMembersRenewalsQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersRenewals> = this.initResponse();

  protected readonly metrics: Signal<HealthMetricsMetricItem[]> = computed(() => buildHealthMetricsMembersRenewalsMetrics(this.response().summary));
  protected readonly rowViews: Signal<HealthMetricsMembersRenewalRowView[]> = computed(() => buildHealthMetricsMembersRenewalRows(this.response().rows));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  /** Holds the skeleton until a foundation's first read lands, failed or not. */
  protected readonly firstRead = computed(() => {
    const slug = this.projectContextService.selectedFoundation()?.slug ?? '';
    return this.loading() && (!slug || this.responseSlug() !== slug);
  });
  protected readonly windowRead = computed(() => this.loading() && this.responseWindow() !== this.window());
  /** Needs no matched rows and a measured zero total, so neither a row nor the model's count is contradicted. */
  protected readonly noneDue = computed(() => this.totalRecords() === 0 && this.response().summary.renewalCount === 0);
  protected readonly windowPhrase = computed(() => HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_PHRASES[this.window()]);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.query)
        .pipe(
          // `skip(1)` drops the state just read out of the URL; writing it back would be a no-op during hydration.
          skip(1),
          distinctUntilChanged((a, b) => a.window === b.window && a.offset === b.offset),
          takeUntilDestroyed()
        )
        .subscribe(() => this.syncUrl());
    }
  }

  private initQuery(): Signal<HealthMetricsMembersRenewalsQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      window: this.window(),
      offset: this.page() * this.size,
      pageSize: this.size,
      sort: this.sorting.order(),
    }));
  }

  private initResponse(): Signal<HealthMetricsMembersRenewals> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getMembersRenewals(query) : of(HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED);
            }),
            tap((response) => {
              // A clamped page fires a follow-up read, so this one neither settles nor ends the skeleton.
              if (this.clampPage(response)) return;

              this.responseSlug.set(query.foundationSlug);
              this.responseWindow.set(query.window);

              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && response.totalRecords === 0 && response.summary.renewalCount === 0 ? null : false);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED }
    );
  }

  private syncUrl(): void {
    const page = this.page();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsWindow]: this.window() === HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS[0] ? null : this.window(),
        // The URL counts pages from 1.
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsPage]: page > 0 ? page + 1 : null,
      },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /**
   * A `?renewalsPage=` past the end selects no rows while the totals still report the real count. Lands on
   * the last page with rows, writing it back since the clamp can precede the sync's first emission.
   */
  private clampPage(response: HealthMetricsMembersRenewals): boolean {
    const lastPage = Math.max(0, Math.ceil(response.totalRecords / this.size) - 1);
    // The sentinel's zero is no count, so a failed read keeps the page; an empty foundation moves to the first page.
    if (response === HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  /** The URL's 1-based page as the pager's 0-based one. */
  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsPage));
    return Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0;
  }
}
