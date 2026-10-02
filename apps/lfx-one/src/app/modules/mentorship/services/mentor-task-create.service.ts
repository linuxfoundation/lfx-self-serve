// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_TASK_CREATE_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_TASK_CREATE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskCreateRequest, MentorshipMentorTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { catchError, Observable, of, tap } from 'rxjs';

/**
 * Creates a mentor's task for one or more accepted mentees and toasts the outcome, for the mentor program detail.
 * The caller handles no error: `create` emits which applications got the task and which did not, or `null` when
 * the request failed outright, after showing why. A group create can reach only some mentees, which shows as a
 * warning naming how many were missed. A single-mentee failure gets its status's copy; the impersonation guard's
 * 403 shows the server's message.
 */
@Injectable({ providedIn: 'root' })
export class MentorTaskCreateService {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);

  public create(request: MentorshipMentorTaskCreateRequest): Observable<MentorshipMentorTaskCreateResponse | null> {
    return this.mentorService.createMenteeTasks(request).pipe(
      tap((result) => this.showResult(result)),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorTaskCreateService] create failed', err);
        this.showCreateError(err);
        return of(null);
      })
    );
  }

  private showResult({ created, failed }: MentorshipMentorTaskCreateResponse): void {
    const total = created.length + failed.length;
    if (failed.length === 0) {
      this.messageService.add({
        severity: 'success',
        summary: MENTORSHIP_MENTOR_TASK_CREATE_SUCCESS_SUMMARY,
        detail: total > 1 ? `${total} mentees were given the task.` : undefined,
        life: MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
      });
      return;
    }

    const noneCreated = created.length === 0;
    this.messageService.add({
      severity: noneCreated ? 'error' : 'warn',
      summary: noneCreated ? MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY : MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
      detail: `${failed.length} of ${total} tasks were not created. Refresh the page and try again.`,
      life: MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
    });
  }

  private showCreateError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_MENTOR_TASK_CREATE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_MENTOR_TASK_CREATE_ERROR_FALLBACK;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTOR_TASK_CREATE_ERROR_FALLBACK);
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
    });
  }
}
