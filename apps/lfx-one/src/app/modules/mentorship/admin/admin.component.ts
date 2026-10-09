// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, MENTORSHIP_PROGRAM_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { merge, of, share, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, exhaustMap, finalize, map, scan, switchMap, takeUntil, tap } from 'rxjs/operators';

import { ProgramsListComponent } from './components/programs-list/programs-list.component';
import { Router } from '@angular/router';

/**
 * Admin landing page for the mentorship module.
 *
 * Mirrors `MyInitiativesComponent`'s shape: signal-driven state, `toSignal`
 * over a computed request observable, and a child list component that owns
 * card rendering + empty state. Search + status filter are lifted here (not in
 * the list child) so the offset/limit load-more driver can share the same
 * filter signals without prop-drilling. Offset increments on Load more;
 * filter changes reset offset to 0 and replace the accumulated page.
 */
@Component({
  selector: 'lfx-mentorship-admin',
  imports: [ButtonComponent, RouteLoadingComponent, ProgramsListComponent],
  templateUrl: './admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly router = inject(Router);

  // ─── Simple WritableSignals ────────────────────────────────────────────────
  protected readonly hasLoaded = signal(false);
  protected readonly filterLoading = signal(false);
  protected readonly loadingMore = signal(false);
  /** True when the first page of programs could not be read; the list shows an inline Retry. */
  protected readonly programsLoadError = signal(false);
  protected readonly searchTerm = signal<string>('');
  protected readonly statusFilter = signal<MentorshipProgramStatus | null>(null);

  // ─── Pagination Driver ─────────────────────────────────────────────────────
  private readonly programsOffset = signal(0);
  private readonly loadMore$ = new Subject<void>();
  private readonly retry$ = new Subject<void>();
  /** Last filter pair that `filters$` actually applied (post-debounce). */
  private readonly appliedSearch = signal('');
  private readonly appliedStatus = signal<MentorshipProgramStatus | null>(null);

  // ─── Computed / Async Signals ──────────────────────────────────────────────
  private readonly programsState: Signal<MentorshipProgramsResponse> = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().data);
  /** True while the raw inputs have not yet been applied (inside the 200 ms debounce). */
  private readonly filtersDirty = computed(() => this.searchTerm() !== this.appliedSearch() || this.statusFilter() !== this.appliedStatus());
  protected readonly hasMore = computed(() => !this.filterLoading() && !this.filtersDirty() && this.programsState().data.length < this.programsState().total);

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onProgramClick(programId: string): void {
    void this.router.navigate(['/mentorship/admin', programId]);
  }

  protected onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  protected onStatusChange(value: MentorshipProgramStatus | null): void {
    this.statusFilter.set(value);
  }

  protected onEnrollProgram(): void {
    void this.router.navigate(['/mentorship/admin/enroll']);
  }

  /** Reads the first page again with the filters last applied: a Retry after a failed load, or a card that added its logo. */
  protected retryPrograms(): void {
    this.retry$.next();
  }

  protected onLoadMore(): void {
    if (this.loadingMore() || this.filterLoading() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.programsOffset.update((curr) => curr + MENTORSHIP_PROGRAM_PAGE_SIZE);
    this.loadMore$.next();
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initPrograms(): Signal<MentorshipProgramsResponse> {
    // Rebuild the first page whenever search or status changes.
    // Debounce search input so keystroke bursts don't fan out to the BFF.
    const filters$ = toObservable(computed(() => ({ search: this.searchTerm(), status: this.statusFilter() }))).pipe(
      debounceTime(200),
      distinctUntilChanged((a, b) => a.search === b.search && a.status === b.status),
      // Multicast so `takeUntil(filters$)` late-subscribes without the subscribe-time
      // replay. A new subscriber would otherwise get the current filters after 200 ms
      // and cancel any load-more that takes longer than the debounce.
      share()
    );

    // A retry re-runs the first page with the filters last applied.
    const firstPageTrigger$ = merge(filters$, this.retry$.pipe(map(() => ({ search: this.appliedSearch(), status: this.appliedStatus() }))));

    const firstPage$ = firstPageTrigger$.pipe(
      tap((filters) => {
        this.programsOffset.set(0);
        this.filterLoading.set(true);
        this.appliedSearch.set(filters.search);
        this.appliedStatus.set(filters.status);
      }),
      switchMap((filters) =>
        this.mentorshipAdminService
          .getPrograms({
            search: filters.search || undefined,
            status: filters.status ?? undefined,
            offset: 0,
            limit: MENTORSHIP_PROGRAM_PAGE_SIZE,
          })
          .pipe(
            // Clear the error only once a read succeeds, so a retry in flight keeps the error block (not the empty state).
            map((response) => {
              this.programsLoadError.set(false);
              return { ...response, reset: true as const, failed: false };
            }),
            catchError(() => {
              this.programsLoadError.set(true);
              return of({ ...EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, reset: true as const, failed: true });
            })
          )
      ),
      // Clear after the latest first-page emission, not in the inner `finalize`.
      // A cancelled in-flight filter fetch would otherwise set `filterLoading` false
      // while the replacement request is still running and re-enable Load more.
      tap({
        next: () => this.filterLoading.set(false),
        error: () => this.filterLoading.set(false),
      })
    );

    const nextPage$ = this.loadMore$.pipe(
      exhaustMap(() =>
        this.mentorshipAdminService
          .getPrograms({
            search: this.appliedSearch() || undefined,
            status: this.appliedStatus() ?? undefined,
            offset: this.programsOffset(),
            limit: MENTORSHIP_PROGRAM_PAGE_SIZE,
          })
          .pipe(
            takeUntil(firstPageTrigger$),
            map((response) => ({ ...response, reset: false as const, failed: false })),
            // A failed page leaves the loaded programs as they are; Load more stays available to try again.
            catchError(() => of({ ...EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, reset: false as const, failed: true })),
            tap((page) => {
              if (page.failed) {
                this.programsOffset.update((curr) => Math.max(0, curr - MENTORSHIP_PROGRAM_PAGE_SIZE));
              }
            }),
            finalize(() => this.loadingMore.set(false))
          )
      )
    );

    return toSignal(
      merge(firstPage$, nextPage$).pipe(
        scan((acc, curr) => {
          if (curr.reset) return { data: curr.data, total: curr.total };
          if (curr.failed) return acc;
          return { data: [...acc.data, ...curr.data], total: curr.total };
        }, EMPTY_MENTORSHIP_PROGRAMS_RESPONSE),
        tap(() => this.hasLoaded.set(true))
      ),
      { initialValue: EMPTY_MENTORSHIP_PROGRAMS_RESPONSE }
    );
  }
}
