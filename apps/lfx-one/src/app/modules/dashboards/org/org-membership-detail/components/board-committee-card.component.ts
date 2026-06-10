// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type {
  BoardSeat,
  CommitteeSeat,
  SectionLoadState,
  ReassignSubmitEvent,
  ReassignBoardRolesDialogData,
  ReassignBoardRolesDialogResult,
  WhyCantEditDialogData,
  WhyCantEditDialogResult,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
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
  /** Spec 002: the selected org's account id (SFID); forwarded to the account-id-keyed board/committee BFF routes. */
  public readonly orgUid = input.required<string>();
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

  protected readonly boardState = signal<SectionLoadState>('idle');
  protected readonly committeeState = signal<SectionLoadState>('idle');

  protected readonly initialLoading = computed(() => this.initInitialLoading());

  // === Accordion state ===
  protected readonly boardExpanded = signal(true);
  protected readonly committeeExpanded = signal(false);

  // === Search ===
  protected readonly searchTerm = signal('');

  /** Filtered + ordered seats (FR-011 search, FR-017 ordering: committee A–Z then last name). */
  protected readonly filteredBoardSeats = computed(() => this.sortSeats(this.applyFilter(this.boardSeats())));
  protected readonly filteredCommitteeSeats = computed(() => this.sortSeats(this.applyFilter(this.committeeSeats())));

  // === Private subjects ===
  private readonly searchInput$ = new Subject<string>();

  public constructor() {
    this.searchInput$.pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe((term) => this.searchTerm.set(term));

    combineLatest([toObservable(this.orgUid).pipe(filter(Boolean)), toObservable(this.foundationId).pipe(filter(Boolean))])
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetchAll());
  }

  // === Fetch methods ===
  protected fetchAll(): void {
    this.fetchSeats();
  }

  /** Single combined read (spec 026 TODO #1): one committee-service round trip drives BOTH the board and committee sections. */
  protected fetchSeats(): void {
    this.boardState.set('loading');
    this.committeeState.set('loading');
    this.service
      .getSeats(this.orgUid(), this.foundationId())
      .pipe(
        catchError(() => {
          this.boardState.set('error');
          this.committeeState.set('error');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (!response) return;
        this.boardSeats.set(response.boardSeats);
        this.committeeSeats.set(response.committeeSeats);
        this.boardState.set('success');
        this.committeeState.set('success');
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
        orgUid: this.orgUid(),
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

  /** Receives the reassign submit from the modal; calls the write proxy, then optimistic update + refetch (FR-007/FR-009/FR-016). */
  protected onReassignSubmit(event: ReassignSubmitEvent): void {
    const seats: (BoardSeat | CommitteeSeat)[] = event.seatKind === 'board' ? this.boardSeats() : this.committeeSeats();
    const committeeUid = seats.find((s) => s.seatId === event.seatId)?.committeeUid ?? '';

    // Fail fast (FR-016): if the seat's committeeUid can't be resolved (stale state / unexpected shape),
    // the upstream reassign would 400 on an empty committee_uid and surface as a generic failure.
    if (!committeeUid) {
      this.messageService.add({
        key: 'board-committee-refetch-error-toast',
        severity: 'error',
        summary: 'Reassignment failed — please retry.',
        life: 5000,
      });
      return;
    }

    this.service
      .reassignSeat(this.orgUid(), this.foundationId(), event.seatId, { committeeUid, ...event.body })
      .pipe(
        catchError(() => {
          // FR-016: a reassignment that can't be completed surfaces an error rather than failing silently.
          this.messageService.add({
            key: 'board-committee-refetch-error-toast',
            severity: 'error',
            summary: 'Reassignment failed — please retry.',
            life: 5000,
          });
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (!response) return;
        // FR-007: only the holder changes — the returned seat preserves role/voting/appointment.
        this.applyReassignedSeat(event.seatKind, response.seat);
        this.messageService.add({
          key: 'board-toast-success-reassigned',
          severity: 'success',
          summary: event.seatKind === 'board' ? 'Board roles reassigned' : 'Committee seat reassigned',
          life: 3000,
        });
        this.fetchSeats();
      });
  }

  /** Why-can't-I-edit Contact Foundation handler — explicit no-op in v1 (FR-012c). */
  protected onContactFoundationClick(seatId: string): void {
    console.info('[board] contact foundation clicked for', seatId);
  }

  /** FR-012: download a CSV of the org's full seat list (board + committee), independent of the search filter. */
  protected exportCsv(): void {
    const csv = this.buildCsv();
    if (typeof document === 'undefined') {
      return; // SSR guard — unreachable in the browser
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `board-committee-${this.foundationId() || this.orgUid()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // === Private helpers ===
  private initInitialLoading(): boolean {
    return (this.boardState() !== 'success' && this.boardState() !== 'error') || (this.committeeState() !== 'success' && this.committeeState() !== 'error');
  }

  private applyFilter<T extends BoardSeat | CommitteeSeat>(rows: T[]): T[] {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => this.seatSearchText(r).includes(term));
  }

  /** FR-011: case-insensitive search text over name, job title, role, appointed-by, voting status, committee/seat name, and email. */
  private seatSearchText(seat: BoardSeat | CommitteeSeat): string {
    const parts: (string | null | undefined)[] = [
      seat.person.fullName,
      seat.person.email,
      seat.person.jobTitle,
      seat.appointedBy,
      seat.votingStatus,
      'seatName' in seat ? seat.seatName : undefined,
      'role' in seat ? seat.role : undefined,
      'committeeName' in seat ? seat.committeeName : undefined,
    ];
    return parts
      .filter((p): p is string => Boolean(p))
      .join(' ')
      .toLowerCase();
  }

  /** FR-017: order by committee/seat group name (A–Z), then by last name within each group. */
  private sortSeats<T extends BoardSeat | CommitteeSeat>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const groupCmp = this.seatGroupName(a).localeCompare(this.seatGroupName(b), undefined, { sensitivity: 'base' });
      if (groupCmp !== 0) {
        return groupCmp;
      }
      return a.person.lastName.localeCompare(b.person.lastName, undefined, { sensitivity: 'base' });
    });
  }

  private seatGroupName(seat: BoardSeat | CommitteeSeat): string {
    return 'committeeName' in seat ? seat.committeeName : seat.seatName;
  }

  /** Builds the FR-012 CSV (one row per member-per-committee) over the full, unfiltered seat list. */
  private buildCsv(): string {
    const header = ['Committee', 'Category', 'Name', 'Job Title', 'Role', 'Appointed By', 'Voting Status', 'Email'];
    const rows: string[][] = [];
    for (const s of this.boardSeats()) {
      rows.push([s.seatName, s.committeeCategory, s.person.fullName, s.person.jobTitle ?? '', '', s.appointedBy, s.votingStatus, s.person.email]);
    }
    for (const s of this.committeeSeats()) {
      rows.push([s.committeeName, s.committeeCategory, s.person.fullName, s.person.jobTitle ?? '', s.role, s.appointedBy, s.votingStatus, s.person.email]);
    }
    return [header, ...rows].map((row) => row.map((cell) => this.csvCell(cell)).join(',')).join('\r\n');
  }

  /**
   * RFC 4180 cell escaping + OWASP CSV/formula-injection neutralization (CWE-1236).
   * A leading =, +, -, @, TAB, or CR makes Excel/Sheets evaluate the cell as a formula even when quoted
   * (fields like name/job title/email are upstream-controlled), so we prefix such values with a single
   * quote, then quote/double embedded quotes when the value has a comma/quote/newline.
   */
  private csvCell(value: string): string {
    const raw = value ?? '';
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  /** Replace the reassigned seat in the right list with the authoritative seat returned by the write. */
  private applyReassignedSeat(kind: 'board' | 'committee', seat: BoardSeat | CommitteeSeat): void {
    if (kind === 'board') {
      this.boardSeats.update((seats) => seats.map((s) => (s.seatId === seat.seatId ? (seat as BoardSeat) : s)));
    } else {
      this.committeeSeats.update((seats) => seats.map((s) => (s.seatId === seat.seatId ? (seat as CommitteeSeat) : s)));
    }
  }
}
