// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_PROGRAMS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';

import { ProgramsListComponent } from './components/programs-list/programs-list.component';

/**
 * Admin landing page for the mentorship module.
 *
 * Mirrors `MyInitiativesComponent`'s shape: signal-driven state, `toSignal`
 * over a computed request observable, and a child list component that owns
 * card rendering + empty state. Search + status filter are lifted here (not in
 * the list child) so a future paginated "load more" driver can share the same
 * filter signals without prop-drilling.
 */
@Component({
  selector: 'lfx-mentorship-admin',
  imports: [ButtonComponent, RouteLoadingComponent, ProgramsListComponent],
  templateUrl: './admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly router = inject(Router);
  private readonly mentorshipService = inject(MentorshipService);

  // ─── Simple WritableSignals ────────────────────────────────────────────────
  protected readonly isLoading = signal(true);
  protected readonly searchTerm = signal<string>('');
  protected readonly statusFilter = signal<MentorshipProgramStatus | null>(null);

  // ─── Computed / Async Signals ──────────────────────────────────────────────
  private readonly programsState: Signal<MentorshipProgramsResponse> = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().data);
  protected readonly totalPrograms = computed(() => this.programsState().total);

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onProgramClick(): void {
    // TODO: navigate to `/mentorship/admin/${slug}` once ProgramDetailComponent is re-introduced.
    // The card still emits its slug on `(cardClick)` — restore the router.navigate call here
    // and reinstate the `/mentorship/admin/:programId` route in `mentorship.routes.ts` when detail lands.
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

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initPrograms(): Signal<MentorshipProgramsResponse> {
    // Rebuild the request whenever search or status changes.
    // Debounce search input so keystroke bursts don't fan out to the BFF.
    const filters$ = toObservable(computed(() => ({ search: this.searchTerm(), status: this.statusFilter() }))).pipe(
      debounceTime(200),
      distinctUntilChanged((a, b) => a.search === b.search && a.status === b.status),
      tap(() => this.isLoading.set(true))
    );

    return toSignal(
      filters$.pipe(
        switchMap((filters) =>
          this.mentorshipService.getPrograms({
            search: filters.search || undefined,
            status: filters.status ?? undefined,
          })
        ),
        map((response) => response),
        tap(() => this.isLoading.set(false))
      ),
      { initialValue: EMPTY_MENTORSHIP_PROGRAMS_RESPONSE }
    );
  }
}
