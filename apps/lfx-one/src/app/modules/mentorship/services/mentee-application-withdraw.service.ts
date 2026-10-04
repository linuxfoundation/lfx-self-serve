// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_WITHDRAW_CANCEL_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_MESSAGE,
  MENTORSHIP_MENTEE_WITHDRAW_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_WITHDRAW_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_WITHDRAW_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_WITHDRAW_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

/**
 * Confirm-then-withdraw for a mentee's pending application, shared by the Overview cards and
 * the profile's Application History. Provided per page alongside `ConfirmationService`, so the
 * page's own `<p-confirmDialog />` shows the prompt and the busy state belongs to that page.
 *
 * A success toasts and leaves the refresh to `MentorshipMenteeService`, which drops the cached
 * applications. A failure that means the page is out of date (see
 * `MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES`) toasts that copy and re-reads the list;
 * the impersonation guard's 403 shows the server's message and re-reads nothing.
 */
@Injectable()
export class MenteeApplicationWithdrawService {
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly menteeService = inject(MentorshipMenteeService);

  private readonly withdrawingIdSignal = signal<string | null>(null);

  /** The application being withdrawn, or `null`. Pages disable its Withdraw button while set. */
  public readonly withdrawingId = this.withdrawingIdSignal.asReadonly();

  /** Asks the mentee to confirm, then withdraws. Ignored while another withdraw is in flight. */
  public confirmWithdraw(applicationId: string): void {
    if (this.withdrawingIdSignal()) {
      return;
    }

    this.confirmationService.confirm({
      header: MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER,
      message: MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_MESSAGE,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: MENTORSHIP_MENTEE_WITHDRAW_LABEL,
      rejectLabel: MENTORSHIP_MENTEE_WITHDRAW_CANCEL_LABEL,
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.withdraw(applicationId),
    });
  }

  private withdraw(applicationId: string): void {
    this.withdrawingIdSignal.set(applicationId);
    this.menteeService
      .withdrawMenteeApplication(applicationId)
      .pipe(finalize(() => this.withdrawingIdSignal.set(null)))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY,
            detail: MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_DETAIL,
            life: MENTORSHIP_MENTEE_WITHDRAW_TOAST_LIFE,
          });
        },
        error: (err: HttpErrorResponse) => this.showWithdrawError(err),
      });
  }

  private showWithdrawError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    const staleMessage = MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES[err.status];
    let detail = MENTORSHIP_MENTEE_WITHDRAW_ERROR_FALLBACK;

    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTEE_WITHDRAW_ERROR_FALLBACK);
    } else if (staleMessage) {
      detail = staleMessage;
      this.menteeService.clearMenteeCaches();
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTEE_WITHDRAW_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_MENTEE_WITHDRAW_TOAST_LIFE,
    });
  }
}
