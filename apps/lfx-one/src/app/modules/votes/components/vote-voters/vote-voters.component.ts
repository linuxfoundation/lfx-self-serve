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
  VOTE_PARTICIPATION_ALL_STATUS_FILTER,
  VOTE_PARTICIPATION_STATUS_FILTER_LABELS,
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
  PollCommentPrompt,
  Vote,
  VoteBallotDialogData,
  VoteParticipationStatusCounts,
  VoteParticipationStatusFilter,
  VoteParticipationVoter,
  VoteParticipationVoterRowView,
  VoteVoter,
  VoteVoterChoiceFilterOption,
  VoteVoterRowView,
  VoteVoterStatusCounts,
  VoteVoterStatusFilter,
} from '@lfx-one/shared/interfaces';
import {
  buildVoteParticipationRowView,
  buildVoteVoterChoiceFilterOptions,
  buildVoteVoterRowView,
  countVoteParticipationByStatus,
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
 * `initialChoice` and `initialBallotUid` carry the results' count links and the comments' "View ballot" links.
 *
 * On a vote that is not explicitly named (#3916) the tab is participation-only: the endpoint returns Responded / Not responded
 * rows with no identifier or ballot, in name order, so there is no choice filter, Choice or Submitted column, or ballot dialog,
 * and both deep links are ignored.
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
  /** Resolved prompts from results, used when the vote detail omits its prompt metadata. */
  public readonly commentPrompts = input<PollCommentPrompt[]>([]);
  /** `voters_choice` from the URL — a `<question_id>:<choice_id>` key, or the abstain row's status key. */
  public readonly initialChoice = input<string | null>(null);
  /** `voters_ballot` from the URL — the vote response uid whose ballot opens once the list loads. */
  public readonly initialBallotUid = input<string | null>(null);

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
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
  protected readonly participationStatusFilter = signal<VoteParticipationStatusFilter>(VOTE_PARTICIPATION_ALL_STATUS_FILTER);
  /** First row of the table page, reset to 0 whenever a filter changes. */
  protected readonly tableFirst = signal<number>(0);
  protected readonly selectedPageSize = signal<number>(VOTE_VOTERS_PAGE_SIZE);
  protected readonly updatedAt = signal<Date | null>(null);

  private readonly refresh$ = new Subject<void>();

  // === Data Signals (Complex — init via private functions) ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly choiceFilter: Signal<string | null> = toSignal(this.filterForm.controls.choice.valueChanges, { initialValue: null });
  private readonly response: Signal<VoteVoter[] | VoteParticipationVoter[]> = this.initVoters();

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  /** A vote that is not explicitly named gets participation only — a missing flag fails closed, as the server does (#3916). */
  protected readonly participationOnly: Signal<boolean> = computed(() => this.vote().pseudo_anonymity !== false);
  /** Named rows carry a `uid`; participation rows never do, so the shape decides which list a row belongs to. */
  private readonly voters: Signal<VoteVoter[]> = computed(() =>
    this.participationOnly() ? [] : (this.response() as (VoteVoter | VoteParticipationVoter)[]).filter((voter): voter is VoteVoter => 'uid' in voter)
  );
  /** Every voter in display order — not voted first while the vote is open, by choice after it closes. */
  protected readonly rows: Signal<VoteVoterRowView[]> = computed(() => {
    const vote = this.vote();
    return sortVoteVotersForDisplay(
      this.voters().map((voter) => buildVoteVoterRowView(vote, voter)),
      vote
    );
  });
  /** Rows matching search and choice. Status counts follow these filters but not the selected status pill. */
  private readonly matchingRows: Signal<VoteVoterRowView[]> = this.initMatchingRows();
  protected readonly filteredRows: Signal<VoteVoterRowView[]> = computed(() => {
    const status = this.statusFilter();
    const rows = this.matchingRows();
    return status === VOTE_VOTERS_ALL_STATUS_FILTER ? rows : rows.filter((row) => row.status === status);
  });
  protected readonly statusCounts: Signal<VoteVoterStatusCounts> = computed(() => countVoteVotersByStatus(this.matchingRows()));
  /** Reminder eligibility counts every invitee, whatever the filters show. */
  protected readonly notVotedTotal: Signal<number> = computed(() =>
    this.participationOnly()
      ? countVoteParticipationByStatus(this.participationRows()).pending
      : countVoteVotersByStatus(this.rows())[VoteVoterStatus.NOT_VOTED]
  );
  protected readonly statusOptions: Signal<FilterPillOption[]> = this.initStatusOptions();
  protected readonly choiceOptions: Signal<VoteVoterChoiceFilterOption[]> = computed(() => buildVoteVoterChoiceFilterOptions(this.vote()));
  /** Participation-only rows (#3916), in the server's name order. */
  protected readonly participationRows: Signal<VoteParticipationVoterRowView[]> = this.initParticipationRows();
  /** Participation rows matching search. Status counts follow the search but not the selected status pill. */
  private readonly participationMatchingRows: Signal<VoteParticipationVoterRowView[]> = this.initParticipationMatchingRows();
  protected readonly participationFilteredRows: Signal<VoteParticipationVoterRowView[]> = computed(() => {
    const status = this.participationStatusFilter();
    const rows = this.participationMatchingRows();
    return status === VOTE_PARTICIPATION_ALL_STATUS_FILTER ? rows : rows.filter((row) => row.status === status);
  });
  protected readonly participationStatusCounts: Signal<VoteParticipationStatusCounts> = computed(() =>
    countVoteParticipationByStatus(this.participationMatchingRows())
  );
  protected readonly participationStatusOptions: Signal<FilterPillOption[]> = this.initParticipationStatusOptions();
  /** Every invitee and the filtered rows in whichever mode the tab is in — drive the empty states and the page bounds. */
  protected readonly totalRowCount: Signal<number> = computed(() => (this.participationOnly() ? this.participationRows().length : this.rows().length));
  /** A new array on every load, even an equally long one, so the page bounds re-check after each refresh. */
  private readonly visibleRows: Signal<readonly (VoteVoterRowView | VoteParticipationVoterRowView)[]> = computed(() =>
    this.participationOnly() ? this.participationFilteredRows() : this.filteredRows()
  );
  protected readonly visibleRowCount: Signal<number> = computed(() => this.visibleRows().length);

  public constructor() {
    this.filterForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.tableFirst.set(0));
    this.initTablePageBounds();
    this.initInitialChoice();
    this.initInitialBallot();
  }

  // === Protected Methods ===
  protected refresh(): void {
    this.refresh$.next();
  }

  protected onStatusFilterChange(status: string): void {
    if (this.participationOnly()) {
      this.participationStatusFilter.set(status as VoteParticipationStatusFilter);
    } else {
      this.statusFilter.set(status as VoteVoterStatusFilter);
    }
    this.tableFirst.set(0);
  }

  protected onPage(event: PaginatorState): void {
    this.tableFirst.set(event.first ?? 0);
    this.selectedPageSize.set(event.rows ?? this.selectedPageSize());
  }

  protected clearFilters(): void {
    this.filterForm.reset({ search: '', choice: null });
    this.statusFilter.set(VOTE_VOTERS_ALL_STATUS_FILTER);
    this.participationStatusFilter.set(VOTE_PARTICIPATION_ALL_STATUS_FILTER);
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

    const vote = this.vote();
    const dialogVote = vote.poll_comment_prompts?.length ? vote : { ...vote, poll_comment_prompts: this.commentPrompts() };
    const commentPrompts = computed(() => {
      const currentVote = this.vote();
      if (currentVote.uid !== vote.uid || currentVote.pseudo_anonymity !== false) return [];
      return currentVote.poll_comment_prompts?.length ? currentVote.poll_comment_prompts : this.commentPrompts();
    });
    const data: VoteBallotDialogData = { vote: dialogVote, ballots, index, commentPrompts };
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
  private initVoters(): Signal<VoteVoter[] | VoteParticipationVoter[]> {
    const voteUid = computed(() => this.vote().uid);
    return toSignal(
      combineLatest([toObservable(voteUid), this.refresh$.pipe(startWith(undefined))]).pipe(
        switchMap(([uid]) => {
          this.loading.set(true);
          this.loadError.set(false);
          return this.voteService.getVoteVoters(uid).pipe(
            tap(() => this.updatedAt.set(new Date())),
            catchError((error) => {
              console.error('Failed to load vote voters', { status: error?.status, message: error?.message });
              this.loadError.set(true);
              return of([] as VoteVoter[] | VoteParticipationVoter[]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] as VoteVoter[] | VoteParticipationVoter[] }
    );
  }

  private initParticipationRows(): Signal<VoteParticipationVoterRowView[]> {
    return computed(() => {
      if (!this.participationOnly()) return [];
      return (this.response() as (VoteVoter | VoteParticipationVoter)[])
        .filter((voter): voter is VoteParticipationVoter => !('uid' in voter))
        .map((voter) => buildVoteParticipationRowView(voter));
    });
  }

  private initParticipationMatchingRows(): Signal<VoteParticipationVoterRowView[]> {
    return computed(() => {
      const term = this.searchTerm();

      return this.participationRows().filter(
        (row) => !term || row.displayName.toLowerCase().includes(term) || !!row.organization?.toLowerCase().includes(term)
      );
    });
  }

  private initMatchingRows(): Signal<VoteVoterRowView[]> {
    return computed(() => {
      const term = this.searchTerm();
      const choice = this.choiceFilter();
      const vote = this.vote();

      return this.rows().filter(
        (row) =>
          (!term || row.displayName.toLowerCase().includes(term) || !!row.organization?.toLowerCase().includes(term)) &&
          (!choice || matchesVoteVoterChoice(row.voter, choice, vote))
      );
    });
  }

  /** Preserve valid pages on refresh, but move back into range when fewer voters match the current filters. */
  private initTablePageBounds(): void {
    toObservable(this.visibleRows)
      .pipe(takeUntilDestroyed())
      .subscribe((rows) => {
        if (this.loading() || this.loadError()) return;

        const pageSize = this.selectedPageSize();
        const lastPageFirst = Math.max(0, Math.ceil(rows.length / pageSize) - 1) * pageSize;
        if (this.tableFirst() > lastPageFirst) this.tableFirst.set(lastPageFirst);
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

  /** Counts sit in each label: All, Responded and Not responded (#3916). */
  private initParticipationStatusOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const counts = this.participationStatusCounts();
      const ids = Object.keys(VOTE_PARTICIPATION_STATUS_FILTER_LABELS) as VoteParticipationStatusFilter[];
      return ids.map((id) => ({ id, label: `${VOTE_PARTICIPATION_STATUS_FILTER_LABELS[id]} (${counts[id]})` }));
    });
  }

  /** A results link selects its choice — or, for the abstain row, the Abstained pill — over every status. Ignored on a participation-only tab. */
  private initInitialChoice(): void {
    toObservable(this.initialChoice)
      .pipe(
        filter((choice): choice is string => !!choice && !this.participationOnly()),
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

  /** A comment's "View ballot" link opens that ballot once the list has loaded — once per linked ballot. Ignored on a participation-only tab. */
  private initInitialBallot(): void {
    let openedFor: string | null = null;
    const ready = computed(() => {
      const uid = this.initialBallotUid();
      if (!uid || this.loading() || this.participationOnly()) return null;
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
