// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_TASK_REVIEW_SUCCESS_SUMMARIES,
  MENTORSHIP_MENTOR_TASK_REVIEW_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskReviewDecision } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Approves a mentee's submitted task or requests changes on it, and toasts the outcome, for the mentor program
 * detail. The caller handles no error: `review` emits `true` once the decision is saved and `false` when it was
 * not, after showing why. A 403 (no longer a mentor of the program), a 404 (the task is gone) and a 409 (the task
 * is no longer awaiting review) get their own copy; the impersonation guard's 403 shows the server's message.
 */
@Injectable({ providedIn: 'root' })
export class MentorTaskReviewService {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);

  public review(taskId: string, status: MentorshipMentorTaskReviewDecision): Observable<boolean> {
    return this.mentorService.reviewMenteeTask(taskId, status).pipe(
      map(() => {
        this.messageService.add({
          severity: 'success',
          summary: MENTORSHIP_MENTOR_TASK_REVIEW_SUCCESS_SUMMARIES[status],
          life: MENTORSHIP_MENTOR_TASK_REVIEW_TOAST_LIFE,
        });
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorTaskReviewService] review failed', err);
        this.showReviewError(err);
        return of(false);
      })
    );
  }

  private showReviewError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_MESSAGES[err.status] ?? MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_FALLBACK;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_FALLBACK);
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_MENTOR_TASK_REVIEW_TOAST_LIFE,
    });
  }
}
