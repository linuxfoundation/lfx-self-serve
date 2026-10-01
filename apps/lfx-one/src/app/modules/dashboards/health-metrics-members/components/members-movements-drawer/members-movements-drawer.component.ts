// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, input, model, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY, HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE } from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersMovementCountNote,
  buildHealthMetricsMembersMovementDrawerTitle,
  buildHealthMetricsMembersMovementRows,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { DrawerModule } from 'primeng/drawer';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, EMPTY, exhaustMap, filter, finalize, type Observable, startWith, Subject, switchMap, tap } from 'rxjs';

import type {
  HealthMetricsMembersMovement,
  HealthMetricsMembersMovementListType,
  HealthMetricsMembersMovementRowView,
  HealthMetricsMembersMovementsQuery,
} from '@lfx-one/shared/interfaces';

/** The organizations behind one bridge bar, read a page at a time while the drawer is open. */
@Component({
  selector: 'lfx-members-movements-drawer',
  imports: [ButtonComponent, DrawerModule, EmptyStateComponent, Skeleton],
  templateUrl: './members-movements-drawer.component.html',
})
export class MembersMovementsDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly visible = model<boolean>(false);
  public readonly listType = input<HealthMetricsMembersMovementListType | null>(null);
  public readonly year = input<number | null>(null);
  public readonly foundationSlug = input<string>('');
  /** The bar's own count, so a list that differs from it can say so. */
  public readonly barCount = input<number | null>(null);

  // Lives in the `#header` template, which PrimeNG portals into the panel.
  private readonly titleRef = viewChild<ElementRef<HTMLElement>>('titleRef');
  private previouslyFocusedElement: HTMLElement | null = null;
  private readonly more$ = new Subject<void>();

  protected readonly loading = signal<boolean>(false);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly movements = signal<HealthMetricsMembersMovement[]>([]);
  protected readonly totalRecords = signal<number>(0);

  /** `p-drawer` announces as an unnamed `complementary` landmark without this. */
  protected readonly drawerPt = {
    root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'members-movements-drawer-title' },
  };

  protected readonly copy = computed(() => {
    const listType = this.listType();
    return listType ? HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY[listType] : null;
  });
  protected readonly title = computed(() => {
    const listType = this.listType();
    const year = this.year();
    return listType && year !== null ? buildHealthMetricsMembersMovementDrawerTitle(listType, year) : 'Members';
  });
  protected readonly rows = computed<HealthMetricsMembersMovementRowView[]>(() => {
    const listType = this.listType();
    return listType ? buildHealthMetricsMembersMovementRows(this.movements(), listType) : [];
  });
  protected readonly hasMore = computed(() => this.movements().length < this.totalRecords());
  protected readonly countNote = computed(() =>
    this.loading() || this.loadFailed() ? null : buildHealthMetricsMembersMovementCountNote(this.totalRecords(), this.barCount())
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initReads();
    }

    // Keyed off the model rather than `(onHide)`, which PrimeNG emits only for its own close.
    toObservable(this.visible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => this.restoreFocus());
  }

  protected onShowMore(): void {
    this.more$.next();
  }

  /** `p-drawer` never moves focus into the panel; lands on the title so the dialog announces by name. */
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();
  }

  /** Each opening reads the list afresh; "Show more" appends the next page and ignores clicks mid-read. */
  private initReads(): void {
    const target = computed(() => {
      const listType = this.listType();
      const year = this.year();
      const foundationSlug = this.foundationSlug();
      return this.visible() && listType && year !== null && foundationSlug ? { listType, year, foundationSlug } : null;
    });

    toObservable(target)
      .pipe(
        distinctUntilChanged((a, b) => a?.listType === b?.listType && a?.year === b?.year && a?.foundationSlug === b?.foundationSlug),
        switchMap((current) => {
          if (!current) return EMPTY;

          this.movements.set([]);
          this.totalRecords.set(0);
          this.loadFailed.set(false);
          const base = { foundationSlug: current.foundationSlug, year: current.year, movementType: current.listType };
          return this.more$.pipe(
            startWith(undefined),
            exhaustMap(() => this.readPage({ ...base, offset: this.movements().length, pageSize: HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE }))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe();
  }

  private readPage(query: HealthMetricsMembersMovementsQuery): Observable<unknown> {
    this.loading.set(true);
    this.loadFailed.set(false);

    return this.analyticsService.getMembersMovements(query).pipe(
      tap((page) => {
        this.movements.update((rows) => [...rows, ...page.rows]);
        this.totalRecords.set(page.totalRecords);
      }),
      // `AnalyticsService` has already logged the error before rethrowing it.
      catchError(() => {
        this.loadFailed.set(true);
        return EMPTY;
      }),
      finalize(() => this.loading.set(false))
    );
  }

  /** The close-side half of {@link onDrawerShow}; the captured element is nulled after. */
  private restoreFocus(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (this.previouslyFocusedElement?.isConnected) {
      this.previouslyFocusedElement.focus();
    }
    this.previouslyFocusedElement = null;
  }
}
