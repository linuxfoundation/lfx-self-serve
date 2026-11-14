// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
  MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTOR_WITHDRAW_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_WITHDRAW_LABEL,
  MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_DETAIL,
  MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

/**
 * Confirm-then-withdraw for a mentor's pending program request. Provided per view alongside
 * `ConfirmationService`, so that view's own `<p-confirmDialog />` shows the prompt and the busy state
 * belongs to it.
 *
 * A success toasts and leaves the refresh to `MentorshipMentorService`, which drops the cached
 * requests. A failure that means the view is out of date (see
 * `MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES`) toasts that copy and re-reads the list; the
 * impersonation guard's 403 shows the server's message and re-reads nothing.
 */
@Injectable()
export class MentorRequestWithdrawService {
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly mentorService = inject(MentorshipMentorService);

  private readonly withdrawingIdSignal = signal<string | null>(null);

  /** The request being withdrawn, or `null`. Views disable the Withdraw buttons while set. */
  public readonly withdrawingId = this.withdrawingIdSignal.asReadonly();

  /** Asks the mentor to confirm, then withdraws. Ignored while another withdraw is in flight. */
  public confirmWithdraw(requestId: string): void {
    if (this.withdrawingIdSignal()) {
      return;
    }

    this.confirmationService.confirm({
      header: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER,
      message: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: MENTORSHIP_MENTOR_WITHDRAW_LABEL,
      rejectLabel: MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.withdraw(requestId),
    });
  }

  private withdraw(requestId: string): void {
    this.withdrawingIdSignal.set(requestId);
    this.mentorService
      .withdrawMentorRequest(requestId)
      .pipe(finalize(() => this.withdrawingIdSignal.set(null)))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY,
            detail: MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_DETAIL,
            life: MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
          });
        },
        error: (err: HttpErrorResponse) => this.showWithdrawError(err),
      });
  }

  private showWithdrawError(err: HttpErrorResponse): void {
    console.error('[MentorRequestWithdrawService] withdraw failed', err);
    const code = (err.error as { code?: string } | null | undefined)?.code;
    const staleMessage = MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES[err.status];
    let detail = MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK;

    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK);
    } else if (staleMessage) {
      detail = staleMessage;
      this.mentorService.clearMentorCaches();
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTOR_WITHDRAW_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
    });
  }
}
