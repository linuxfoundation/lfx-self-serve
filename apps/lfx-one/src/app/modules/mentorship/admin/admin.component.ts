// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import {
  EMPTY_MENTORSHIP_PROGRAMS_RESPONSE,
  MENTORSHIP_ADMIN_PROGRAMS_EMPTY_MESSAGE,
  MENTORSHIP_FOUNDATION_PROGRAMS_EMPTY_MESSAGE,
  MENTORSHIP_FOUNDATION_PROGRAMS_NO_ACCESS_MESSAGE,
  MENTORSHIP_FOUNDATION_PROGRAMS_NO_ACCESS_TITLE,
  MENTORSHIP_PROGRAM_PAGE_SIZE,
  MENTORSHIP_PROJECT_PROGRAMS_EMPTY_MESSAGE,
  MENTORSHIP_PROJECT_PROGRAMS_NO_ACCESS_MESSAGE,
  MENTORSHIP_PROJECT_PROGRAMS_NO_ACCESS_TITLE,
  MENTORSHIP_PROJECT_PROGRAMS_TITLE,
} from '@lfx-one/shared/constants';
import { Lens, MentorshipAdminProgramListFilters, MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { getMentorshipAdminBasePath, getMentorshipLensQueryParams } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ProjectContextService } from '@services/project-context.service';
import { merge, Observable, of, share, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, exhaustMap, filter, finalize, map, scan, switchMap, takeUntil, tap } from 'rxjs/operators';

import { ProgramsListComponent } from './components/programs-list/programs-list.component';

/**
 * Admin landing page for the mentorship module, and the Project lens's Mentorship Programs (lfx-mentorship#398).
 *
 * Mirrors `MyInitiativesComponent`'s shape: signal-driven state, `toSignal`
 * over a computed request observable, and a child list component that owns
 * card rendering + empty state. Search + status filter are lifted here (not in
 * the list child) so the offset/limit load-more driver can share the same
 * filter signals without prop-drilling. Offset increments on Load more;
 * filter changes reset offset to 0 and replace the accumulated page.
 *
 * On the Project lens route (`data.lens: 'project'`) it lists every program of the lens's project, whoever administers it; on
 * the Foundation lens route, every program of the foundation and its sub-projects. It reloads when the lens's project
 * changes, and opens programs and the wizard on the lens's own routes.
 */
@Component({
  selector: 'lfx-mentorship-admin',
  imports: [ButtonComponent, EmptyStateComponent, RouteLoadingComponent, ProgramsListComponent, PageHeaderComponent],
  templateUrl: './admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // ─── Lens ──────────────────────────────────────────────────────────────────
  private readonly lens = this.route.snapshot.data['lens'] as Lens | undefined;
  /** The Project or Foundation lens's Mentorship Programs, scoped to the lens's project or foundation. */
  private readonly isLensPage = this.lens === 'project' || this.lens === 'foundation';
  private readonly basePath = getMentorshipAdminBasePath(this.lens);
  protected readonly pageTitle = this.isLensPage ? MENTORSHIP_PROJECT_PROGRAMS_TITLE : 'Admin';
  protected readonly emptyMessage = this.initEmptyMessage();
  protected readonly noAccessTitle = this.lens === 'foundation' ? MENTORSHIP_FOUNDATION_PROGRAMS_NO_ACCESS_TITLE : MENTORSHIP_PROJECT_PROGRAMS_NO_ACCESS_TITLE;
  protected readonly noAccessMessage =
    this.lens === 'foundation' ? MENTORSHIP_FOUNDATION_PROGRAMS_NO_ACCESS_MESSAGE : MENTORSHIP_PROJECT_PROGRAMS_NO_ACCESS_MESSAGE;

  // ─── Simple WritableSignals ────────────────────────────────────────────────
  protected readonly hasLoaded = signal(false);
  protected readonly filterLoading = signal(false);
  protected readonly loadingMore = signal(false);
  /** True when the first page of programs could not be read; the list shows an inline Retry. */
  protected readonly programsLoadError = signal(false);
  /** True when the gateway refused a lens list (403): the caller lacks `mentorship_program_creator` on the project, so no Retry. */
  protected readonly programsForbidden = signal(false);
  protected readonly searchTerm = signal<string>('');
  protected readonly statusFilter = signal<MentorshipProgramStatus | null>(null);

  // ─── Pagination Driver ─────────────────────────────────────────────────────
  private readonly programsOffset = signal(0);
  private readonly loadMore$ = new Subject<void>();
  private readonly retry$ = new Subject<void>();
  /** Last filters that `filters$` actually applied (post-debounce). */
  private readonly appliedSearch = signal('');
  private readonly appliedStatus = signal<MentorshipProgramStatus | null>(null);
  private readonly appliedProjectUid = signal('');

  // ─── Computed / Async Signals ──────────────────────────────────────────────
  /** The lens's project or foundation, `''` until its context resolves; always `''` on the Me lens. */
  private readonly projectUid = computed(() => (this.isLensPage ? this.projectContextService.activeContextUid() : ''));
  private readonly programsState: Signal<MentorshipProgramsResponse> = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().data);
  /** True while the raw inputs have not yet been applied (inside the 200 ms debounce). */
  private readonly filtersDirty = computed(
    () => this.searchTerm() !== this.appliedSearch() || this.statusFilter() !== this.appliedStatus() || this.projectUid() !== this.appliedProjectUid()
  );
  protected readonly hasMore = computed(() => !this.filterLoading() && !this.filtersDirty() && this.programsState().data.length < this.programsState().total);

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onProgramClick(programId: string): void {
    this.navigateInLens([this.basePath, programId]);
  }

  protected onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  protected onStatusChange(value: MentorshipProgramStatus | null): void {
    this.statusFilter.set(value);
  }

  /** Opens the lens's own wizard, which offers the Project lens's project or the Foundation lens's sub-projects only. */
  protected onEnrollProgram(): void {
    this.navigateInLens([this.basePath, 'enroll']);
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
    // Rebuild the first page whenever search, status or the Project lens's project changes.
    // Debounce search input so keystroke bursts don't fan out to the BFF.
    const filters$ = toObservable(
      computed((): MentorshipAdminProgramListFilters => ({ search: this.searchTerm(), status: this.statusFilter(), projectUid: this.projectUid() }))
    ).pipe(
      // A lens page waits for its project or foundation to resolve rather than reading without one.
      filter((filters) => !this.isLensPage || !!filters.projectUid),
      debounceTime(200),
      distinctUntilChanged((a, b) => a.search === b.search && a.status === b.status && a.projectUid === b.projectUid),
      // Multicast so `takeUntil(filters$)` late-subscribes without the subscribe-time
      // replay. A new subscriber would otherwise get the current filters after 200 ms
      // and cancel any load-more that takes longer than the debounce.
      share()
    );

    // A retry re-runs the first page with the filters last applied.
    const firstPageTrigger$ = merge(filters$, this.retry$.pipe(map(() => this.appliedFilters())));

    const firstPage$ = firstPageTrigger$.pipe(
      tap((filters) => {
        // Another project's cards must not stay on screen while this project's programs load.
        if (filters.projectUid !== this.appliedProjectUid()) this.hasLoaded.set(false);
        this.programsOffset.set(0);
        this.filterLoading.set(true);
        this.appliedSearch.set(filters.search);
        this.appliedStatus.set(filters.status);
        this.appliedProjectUid.set(filters.projectUid);
      }),
      switchMap((filters) =>
        this.readPrograms(filters, 0).pipe(
          // Clear the error only once a read succeeds, so a retry in flight keeps the error block (not the empty state).
          map((response) => {
            this.programsLoadError.set(false);
            this.programsForbidden.set(false);
            return { ...response, reset: true as const, failed: false };
          }),
          catchError((error: unknown) => {
            // The gateway refuses a project's list without `mentorship_program_creator` on it; a Retry would not change that.
            const forbidden = this.isLensPage && error instanceof HttpErrorResponse && error.status === 403;
            this.programsForbidden.set(forbidden);
            this.programsLoadError.set(!forbidden);
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
        this.readPrograms(this.appliedFilters(), this.programsOffset()).pipe(
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

  private initEmptyMessage(): string {
    if (this.lens === 'project') return MENTORSHIP_PROJECT_PROGRAMS_EMPTY_MESSAGE;
    if (this.lens === 'foundation') return MENTORSHIP_FOUNDATION_PROGRAMS_EMPTY_MESSAGE;
    return MENTORSHIP_ADMIN_PROGRAMS_EMPTY_MESSAGE;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────
  /**
   * Navigates within the lens with its project in `?project=`, taken from the lens context: after an in-place project switch
   * the router still holds the previous slug, which `projectQueryParamGuard` would switch back to. The Me lens has none.
   */
  private navigateInLens(commands: string[]): void {
    const queryParams = getMentorshipLensQueryParams(this.lens, this.projectContextService.activeContext()?.slug);
    void this.router.navigate(commands, { queryParams });
  }

  private appliedFilters(): MentorshipAdminProgramListFilters {
    return { search: this.appliedSearch(), status: this.appliedStatus(), projectUid: this.appliedProjectUid() };
  }

  /**
   * One page of the lens's list: the caller's own programs (Me lens), every program of the Project lens's project, or every
   * program of the Foundation lens's foundation and its sub-projects.
   */
  private readPrograms(filters: MentorshipAdminProgramListFilters, offset: number): Observable<MentorshipProgramsResponse> {
    const params = { search: filters.search || undefined, status: filters.status ?? undefined, offset, limit: MENTORSHIP_PROGRAM_PAGE_SIZE };
    if (!this.isLensPage) return this.mentorshipAdminService.getPrograms(params);
    return this.mentorshipAdminService.getProjectPrograms(filters.projectUid, { ...params, includeSubprojects: this.lens === 'foundation' });
  }
}
