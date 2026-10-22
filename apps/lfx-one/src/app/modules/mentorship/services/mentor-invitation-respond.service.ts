// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_INVITATION_ACCEPT_SUCCESS_DETAIL,
  MENTORSHIP_MENTOR_INVITATION_ACCEPT_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_CONFIRM,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_CONFIRM_HEADER,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_LABEL,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_SUCCESS_DETAIL,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_INVITATION_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_INVITATION_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
  MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMentorInvitationResponse, MentorshipMentorInviteDecision } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { finalize, Subject } from 'rxjs';

/**
 * Accept or decline for a mentor's open invitation, by its id. Provided per view alongside
 * `ConfirmationService`, so that view's own `<p-confirmDialog />` shows the decline prompt and the busy
 * state belongs to it. Accepting needs no confirmation; declining does, since only a program
 * administrator can invite the mentor again.
 *
 * A success toasts and leaves the refresh to `MentorshipMentorService`, which drops the cached
 * requests. A failure that means the view is out of date (see
 * `MENTORSHIP_MENTOR_INVITATION_STALE_ERROR_MESSAGES`) toasts that copy and re-reads the list; the
 * impersonation guard's 403 shows the server's message and re-reads nothing. A successful accept also
 * emits on `accepted$`, since the accepted membership can change what the view around the drawer shows.
 */
@Injectable()
export class MentorInvitationRespondService {
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly mentorService = inject(MentorshipMentorService);

  private readonly respondingSignal = signal<MentorshipMentorInvitationResponse | null>(null);
  private readonly acceptedSubject = new Subject<string>();

  /** The invitation being answered, or `null`. Views disable the Accept and Decline buttons while set. */
  public readonly respondingId = computed(() => this.respondingSignal()?.invitationId ?? null);
  /** The answer being sent, or `null`, so a view can show the loading state on the button that was pressed. */
  public readonly respondingDecision = computed(() => this.respondingSignal()?.decision ?? null);
  /** Emits the id of each invitation accepted. */
  public readonly accepted$ = this.acceptedSubject.asObservable();

  /** Accepts at once. Ignored while another answer is in flight. */
  public accept(invitationId: string): void {
    if (this.respondingSignal()) {
      return;
    }
    this.respond(invitationId, 'accept');
  }

  /** Asks the mentor to confirm, then declines. Ignored while another answer is in flight. */
  public confirmDecline(invitationId: string): void {
    if (this.respondingSignal()) {
      return;
    }

    this.confirmationService.confirm({
      header: MENTORSHIP_MENTOR_INVITATION_DECLINE_CONFIRM_HEADER,
      message: MENTORSHIP_MENTOR_INVITATION_DECLINE_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: MENTORSHIP_MENTOR_INVITATION_DECLINE_LABEL,
      rejectLabel: MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.respond(invitationId, 'decline'),
    });
  }

  private respond(invitationId: string, decision: MentorshipMentorInviteDecision): void {
    this.respondingSignal.set({ invitationId, decision });
    this.mentorService
      .respondToMentorInvitation(invitationId, decision)
      .pipe(finalize(() => this.respondingSignal.set(null)))
      .subscribe({
        next: () => {
          const accepted = decision === 'accept';
          this.messageService.add({
            severity: 'success',
            summary: accepted ? MENTORSHIP_MENTOR_INVITATION_ACCEPT_SUCCESS_SUMMARY : MENTORSHIP_MENTOR_INVITATION_DECLINE_SUCCESS_SUMMARY,
            detail: accepted ? MENTORSHIP_MENTOR_INVITATION_ACCEPT_SUCCESS_DETAIL : MENTORSHIP_MENTOR_INVITATION_DECLINE_SUCCESS_DETAIL,
            life: MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
          });
          if (accepted) {
            this.acceptedSubject.next(invitationId);
          }
        },
        error: (err: HttpErrorResponse) => this.showError(err),
      });
  }

  private showError(err: HttpErrorResponse): void {
    console.error('[MentorInvitationRespondService] answer failed', err);
    const code = (err.error as { code?: string } | null | undefined)?.code;
    const staleMessage = MENTORSHIP_MENTOR_INVITATION_STALE_ERROR_MESSAGES[err.status];
    let detail = MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK;

    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK);
    } else if (staleMessage) {
      detail = staleMessage;
      this.mentorService.clearMentorCaches();
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTOR_INVITATION_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
    });
  }
}
