// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_TASK_STATUS_STALE_STATUSES,
  MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeUpdatableTaskStatus } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Saves a mentee's task status change and toasts the outcome, for the My Tasks rows. Kept out of the
 * row so the row holds no `HttpClient` or `MessageService`.
 *
 * `changeStatus` never errors: it emits `true` when the change was saved and `false` when it was not,
 * after showing the reason. A success leaves the refresh to `MentorshipMenteeService`, which drops the
 * cached applications. A failure that means the mentee's view is out of date (see
 * `MENTORSHIP_MENTEE_TASK_STATUS_STALE_STATUSES`) also re-reads them; the impersonation guard's 403
 * shows the server's message and re-reads nothing.
 *
 * Callers must not cancel the returned observable when their view goes away (no `takeUntilDestroyed`):
 * the cached applications are invalidated and the toast is shown only when the request completes, so
 * cancelling it client-side would leave the session's overview and open-task badge stale.
 */
@Injectable({ providedIn: 'root' })
export class MenteeTaskStatusService {
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly messageService = inject(MessageService);

  public changeStatus(taskId: string, status: MentorshipMenteeUpdatableTaskStatus): Observable<boolean> {
    return this.menteeService.updateMenteeTaskStatus(taskId, status).pipe(
      map(() => {
        this.messageService.add({
          severity: 'success',
          summary: MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_SUMMARY,
          detail: MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_DETAIL,
          life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
        });
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        console.error('[MenteeTaskStatusService] changeStatus failed', err);
        this.showStatusError(err);
        return of(false);
      })
    );
  }

  private showStatusError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES[err.status] ?? MENTORSHIP_MENTEE_TASK_STATUS_ERROR_FALLBACK;

    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTEE_TASK_STATUS_ERROR_FALLBACK);
    } else if (MENTORSHIP_MENTEE_TASK_STATUS_STALE_STATUSES.includes(err.status)) {
      this.menteeService.clearMenteeCaches();
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTEE_TASK_STATUS_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
    });
  }
}
