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
  MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS,
  MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskCreateRequest, MentorshipMentorTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { catchError, concatMap, from, Observable, of, reduce, tap } from 'rxjs';

/**
 * Creates a mentor's task for one or more accepted mentees and toasts the outcome, for the mentor program detail.
 * The caller handles no error: `create` emits which applications got the task and which did not, or `null` when
 * the request failed outright, after showing why. A group create can reach only some mentees, which shows as a
 * warning naming the mentees who were missed (from `menteeNames`, keyed by application id). Upstream's create is
 * not idempotent, and a failure without a status of its own (a timeout, a 5xx) may still have created the task, so
 * every failure copy sends the mentor to the row rather than to a retry. A group past
 * `MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS` is sent in batches of that size, one after another. A
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
    return this.send(request).pipe(
      tap((result) => this.showResult(result, menteeNames)),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorTaskCreateService] create failed', err);
        this.showCreateError(err);
        return of(null);
      })
    );
  }

  /** One request, or one per batch for a group past the BFF's cap, merged; a failed batch counts its mentees as failed. */
  private send(request: MentorshipMentorTaskCreateRequest): Observable<MentorshipMentorTaskCreateResponse> {
    const { applicationIds } = request;
    if (applicationIds.length <= MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS) return this.mentorService.createMenteeTasks(request);

    const batches: string[][] = [];
    for (let start = 0; start < applicationIds.length; start += MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS) {
      batches.push(applicationIds.slice(start, start + MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS));
    }
    const none: MentorshipMentorTaskCreateResponse = { created: [], failed: [] };
    return from(batches).pipe(
      concatMap((batch) =>
        this.mentorService.createMenteeTasks({ ...request, applicationIds: batch }).pipe(
          catchError((err: HttpErrorResponse) => {
            console.error('[MentorTaskCreateService] create batch failed', err);
            return of({ created: [], failed: batch });
          })
        )
      ),
      reduce((all, batch) => ({ created: [...all.created, ...batch.created], failed: [...all.failed, ...batch.failed] }), none)
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
        detail: `${failed.length} of ${total} tasks were not created. Check the mentees' rows before trying again.`,
        life: MENTORSHIP_MENTOR_TASK_CREATE_TOAST_LIFE,
      });
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
      detail: `${this.missedMentees(failed, total, menteeNames)} did not get the task. Check their row, and create it there if it is still missing, so the others do not get it twice.`,
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
