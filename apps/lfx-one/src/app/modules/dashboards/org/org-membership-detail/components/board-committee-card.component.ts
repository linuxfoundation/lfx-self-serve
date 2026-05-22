// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type {
  BoardSeat,
  CommitteeSeat,
  OrgMembershipKeyContactPerson,
  VotingRecord,
  SectionLoadState,
  ReassignSubmitEvent,
  ReassignBoardRolesDialogData,
  ReassignBoardRolesDialogResult,
  WhyCantEditDialogData,
  WhyCantEditDialogResult,
  VotingRecordRow,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { catchError, combineLatest, filter, of, Subject, take } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { OrgLensBoardCommitteeService } from '@services/org-lens-board-committee.service';

import { ReassignBoardRolesModalComponent } from './reassign-board-roles-modal.component';
import { WhyCantEditModalComponent } from './why-cant-edit-modal.component';

@Component({
  selector: 'lfx-board-committee-card',
  standalone: true,
  imports: [FormsModule, InputTextModule, ToastModule, TooltipModule, CardComponent, EmptyStateComponent],
  providers: [DialogService],
  templateUrl: './board-committee-card.component.html',
})
export class BoardCommitteeCardComponent {
  // === Inputs ===
  public readonly accountId = input.required<string>();
  public readonly foundationId = input.required<string>();
  public readonly foundationName = input<string>('');

  // === Injected services ===
  private readonly service = inject(OrgLensBoardCommitteeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  // === Internal: per-section data + load state ===
  protected readonly boardSeats = signal<BoardSeat[]>([]);
  protected readonly committeeSeats = signal<CommitteeSeat[]>([]);
  protected readonly votingHistory = signal<VotingRecord[]>([]);

  protected readonly boardState = signal<SectionLoadState>('idle');
  protected readonly committeeState = signal<SectionLoadState>('idle');
  protected readonly votingState = signal<SectionLoadState>('idle');

  protected readonly initialLoading = computed(() => this.initInitialLoading());

  // === Accordion state ===
  protected readonly boardExpanded = signal(true);
  protected readonly committeeExpanded = signal(false);
  protected readonly votingExpanded = signal(false);

  // === Search ===
  protected readonly searchTerm = signal('');

  /** Computed: filtered Board Seats by name OR email (case-insensitive substring). */
  protected readonly filteredBoardSeats = computed(() => this.applyFilter(this.boardSeats()));
  protected readonly filteredCommitteeSeats = computed(() => this.applyFilter(this.committeeSeats()));

  // === Pre-computed voting history with formatted date and chip class ===
  protected readonly votingHistoryWithMeta: Signal<VotingRecordRow[]> = computed(() => this.initVotingHistoryWithMeta());

  // === Private subjects ===
  private readonly searchInput$ = new Subject<string>();

  public constructor() {
    this.searchInput$.pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe((term) => this.searchTerm.set(term));

    combineLatest([toObservable(this.accountId).pipe(filter(Boolean)), toObservable(this.foundationId).pipe(filter(Boolean))])
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetchAll());
  }

  // === Fetch methods ===
  protected fetchAll(): void {
    this.fetchBoard();
    this.fetchCommittee();
    this.fetchVoting();
  }

  protected fetchBoard(): void {
    this.boardState.set('loading');
    this.service
      .getBoardSeats(this.accountId(), this.foundationId())
      .pipe(
        catchError(() => {
          this.boardState.set('error');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (response) {
          this.boardSeats.set(response.boardSeats);
          this.boardState.set('success');
        }
      });
  }

  protected fetchCommittee(): void {
    this.committeeState.set('loading');
    this.service
      .getCommitteeSeats(this.accountId(), this.foundationId())
      .pipe(
        catchError(() => {
          this.committeeState.set('error');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (response) {
          this.committeeSeats.set(response.committeeSeats);
          this.committeeState.set('success');
        }
      });
  }

  protected fetchVoting(): void {
    this.votingState.set('loading');
    this.service
      .getVotingHistory(this.accountId(), this.foundationId())
      .pipe(
        catchError(() => {
          this.votingState.set('error');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (response) {
          this.votingHistory.set(response.votingHistory);
          this.votingState.set('success');
        }
      });
  }

  // === Search handlers ===
  protected onSearchInput(value: string): void {
    this.searchInput$.next(value);
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
    this.searchInput$.next('');
  }

  // === Accordion toggles (FR-003 / FR-003a / FR-017b) ===
  protected toggleBoard(): void {
    this.boardExpanded.update((v) => !v);
  }

  protected toggleCommittee(): void {
    this.committeeExpanded.update((v) => !v);
  }

  protected toggleVoting(): void {
    this.votingExpanded.update((v) => !v);
  }

  // === Modal openers ===
  protected openReassignModal(seat: BoardSeat | CommitteeSeat, kind: 'board' | 'committee'): void {
    const ref = this.dialogService.open(ReassignBoardRolesModalComponent, {
      header: 'Reassign Board Roles',
      width: '560px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: {
        seat,
        seatKind: kind,
        foundationName: this.foundationName(),
      } satisfies ReassignBoardRolesDialogData,
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: ReassignBoardRolesDialogResult) => {
      if (result) this.onReassignSubmit(result);
    });
  }

  protected openWhyCantEditModal(seat: BoardSeat | CommitteeSeat): void {
    const ref = this.dialogService.open(WhyCantEditModalComponent, {
      header: '',
      width: '440px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: {
        reason: seat.reason,
        seatId: seat.seatId,
      } satisfies WhyCantEditDialogData,
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: WhyCantEditDialogResult) => {
      if (result?.contactFoundation) this.onContactFoundationClick(seat.seatId);
    });
  }

  /** Receives the reassign submit from the modal; applies optimistic update + refetch (FR-008h + FR-008j + FR-011d.4). */
  protected onReassignSubmit(event: ReassignSubmitEvent): void {
    const initials = (event.body.firstName.charAt(0) + event.body.lastName.charAt(0)).toUpperCase();
    const tempPerson: OrgMembershipKeyContactPerson = {
      personId: `temp-${this.generateUuid()}`,
      firstName: event.body.firstName,
      lastName: event.body.lastName,
      fullName: `${event.body.firstName} ${event.body.lastName}`,
      email: event.body.email,
      jobTitle: null,
      initials,
    };

    if (event.seatKind === 'board') {
      this.boardSeats.update((seats) => seats.map((s) => (s.seatId === event.seatId ? { ...s, person: tempPerson, votingPercentage: null } : s)));
    } else {
      this.committeeSeats.update((seats) => seats.map((s) => (s.seatId === event.seatId ? { ...s, person: tempPerson, votingPercentage: null } : s)));
    }

    this.messageService.add({
      key: 'board-toast-success-reassigned',
      severity: 'success',
      summary: 'Board roles reassigned',
      life: 3000,
    });

    if (event.seatKind === 'board') {
      this.service
        .getBoardSeats(this.accountId(), this.foundationId())
        .pipe(
          catchError(() => {
            this.messageService.add({
              key: 'board-committee-refetch-error-toast',
              severity: 'error',
              summary: 'Could not refresh board seats — please retry.',
              life: 5000,
            });
            return of(null);
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((response) => {
          if (response) this.boardSeats.set(response.boardSeats);
        });
    } else {
      this.service
        .getCommitteeSeats(this.accountId(), this.foundationId())
        .pipe(
          catchError(() => {
            this.messageService.add({
              key: 'board-committee-refetch-error-toast',
              severity: 'error',
              summary: 'Could not refresh committee seats — please retry.',
              life: 5000,
            });
            return of(null);
          }),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((response) => {
          if (response) this.committeeSeats.set(response.committeeSeats);
        });
    }
  }

  /** Why-can't-I-edit Contact Foundation handler — explicit no-op in v1 (FR-012c). */
  protected onContactFoundationClick(seatId: string): void {
    console.info('[board] contact foundation clicked for', seatId);
  }

  // === Private helpers ===
  private initInitialLoading(): boolean {
    return (
      (this.boardState() !== 'success' && this.boardState() !== 'error') ||
      (this.committeeState() !== 'success' && this.committeeState() !== 'error') ||
      (this.votingState() !== 'success' && this.votingState() !== 'error')
    );
  }

  private initVotingHistoryWithMeta(): VotingRecordRow[] {
    return this.votingHistory().map((v) => ({
      ...v,
      formattedDate: this.formatDate(v.date),
      chipClass: this.voteChipClass(v.vote),
    }));
  }

  private formatDate(dateString: string): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  }

  private voteChipClass(vote: 'Yes' | 'No' | 'Abstain' | string): string {
    switch (vote) {
      case 'Yes':
        return 'bg-green-100 text-green-800';
      case 'No':
        return 'bg-red-100 text-red-800';
      case 'Abstain':
        return 'bg-gray-100 text-gray-800';
      default:
        console.warn('[board] unexpected vote value defensively rendered as gray chip:', vote);
        return 'bg-gray-100 text-gray-600';
    }
  }

  private applyFilter<T extends { person: OrgMembershipKeyContactPerson }>(rows: T[]): T[] {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => r.person.fullName.toLowerCase().includes(term) || r.person.email.toLowerCase().includes(term));
  }

  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
