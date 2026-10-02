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
 * warning naming the mentees who were missed (from `menteeNames`, keyed by application id) and pointing at their
 * rows: upstream has no idempotent create, so a second group create would give the others the task twice. A
 * single-mentee failure gets its status's copy; the impersonation guard's 403 shows the server's message.
 */
@Injectable({ providedIn: 'root' })
export class MentorTaskCreateService {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);

  public create(
    request: MentorshipMentorTaskCreateRequest,
    menteeNames: Readonly<Record<string, string>> = {}
  ): Observable<MentorshipMentorTaskCreateResponse | null> {
    return this.mentorService.createMenteeTasks(request).pipe(
      tap((result) => this.showResult(result, menteeNames)),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorTaskCreateService] create failed', err);
        this.showCreateError(err);
        return of(null);
      })
    );
  }

  private showResult({ created, failed }: MentorshipMentorTaskCreateResponse, menteeNames: Readonly<Record<string, string>>): void {
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

    if (created.length === 0) {
      this.messageService.add({
        severity: 'error',
        summary: MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY,
        detail: `${failed.length} of ${total} tasks were not created. Refresh the page and try again.`,
        life: MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
      });
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
      detail: `${this.missedMentees(failed, total, menteeNames)} did not get the task. Create it from their row, so the others do not get it twice.`,
      life: MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
    });
  }

  /** The missed mentees by name, or a count when a name is not known. */
  private missedMentees(failed: string[], total: number, menteeNames: Readonly<Record<string, string>>): string {
    const names = failed.map((applicationId) => menteeNames[applicationId]).filter((name): name is string => !!name);
    return names.length === failed.length ? names.join(', ') : `${failed.length} of ${total} mentees`;
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
