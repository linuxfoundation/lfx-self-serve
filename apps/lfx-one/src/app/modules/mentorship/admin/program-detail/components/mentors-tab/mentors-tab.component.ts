// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_DECISION_IN_FLIGHT_MESSAGE,
  MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_HELP_TEXT,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_ADMIN_MENTOR_ACTION_APPEARANCE,
  MENTORSHIP_ADMIN_MENTOR_ACTION_CONFIRM_MESSAGES,
  MENTORSHIP_ADMIN_MENTOR_ACTION_SUCCESS_MESSAGES,
  MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS,
  MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_STATUS_BADGE_CLASSES,
  MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS,
  MENTORSHIP_ADMIN_MENTOR_STATUSES,
  MENTORSHIP_ADMIN_MENTORS_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  FilterOption,
  MentorshipAdminMentorAction,
  MentorshipAdminMentorCandidate,
  MentorshipAdminMentorStatus,
  MentorshipProgramMentor,
} from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, Subject, switchMap, take, tap } from 'rxjs';

/**
 * Mentors tab — the program's mentors and their invitation status, one server page at a time. The toolbar pairs a
 * search and status filter (both go upstream) with an invitee search that asks upstream for matching LF accounts by
 * name, LF username or full email (shown by name and LFID, never email) + an Invite button that invites the picked
 * candidate by LFID. Rows expose Accept / Decline / Revoke invite / Remove, gated by the mentor's status; each confirms, writes through
 * the BFF, then reloads the page and has the parent refresh the tab counts.
 */
@Component({
  selector: 'lfx-mentorship-mentors-tab',
  imports: [
    ReactiveFormsModule,
    ConfirmDialogModule,
    AutocompleteComponent,
    AvatarComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    TableComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './mentors-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorsTabComponent {
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  public readonly programId = input.required<string>();
  /**
   * Has the parent program page read its tab counts again. A callback rather than an output, as on Current Mentees:
   * a write that lands after a tab switch destroyed this tab must still refresh the parent's counts.
   */
  public readonly countsRefresh = input<() => void>(() => undefined);

  protected readonly pageSize = MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE;
  protected readonly loadErrorMessage = MENTORSHIP_ADMIN_MENTORS_LOAD_ERROR_MESSAGE;
  protected readonly candidateMinSearchLength = MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH;
  protected readonly candidateHelpText = MENTORSHIP_ADMIN_MENTOR_CANDIDATES_HELP_TEXT;

  protected readonly statusOptions: FilterOption<MentorshipAdminMentorStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_ADMIN_MENTOR_STATUSES.map((status) => ({ label: MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipAdminMentorStatus | null>(null),
    /** The text typed while searching, then the picked candidate. */
    invitee: new FormControl<MentorshipAdminMentorCandidate | string | null>(null),
  });

  /** Offset of the page shown; the table's paginator reads it and a page change writes it. */
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  private readonly mentors = signal<MentorshipProgramMentor[]>([]);

  private readonly search = signal('');
  private readonly status = signal<MentorshipAdminMentorStatus | null>(null);
  private readonly reloadCount = signal(0);
  private readonly writeInFlight = signal(false);
  private readonly candidates = signal<MentorshipAdminMentorCandidate[]>([]);
  private readonly candidateSearch$ = new Subject<string>();
  /** Set when the tab is destroyed, so a write that lands afterwards does not reload the gone table. */
  private destroyed = false;

  private readonly invitee = toSignal(this.form.controls.invitee.valueChanges.pipe(startWith(this.form.controls.invitee.value)), {
    initialValue: this.form.controls.invitee.value,
  });

  protected readonly candidateOptions = this.initCandidateOptions();
  /** What the open search panel says when the search found no one. */
  protected readonly candidatesEmptyMessage = signal(MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE);
  /** Only a picked candidate can be invited, not text typed and left, and only while no other write is in flight. */
  protected readonly canInvite = computed(() => this.isCandidate(this.invitee()) && !this.writeInFlight());
  protected readonly rows = this.initRows();

  public constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    this.initFilters();
    this.initPageReads();
    this.initCandidateSearch();
  }

  protected onLazyLoad(event: { first?: number | null }): void {
    this.offset.set(event.first ?? 0);
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  /** The autocomplete calls this once typing pauses on at least `candidateMinSearchLength` characters. */
  protected onCandidateSearch(event: AutoCompleteCompleteEvent): void {
    this.candidateSearch$.next(event.query.trim());
  }

  /**
   * Invites the picked candidate by LFID. Like a row action it is never cancelled by the tab going away, and shares the
   * one-write-at-a-time guard. On success the field clears, the page reloads to show the invited row and the parent
   * refreshes the counts.
   */
  protected onInviteMentor(): void {
    const invitee = this.form.controls.invitee.value;
    if (!this.isCandidate(invitee)) return;
    if (this.writeInFlight()) {
      this.showToast('info', 'Please wait', MENTORSHIP_ADMIN_DECISION_IN_FLIGHT_MESSAGE, 3000);
      return;
    }
    this.writeInFlight.set(true);
    this.mentorshipAdminService
      .inviteProgramMentor(this.programId(), { lfid: invitee.lfid })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.writeInFlight.set(false);
          this.form.controls.invitee.reset(null);
          this.showToast('success', 'Success', MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE, 3000);
          this.countsRefresh()();
          this.reloadPage();
        },
        error: (err: unknown) => {
          this.writeInFlight.set(false);
          this.onInviteError(err);
        },
      });
  }

  /** Always confirms; the write runs only on accept. */
  protected onMentorAction(mentor: MentorshipProgramMentor, action: MentorshipAdminMentorAction): void {
    this.confirmationService.confirm({
      header: action.label,
      message: MENTORSHIP_ADMIN_MENTOR_ACTION_CONFIRM_MESSAGES[action.key],
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: action.label,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: action.key === 'remove' ? 'p-button-sm p-button-danger' : 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.writeMentorStatus(mentor.id, action),
    });
  }

  private initRows() {
    return computed(() => this.mentors().map((person) => this.toRow(person)));
  }

  /** Search waits for typing to pause; the status applies at once. Every change goes back to the first page. */
  private initFilters(): void {
    this.form.controls.search.valueChanges
      .pipe(debounceTime(MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.search.set(search.trim());
        this.offset.set(0);
      });
    this.form.controls.status.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.status.set(status);
      this.offset.set(0);
    });
  }

  /**
   * Reads the page whenever the program, a filter, the offset or the retry count changes; a read still in flight is
   * dropped. A failed read keeps nothing on screen but the error, so Retry reads the same page again.
   */
  private initPageReads(): void {
    const query = computed(() => ({
      programId: this.programId(),
      search: this.search(),
      status: this.status(),
      offset: this.offset(),
      reload: this.reloadCount(),
    }));

    toObservable(query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadFailed.set(false);
        }),
        switchMap(({ programId, search, status, offset }) =>
          this.mentorshipAdminService
            .getProgramMentors(programId, {
              search: search || undefined,
              status: status ?? undefined,
              offset,
              limit: MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
            })
            .pipe(
              map((page) => ({ page })),
              catchError(() => of({ page: null }))
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ page }) => {
        this.loading.set(false);
        if (!page) {
          this.mentors.set([]);
          this.total.set(0);
          this.loadFailed.set(true);
          return;
        }
        this.mentors.set(page.data);
        this.total.set(page.total);
      });
  }

  private toRow(person: MentorshipProgramMentor) {
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_ADMIN_MENTOR_STATUS_BADGE_CLASSES[person.status],
      invitationLabel: person.invitedOn ? formatIsoDateLabel(person.invitedOn) : '—',
      profileCreatedLabel: person.profileCreated ? 'Yes' : 'No',
      profileCreatedClass: person.profileCreated ? 'text-emerald-600' : 'text-red-600',
      actions: MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS[person.status].map((action) => ({
        ...action,
        ...MENTORSHIP_ADMIN_MENTOR_ACTION_APPEARANCE[action.key],
      })),
    };
  }

  /**
   * Sends one status change and is never cancelled by the tab going away (no `takeUntilDestroyed`): aborting it would
   * leave the change unknown and untoasted. A write that lands after the tab is gone still toasts and refreshes the
   * parent's counts, but skips the table reload.
   */
  private writeMentorStatus(memberId: string, action: MentorshipAdminMentorAction): void {
    if (this.writeInFlight()) {
      this.showToast('info', 'Please wait', MENTORSHIP_ADMIN_DECISION_IN_FLIGHT_MESSAGE, 3000);
      return;
    }
    this.writeInFlight.set(true);
    this.mentorshipAdminService
      .updateProgramMentor(this.programId(), memberId, { status: action.status })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.writeInFlight.set(false);
          this.showToast('success', 'Success', MENTORSHIP_ADMIN_MENTOR_ACTION_SUCCESS_MESSAGES[action.key], 3000);
          this.countsRefresh()();
          this.reloadPage();
        },
        error: (err: unknown) => {
          this.writeInFlight.set(false);
          this.onWriteError(err);
        },
      });
  }

  /** A 409 means the mentor moved on, so the page reloads; an impersonation 403 shows the server's text. */
  private onWriteError(err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      this.reloadPage();
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE, 5000);
      return;
    }
    if (status === 403 && (err as HttpErrorResponse).error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      this.showToast('error', 'Error', serverAuthoredMessage(err, MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE), 5000);
      return;
    }
    this.showToast('error', 'Error', MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE, 5000);
  }

  /**
   * A 409 means the person is already invited or a mentor, so the field clears and the page reloads to show them. A 400
   * (an unpublished program), a 422 (no LF account), a 503 (account lookup down) and every other failure keep the pick
   * so the admin can retry.
   */
  private onInviteError(err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      this.form.controls.invitee.reset(null);
      this.reloadPage();
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE, 5000);
      return;
    }
    if (status === 400) {
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE, 5000);
      return;
    }
    if (status === 422) {
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE, 5000);
      return;
    }
    if (status === 503) {
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE, 5000);
      return;
    }
    if (status === 403 && (err as HttpErrorResponse).error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      this.showToast('error', 'Error', serverAuthoredMessage(err, MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE), 5000);
      return;
    }
    this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE, 5000);
  }

  private reloadPage(): void {
    if (!this.destroyed) this.reloadCount.update((count) => count + 1);
  }

  private showToast(severity: 'success' | 'error' | 'info', summary: string, detail: string, life: number): void {
    this.messageService.add({ severity, summary, detail, life });
  }

  private isCandidate(value: MentorshipAdminMentorCandidate | string | null): value is MentorshipAdminMentorCandidate {
    return typeof value === 'object' && !!value?.lfid;
  }

  /** Each candidate with the initials and colour its avatar falls back to. Upstream is the authority on a duplicate invite. */
  private initCandidateOptions() {
    return computed(() =>
      this.candidates().map((candidate) => ({
        ...candidate,
        initials: mentorshipPersonInitials(candidate.name),
        avatarStyleClass: mentorshipPersonAvatarClass(candidate.name),
      }))
    );
  }

  /**
   * Asks upstream for the candidates of each search; a search still in flight is dropped. Every answer, even an empty
   * or failed one, sets a new list so the panel stops loading. A failure leaves no one to pick and says why in the panel.
   */
  private initCandidateSearch(): void {
    this.candidateSearch$
      .pipe(
        switchMap((search) => {
          // Code points, as upstream counts runes: an emoji is one character, not two UTF-16 units.
          const length = Array.from(search).length;
          if (length < MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH || length > MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH) {
            return of({ search, data: [] as MentorshipAdminMentorCandidate[], error: null as unknown });
          }
          return this.mentorshipAdminService.getMentorCandidates(this.programId(), search).pipe(
            map((response) => ({ search, data: response.data, error: null as unknown })),
            catchError((error: unknown) => of({ search, data: [] as MentorshipAdminMentorCandidate[], error }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ search, data, error }) => {
        this.candidatesEmptyMessage.set(this.candidatesEmptyMessageFor(search, error));
        this.candidates.set(data);
      });
  }

  /**
   * A search too long to send says so (the BFF would refuse it with a 400). Otherwise a 400 is an unpublished program, a
   * 503 the account lookup being down, and any other failure is generic. With no failure, only a full email gets the
   * account-creation hint: a single word can be a name or an LF username of someone who already has an account.
   */
  private candidatesEmptyMessageFor(search: string, error: unknown): string {
    if (Array.from(search).length > MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH) return MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE;
    if (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if (status === 400) return MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE;
      return status === 503 ? MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE : MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search)
      ? MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE
      : MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE;
  }
}
