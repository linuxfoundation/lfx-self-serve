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
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  HEALTH_METRICS_MEMBERS_RENEWALS_BALANCE_MARKER,
  HEALTH_METRICS_MEMBERS_RENEWALS_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_RENEWALS_RENEWED_MARKER,
  HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_OPTIONS,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_PHRASES,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersRenewalRows,
  buildHealthMetricsMembersRenewalsCountLabel,
  buildHealthMetricsMembersRenewalsSummary,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import type {
  HealthMetricsMembersRenewalRowView,
  HealthMetricsMembersRenewals,
  HealthMetricsMembersRenewalsQuery,
  HealthMetricsMembersRenewalsSummaryView,
  HealthMetricsMembersRenewalsWindow,
  HealthMetricsMembersRenewalsWindowOption,
} from '@lfx-one/shared/interfaces';
import type { TablePageEvent } from 'primeng/table';

/**
 * `#renewals` — memberships renewing inside the chosen window, soonest first, with the dues they carry; ones already
 * renewed stay listed and marked. A snapshot of now, so the period picker does not apply; paged server-side.
 */
@Component({
  selector: 'lfx-members-renewals',
  imports: [EmptyStateComponent, FilterPillsComponent, Skeleton, TableComponent],
  templateUrl: './members-renewals.component.html',
})
export class MembersRenewalsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav count, renewals in the window; `null` while a foundation reads or when its read fails. */
  public readonly countChange = output<number | null>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly tierPillClass = HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS;
  protected readonly marker = HEALTH_METRICS_MEMBERS_RENEWALS_BALANCE_MARKER;
  protected readonly renewedMarker = HEALTH_METRICS_MEMBERS_RENEWALS_RENEWED_MARKER;
  protected readonly windowOptions: HealthMetricsMembersRenewalsWindowOption[] = [...HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_OPTIONS];
  protected readonly size = HEALTH_METRICS_MEMBERS_RENEWALS_PAGE_SIZE;
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation with no renewals due, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** The foundation the shown response belongs to, so a new foundation's read holds the skeleton, not the old figures. */
  private readonly responseSlug = signal<string | null>(null);
  /** The window the shown response belongs to, so a window change holds its own skeleton under the pills. */
  private readonly responseWindow = signal<HealthMetricsMembersRenewalsWindow | null>(null);
  protected readonly window = signal<HealthMetricsMembersRenewalsWindow>(
    this.toWindow(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsWindow))
  );

  /** A new foundation or window restarts paging, since a page from a wider window can sit past the end of a narrower one. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.projectContextService.selectedFoundation()?.slug ?? ''}|${this.window()}`),
    computation: (_slug, previous) => (previous === undefined ? this.parseInitialPage() : 1),
  });

  protected readonly query: Signal<HealthMetricsMembersRenewalsQuery> = this.initQuery();
  protected readonly response: Signal<HealthMetricsMembersRenewals> = this.initResponse();

  protected readonly summary: Signal<HealthMetricsMembersRenewalsSummaryView> = computed(() =>
    buildHealthMetricsMembersRenewalsSummary(this.response().summary)
  );
  protected readonly rowViews: Signal<HealthMetricsMembersRenewalRowView[]> = computed(() => buildHealthMetricsMembersRenewalRows(this.response().rows));
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly countLabel = computed(() => buildHealthMetricsMembersRenewalsCountLabel(this.totalRecords()));
  protected readonly first = computed(() => (this.page() - 1) * this.size);
  /** Holds the skeleton until a foundation's first read lands, failed or not, so a later window read keeps the pills. */
  protected readonly firstRead = computed(() => {
    const slug = this.projectContextService.selectedFoundation()?.slug ?? '';
    return this.loading() && (!slug || this.responseSlug() !== slug);
  });
  protected readonly windowRead = computed(() => this.loading() && this.responseWindow() !== this.window());
  /** Needs no matched rows and a measured zero total, so neither a row nor the sub-nav's model count is contradicted. */
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

  protected onWindowChange(id: string): void {
    this.window.set(this.toWindow(id));
  }

  protected onTablePage(event: TablePageEvent): void {
    this.page.set(Math.floor((event.first ?? 0) / this.size) + 1);
  }

  private initQuery(): Signal<HealthMetricsMembersRenewalsQuery> {
    return computed(() => ({
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      window: this.window(),
      offset: (this.page() - 1) * this.size,
      pageSize: this.size,
    }));
  }

  private initResponse(): Signal<HealthMetricsMembersRenewals> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;
    // The count covers the whole window, so only a new foundation or window blanks it; paging keeps it.
    let countScope: string | null = null;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          if (`${query.foundationSlug}|${query.window}` !== countScope) {
            countScope = `${query.foundationSlug}|${query.window}`;
            this.countChange.emit(null);
          }
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
              // A clamped page fires a follow-up read, so this one neither settles, reports a count nor ends the skeleton.
              if (this.clampPage(response)) return;

              this.responseSlug.set(query.foundationSlug);
              this.responseWindow.set(query.window);

              this.loading.set(!foundationSeen);
              this.countChange.emit(query.foundationSlug && !this.loadFailed() ? response.summary.renewalCount : null);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
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
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsPage]: page > 1 ? page : null,
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
    const lastPage = Math.max(1, Math.ceil(response.totalRecords / this.size));
    // The sentinel's zero is no count, so a failed read keeps the page; an empty foundation moves to page 1.
    if (response === HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED || this.page() <= lastPage) return false;

    this.page.set(lastPage);
    this.syncUrl();
    return true;
  }

  private parseInitialPage(): number {
    const page = Number(this.initialParams.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsPage));
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  }

  private toWindow(value: string | null): HealthMetricsMembersRenewalsWindow {
    return HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS.find((option) => option === value) ?? HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS[0];
  }
}
