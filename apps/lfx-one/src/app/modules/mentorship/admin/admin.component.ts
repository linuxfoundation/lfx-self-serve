// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, MENTORSHIP_PROGRAM_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { merge, share, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, exhaustMap, finalize, map, scan, switchMap, takeUntil, tap } from 'rxjs/operators';

import { ProgramsListComponent } from './components/programs-list/programs-list.component';

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
  private readonly mentorshipService = inject(MentorshipService);

  // ─── Simple WritableSignals ────────────────────────────────────────────────
  protected readonly hasLoaded = signal(false);
  protected readonly filterLoading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly searchTerm = signal<string>('');
  protected readonly statusFilter = signal<MentorshipProgramStatus | null>(null);

  // ─── Pagination Driver ─────────────────────────────────────────────────────
  private readonly programsOffset = signal(0);
  private readonly loadMore$ = new Subject<void>();

  // ─── Computed / Async Signals ──────────────────────────────────────────────
  private readonly programsState: Signal<MentorshipProgramsResponse> = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().data);
  protected readonly hasMore = computed(() => !this.filterLoading() && this.programsState().data.length < this.programsState().total);

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onProgramClick(programId: string): void {
    // TODO: wire up program-detail flow (LFXV2-<TBD>) — currently a no-op
    // so the CTA visibly renders without silently promising navigation the
    // rest of the module doesn't yet support.
    // void this.router.navigate(['/mentorship/admin', programId]);
  }

  protected onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  protected onStatusChange(value: MentorshipProgramStatus | null): void {
    this.statusFilter.set(value);
  }

  protected onEnrollProgram(): void {
    // TODO: wire up program-enrollment flow (LFXV2-<TBD>) — currently a no-op
    // so the CTA visibly renders without silently promising navigation the
    // rest of the module doesn't yet support.
    // void this.router.navigate(['/mentorship/admin/enroll']);
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

    const firstPage$ = filters$.pipe(
      tap(() => {
        this.programsOffset.set(0);
        this.filterLoading.set(true);
      }),
      switchMap((filters) =>
        this.mentorshipService
          .getPrograms({
            search: filters.search || undefined,
            status: filters.status ?? undefined,
            offset: 0,
            limit: MENTORSHIP_PROGRAM_PAGE_SIZE,
          })
          .pipe(map((response) => ({ ...response, reset: true as const, failed: false })))
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
        this.mentorshipService
          .getPrograms({
            search: this.searchTerm() || undefined,
            status: this.statusFilter() ?? undefined,
            offset: this.programsOffset(),
            limit: MENTORSHIP_PROGRAM_PAGE_SIZE,
          })
          .pipe(
            takeUntil(filters$),
            map((response) => {
              const failed = response.data.length === 0 && response.total === 0;
              return { ...response, reset: false as const, failed };
            }),
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
