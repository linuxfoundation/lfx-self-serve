// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  VOTE_VOTER_NOT_VOTED_LABELS,
  VOTE_VOTER_STATUS_FILTER_LABELS,
  VOTE_VOTERS_ABSTAINED_CHOICE_KEY,
  VOTE_VOTERS_ALL_STATUS_FILTER,
  VOTE_VOTERS_PAGE_SIZE,
  VOTE_VOTERS_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import { PollStatus, VoteVoterStatus } from '@lfx-one/shared/enums';
import {
  FilterPillOption,
  Vote,
  VoteBallotDialogData,
  VoteVoter,
  VoteVoterChoiceFilterOption,
  VoteVoterRowView,
  VoteVoterStatusCounts,
  VoteVoterStatusFilter,
} from '@lfx-one/shared/interfaces';
import {
  buildVoteVoterChoiceFilterOptions,
  buildVoteVoterRowView,
  countVoteVotersByStatus,
  matchesVoteVoterChoice,
  normalizePollStatus,
  sortVoteVotersForDisplay,
} from '@lfx-one/shared/utils';
import { VoteService } from '@services/vote.service';
import { DialogService } from 'primeng/dynamicdialog';
import { PaginatorState } from 'primeng/paginator';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, of, startWith, Subject, switchMap, take, tap } from 'rxjs';

import { VoteBallotDialogComponent } from '../vote-ballot-dialog/vote-ballot-dialog.component';
import { VoteReminderDialogComponent } from '../vote-reminder-dialog/vote-reminder-dialog.component';

/**
 * Voters tab of the vote detail page (#3914): every invited voter with their status and current ballot, for vote managers on
 * named votes. The page decides visibility; GET /api/votes/:uid/voters (#3911) enforces the same rules. Filtering, counts and
 * sorting run in the browser — an electorate is a few hundred people at most and the endpoint returns it in one response.
 * `initialChoice` and `initialBallotUid` carry the results' "View N voters" and the comments' "View ballot" links.
 */
@Component({
  selector: 'lfx-vote-voters',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonComponent,
    EmptyStateComponent,
    FilterPillsComponent,
    InputTextComponent,
    PersonAvatarComponent,
    SelectComponent,
    SkeletonModule,
    TableComponent,
    TagComponent,
  ],
  templateUrl: './vote-voters.component.html',
})
export class VoteVotersComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly vote = input.required<Vote>();
  /** `voters_choice` from the URL — a `<question_id>:<choice_id>` key, or the abstain row's status key. */
  public readonly initialChoice = input<string | null>(null);
  /** `voters_ballot` from the URL — the vote response uid whose ballot opens once the list loads. */
  public readonly initialBallotUid = input<string | null>(null);

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    role: new FormControl<string | null>(null),
    choice: new FormControl<string | null>(null),
  });

  // === Constants ===
  protected readonly pageSize = VOTE_VOTERS_PAGE_SIZE;
  protected readonly rowsPerPageOptions = VOTE_VOTERS_ROWS_PER_PAGE_OPTIONS;
  protected readonly skeletonRows = [0, 1, 2, 3];

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly loadError = signal<boolean>(false);
  protected readonly statusFilter = signal<VoteVoterStatusFilter>(VOTE_VOTERS_ALL_STATUS_FILTER);
  /** First row of the table page, reset to 0 whenever a filter changes. */
  protected readonly tableFirst = signal<number>(0);
  protected readonly selectedPageSize = signal<number>(VOTE_VOTERS_PAGE_SIZE);
  protected readonly updatedAt = signal<Date | null>(null);

  private readonly refresh$ = new Subject<void>();

  // === Data Signals (Complex — init via private functions) ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly roleFilter: Signal<string | null> = toSignal(this.filterForm.controls.role.valueChanges, { initialValue: null });
  private readonly choiceFilter: Signal<string | null> = toSignal(this.filterForm.controls.choice.valueChanges, { initialValue: null });
  private readonly voters: Signal<VoteVoter[]> = this.initVoters();

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  /** Every voter in display order — not voted first while the vote is open, by choice after it closes. */
  protected readonly rows: Signal<VoteVoterRowView[]> = computed(() => {
    const vote = this.vote();
    return sortVoteVotersForDisplay(
      this.voters().map((voter) => buildVoteVoterRowView(vote, voter)),
      vote
    );
  });
  /** Rows matching search, role and choice. Status counts follow these filters but not the selected status pill. */
  private readonly matchingRows: Signal<VoteVoterRowView[]> = this.initMatchingRows();
  protected readonly filteredRows: Signal<VoteVoterRowView[]> = computed(() => {
    const status = this.statusFilter();
    const rows = this.matchingRows();
    return status === VOTE_VOTERS_ALL_STATUS_FILTER ? rows : rows.filter((row) => row.status === status);
  });
  protected readonly statusCounts: Signal<VoteVoterStatusCounts> = computed(() => countVoteVotersByStatus(this.matchingRows()));
  /** Reminder eligibility counts every invitee, whatever the filters show. */
  protected readonly notVotedTotal: Signal<number> = computed(() => countVoteVotersByStatus(this.rows())[VoteVoterStatus.NOT_VOTED]);
  protected readonly statusOptions: Signal<FilterPillOption[]> = this.initStatusOptions();
  protected readonly roleOptions: Signal<VoteVoterChoiceFilterOption[]> = this.initRoleOptions();
  protected readonly choiceOptions: Signal<VoteVoterChoiceFilterOption[]> = computed(() => buildVoteVoterChoiceFilterOptions(this.vote()));

  public constructor() {
    this.filterForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.tableFirst.set(0));
    this.initInitialChoice();
    this.initInitialBallot();
  }

  // === Protected Methods ===
  protected refresh(): void {
    this.refresh$.next();
  }

  protected onStatusFilterChange(status: string): void {
    this.statusFilter.set(status as VoteVoterStatusFilter);
    this.tableFirst.set(0);
  }

  protected onPage(event: PaginatorState): void {
    this.tableFirst.set(event.first ?? 0);
    this.selectedPageSize.set(event.rows ?? this.selectedPageSize());
  }

  protected clearFilters(): void {
    this.filterForm.reset({ search: '', role: null, choice: null });
    this.statusFilter.set(VOTE_VOTERS_ALL_STATUS_FILTER);
    this.tableFirst.set(0);
  }

  /** Same dialog the votes table opens; a send closes it with `true`, after which the statuses are reloaded. */
  protected openReminder(): void {
    this.dialogService
      .open(VoteReminderDialogComponent, {
        header: 'Send vote reminder',
        width: 'min(960px, 96vw)',
        modal: true,
        closable: true,
        draggable: false,
        data: { vote: this.vote() },
      })
      ?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((sent) => {
        if (sent === true) this.refresh();
      });
  }

  /** Opens a voter's ballot. Next and previous step through the table's current order, skipping voters with no ballot. */
  protected openBallot(uid: string): void {
    let ballots = this.filteredRows().filter((row) => row.hasBallot);
    // A deep link can name a ballot the current filters hide — fall back to every ballot in display order.
    if (!ballots.some((row) => row.uid === uid)) ballots = this.rows().filter((row) => row.hasBallot);
    const index = ballots.findIndex((row) => row.uid === uid);
    if (index < 0) return;

    const data: VoteBallotDialogData = { vote: this.vote(), ballots, index };
    this.dialogService.open(VoteBallotDialogComponent, {
      header: 'Ballot',
      width: 'min(720px, 96vw)',
      modal: true,
      closable: true,
      draggable: false,
      dismissableMask: true,
      data,
    });
  }

  // === Private Initializers ===
  private initSearchTerm(): Signal<string> {
    return toSignal(
      this.filterForm.controls.search.valueChanges.pipe(
        debounceTime(300),
        map((term) => term.trim().toLowerCase()),
        distinctUntilChanged()
      ),
      { initialValue: '' }
    );
  }

  /** Reloads on a new vote and on every refresh; `switchMap` drops a load a newer one replaced. */
  private initVoters(): Signal<VoteVoter[]> {
    const voteUid = computed(() => this.vote().uid);
    return toSignal(
      combineLatest([toObservable(voteUid), this.refresh$.pipe(startWith(undefined))]).pipe(
        switchMap(([uid]) => {
          this.loading.set(true);
          this.loadError.set(false);
          return this.voteService.getVoteVoters(uid).pipe(
            tap(() => this.updatedAt.set(new Date())),
            catchError((error) => {
              console.error('Failed to load vote voters', error);
              this.loadError.set(true);
              return of([] as VoteVoter[]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] as VoteVoter[] }
    );
  }

  private initMatchingRows(): Signal<VoteVoterRowView[]> {
    return computed(() => {
      const term = this.searchTerm();
      const role = this.roleFilter();
      const choice = this.choiceFilter();
      const vote = this.vote();

      return this.rows().filter(
        (row) =>
          (!term || row.displayName.toLowerCase().includes(term) || !!row.organization?.toLowerCase().includes(term)) &&
          (!role || row.role === role) &&
          (!choice || matchesVoteVoterChoice(row.voter, choice, vote))
      );
    });
  }

  /** Counts sit in each label; the Abstained pill shows only when the vote allows abstaining or someone abstained. */
  private initStatusOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const counts = this.statusCounts();
      const showAbstained = !!this.vote().allow_abstain || counts[VoteVoterStatus.ABSTAINED] > 0;
      const notVotedLabel = this.isActive() ? VOTE_VOTER_NOT_VOTED_LABELS.active : VOTE_VOTER_NOT_VOTED_LABELS.closed;
      const ids = Object.keys(VOTE_VOTER_STATUS_FILTER_LABELS) as VoteVoterStatusFilter[];

      return ids
        .filter((id) => id !== VoteVoterStatus.ABSTAINED || showAbstained)
        .map((id) => {
          const label = id === VoteVoterStatus.NOT_VOTED ? notVotedLabel : VOTE_VOTER_STATUS_FILTER_LABELS[id];
          return { id, label: `${label} (${counts[id]})` };
        });
    });
  }

  private initRoleOptions(): Signal<VoteVoterChoiceFilterOption[]> {
    return computed(() => {
      const roles = new Set(this.rows().flatMap((row) => (row.role ? [row.role] : [])));
      return [...roles].sort((a, b) => a.localeCompare(b)).map((role) => ({ label: role, value: role }));
    });
  }

  /** A results link selects its choice — or, for the abstain row, the Abstained pill — over every status. */
  private initInitialChoice(): void {
    toObservable(this.initialChoice)
      .pipe(
        filter((choice): choice is string => !!choice),
        takeUntilDestroyed()
      )
      .subscribe((choice) => {
        if (choice === VOTE_VOTERS_ABSTAINED_CHOICE_KEY) {
          this.filterForm.controls.choice.setValue(null);
          this.statusFilter.set(VoteVoterStatus.ABSTAINED);
        } else {
          this.filterForm.controls.choice.setValue(choice);
          this.statusFilter.set(VOTE_VOTERS_ALL_STATUS_FILTER);
        }
        this.tableFirst.set(0);
      });
  }

  /** A comment's "View ballot" link opens that ballot once the list has loaded — once per linked ballot. */
  private initInitialBallot(): void {
    let openedFor: string | null = null;
    const ready = computed(() => {
      const uid = this.initialBallotUid();
      if (!uid || this.loading()) return null;
      return this.rows().some((row) => row.uid === uid && row.hasBallot) ? uid : null;
    });

    toObservable(ready)
      .pipe(
        filter((uid): uid is string => !!uid && uid !== openedFor),
        takeUntilDestroyed()
      )
      .subscribe((uid) => {
        openedFor = uid;
        this.openBallot(uid);
      });
  }
}
