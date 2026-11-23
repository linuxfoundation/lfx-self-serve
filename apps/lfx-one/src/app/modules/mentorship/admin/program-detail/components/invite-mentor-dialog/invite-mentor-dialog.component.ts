// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import {
  MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_EMAIL_INVITE_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_SEND_LABEL,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS_INTRO,
  MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_DIALOG_SUBTITLE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_PROMPT,
  MENTORSHIP_ADMIN_MENTOR_INVITE_REFUSED_REASONS,
  MENTORSHIP_ADMIN_MENTOR_INVITE_SEARCH_PLACEHOLDER,
  MENTORSHIP_ADMIN_MENTOR_INVITE_SEND_LABEL,
  MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITED_BY_EMAIL_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminMentorCandidate,
  MentorshipAdminMentorInviteRequest,
  MentorshipInviteMentorDialogData,
  MentorshipInviteMentorSearchResult,
} from '@lfx-one/shared/interfaces';
import { isValidEmail, mentorshipPersonAvatarClass, mentorshipPersonInitials, mentorshipUpstreamReasonMessage } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, debounceTime, distinctUntilChanged, map, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

/**
 * Invite a mentor dialog of the Mentors tab. The admin searches LF users by name, LF username or full email and picks one, or,
 * when a full email matches no LF account, invites that address by email; Send invite posts `{ lfid }` or `{ email }`.
 * The dialog sends the invite itself so a refused one keeps the search and the pick for a retry. It closes with `true`
 * when the Mentors list changed (sent, or upstream says the person is already on the program), so the tab reloads.
 */
@Component({
  selector: 'lfx-mentorship-invite-mentor-dialog',
  imports: [ReactiveFormsModule, AvatarComponent, ButtonComponent, InputTextComponent],
  templateUrl: './invite-mentor-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteMentorDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipInviteMentorDialogData>>(DynamicDialogConfig);
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly programId = this.dialogConfig.data?.programId ?? '';
  /** Set once the dialog is gone (closed, or dismissed mid-send), so a send that lands afterwards does not close it again. */
  private closed = false;

  protected readonly subtitle = MENTORSHIP_ADMIN_MENTOR_INVITE_DIALOG_SUBTITLE;
  protected readonly placeholder = MENTORSHIP_ADMIN_MENTOR_INVITE_SEARCH_PLACEHOLDER;
  protected readonly prompt = MENTORSHIP_ADMIN_MENTOR_INVITE_PROMPT;
  protected readonly emailInviteMessage = MENTORSHIP_ADMIN_MENTOR_CANDIDATES_EMAIL_INVITE_MESSAGE;
  protected readonly emailInviteStepsIntro = MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS_INTRO;
  protected readonly emailInviteSteps = MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS;

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
  });

  /** The candidate picked from the results, or null; cleared whenever the search changes. */
  protected readonly selected = signal<MentorshipAdminMentorCandidate | null>(null);
  protected readonly sending = signal(false);

  /** The trimmed search as typed, before the debounce. */
  protected readonly query: Signal<string> = this.initQuery();
  /** The answer to the last search sent, or null while a search is pending or the query is too short to send. */
  protected readonly result: Signal<MentorshipInviteMentorSearchResult | null> = this.initResult();
  protected readonly candidateOptions = this.initCandidateOptions();
  /** The full email the current search found no LF account for, which can be invited by email; null otherwise. */
  protected readonly emailInvitee: Signal<string | null> = this.initEmailInvitee();
  /** Why the current search shows no one to pick, or null while it shows results, the prompt or the email offer. */
  protected readonly emptyMessage: Signal<string | null> = this.initEmptyMessage();
  protected readonly searching = computed(() => this.isSendable(this.query()) && this.result()?.search !== this.query());
  protected readonly showPrompt = computed(() => !this.isSendable(this.query()) && !this.isTooLong(this.query()));
  protected readonly canSend = computed(() => !this.sending() && (!!this.selected() || !!this.emailInvitee()));
  protected readonly sendLabel = computed(() =>
    this.emailInvitee() ? MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_SEND_LABEL : MENTORSHIP_ADMIN_MENTOR_INVITE_SEND_LABEL
  );
  protected readonly sendIcon = computed(() => (this.sending() ? 'fa-light fa-spinner-third fa-spin' : 'fa-light fa-paper-plane'));

  public constructor() {
    this.destroyRef.onDestroy(() => (this.closed = true));
    // The dialog would otherwise focus its close button first; the search is what the admin came for.
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('#mentorship-mentors-invite-search')?.focus());
  }

  protected onSelect(candidate: MentorshipAdminMentorCandidate): void {
    this.selected.set(this.selected()?.lfid === candidate.lfid ? null : candidate);
  }

  protected onClearSearch(): void {
    this.form.controls.search.setValue('');
  }

  /**
   * Enter in the search sends once there is something to send: a picked candidate or an email offer for the text shown.
   * It is bound to the search input only, so Enter on the clear button still clears.
   */
  protected onSearchEnter(event: Event): void {
    event.preventDefault();
    if (this.canSend()) this.onSend();
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  /**
   * Invites the picked candidate by LFID, or the offered email address; the dialog stays open on a refusal. Like the
   * Mentors tab's row actions, the send is never cancelled by the dialog going away (no `takeUntilDestroyed`): aborting
   * it would leave the invite unknown, so a send that lands after a dismissal still toasts and refreshes the list.
   */
  protected onSend(): void {
    if (!this.canSend()) return;
    const candidate = this.selected();
    const email = this.emailInvitee();
    let body: MentorshipAdminMentorInviteRequest;
    let successMessage: string;
    if (candidate) {
      body = { lfid: candidate.lfid };
      successMessage = MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE;
    } else if (email) {
      body = { email };
      successMessage = MENTORSHIP_ADMIN_MENTOR_INVITED_BY_EMAIL_MESSAGE;
    } else {
      return;
    }

    this.sending.set(true);
    this.mentorshipAdminService
      .inviteProgramMentor(this.programId, body)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.showToast('success', 'Success', successMessage, 3000);
          this.onListChanged();
        },
        error: (err: unknown) => {
          this.sending.set(false);
          this.onInviteError(err);
        },
      });
  }

  private initQuery(): Signal<string> {
    const control = this.form.controls.search;
    return toSignal(
      control.valueChanges.pipe(
        startWith(control.value),
        map((value) => value.trim())
      ),
      { initialValue: '' }
    );
  }

  /**
   * Asks upstream for the candidates once typing pauses; a search still in flight is dropped. Every answer, even an
   * empty or failed one, becomes the result, so the dialog stops showing that it is searching.
   */
  private initResult(): Signal<MentorshipInviteMentorSearchResult | null> {
    const control = this.form.controls.search;
    return toSignal(
      control.valueChanges.pipe(
        map((value) => value.trim()),
        distinctUntilChanged(),
        tap(() => this.selected.set(null)),
        debounceTime(MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS),
        switchMap((search) => this.searchCandidates(search))
      ),
      { initialValue: null }
    );
  }

  /** Each candidate with the initials and colour its avatar falls back to. */
  private initCandidateOptions() {
    return computed(() => {
      const result = this.result();
      if (!result || result.search !== this.query()) return [];
      return result.data.map((candidate) => ({
        ...candidate,
        initials: mentorshipPersonInitials(candidate.name),
        avatarStyleClass: mentorshipPersonAvatarClass(candidate.name),
      }));
    });
  }

  /** Only a full email with no error and no one found is offered, and only while it is still the text in the field. */
  private initEmailInvitee(): Signal<string | null> {
    return computed(() => {
      const result = this.result();
      if (!result || result.search !== this.query() || result.error || result.data.length > 0) return null;
      return this.isInvitableEmail(result.search) ? result.search : null;
    });
  }

  /**
   * A search too long to send says so (the BFF would refuse it with a 400). Otherwise a 400 is an unpublished program, a
   * 503 the account lookup being down, and any other failure is generic. With no failure and no one found, a name or an
   * LF username says that no one matches; a full email is offered for an email invite instead.
   */
  private initEmptyMessage(): Signal<string | null> {
    return computed(() => {
      const query = this.query();
      if (this.isTooLong(query)) return MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE;
      const result = this.result();
      if (!result || result.search !== query) return null;
      if (result.error) {
        const status = result.error instanceof HttpErrorResponse ? result.error.status : 0;
        if (status === 400) return MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE;
        return status === 503 ? MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE : MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE;
      }
      if (result.data.length > 0 || this.isInvitableEmail(result.search)) return null;
      return MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE;
    });
  }

  /** A query outside the lengths upstream accepts is not sent and answers with no one. */
  private searchCandidates(search: string): Observable<MentorshipInviteMentorSearchResult> {
    if (!this.isSendable(search)) return of({ search, data: [], error: null });
    return this.mentorshipAdminService.getMentorCandidates(this.programId, search).pipe(
      map((response) => ({ search, data: response.data, error: null })),
      catchError((error: unknown) => of({ search, data: [], error }))
    );
  }

  /**
   * A 409 means the person is already invited or a mentor, so the list reloads to show them and the dialog closes. A 400
   * (an unpublished program), a 422 (no LF account, or another reason upstream names; see
   * `MENTORSHIP_ADMIN_MENTOR_INVITE_REFUSED_REASONS`), a 503 (account lookup down) and every other failure keep the
   * dialog open so the admin can retry.
   */
  private onInviteError(err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE, 5000);
      this.onListChanged();
      return;
    }
    if (status === 400) {
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE, 5000);
      return;
    }
    if (status === 422) {
      const reason = mentorshipUpstreamReasonMessage(MENTORSHIP_ADMIN_MENTOR_INVITE_REFUSED_REASONS, serverAuthoredMessage(err, ''));
      this.showToast('error', 'Error', reason ?? MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE, 5000);
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

  /** Has the Mentors tab reload its list and counts, then closes the dialog unless it is already gone. */
  private onListChanged(): void {
    this.dialogConfig.data?.onListChanged();
    if (!this.closed) this.dialogRef.close(true);
  }

  private showToast(severity: 'success' | 'error', summary: string, detail: string, life: number): void {
    this.messageService.add({ severity, summary, detail, life });
  }

  /** Code points, as upstream counts runes: an emoji is one character, not two UTF-16 units. */
  private isSendable(search: string): boolean {
    const length = Array.from(search).length;
    return length >= MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH && length <= MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH;
  }

  private isTooLong(search: string): boolean {
    return Array.from(search).length > MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH;
  }

  /** A full email address short enough for the BFF to forward on an invite. */
  private isInvitableEmail(search: string): boolean {
    return search.length <= MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH && isValidEmail(search);
  }
}
