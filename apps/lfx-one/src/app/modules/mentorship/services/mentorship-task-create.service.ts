// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_TASK_CREATE_ERROR_FALLBACK,
  MENTORSHIP_TASK_CREATE_ERROR_MESSAGES,
  MENTORSHIP_TASK_CREATE_ERROR_SUMMARY,
  MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS,
  MENTORSHIP_TASK_CREATE_PARTIAL_SUMMARY,
  MENTORSHIP_TASK_CREATE_SUCCESS_SUMMARY,
  MENTORSHIP_TASK_CREATE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipTaskCreateRequest, MentorshipTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { catchError, concatMap, defer, finalize, from, Observable, of, reduce, tap, throwError } from 'rxjs';

/**
 * Creates a task for one or more accepted mentees and toasts the outcome, for the admin and mentor program details.
 * The caller handles no error: `create` emits which applications got the task and which did not, or `null` when
 * the request failed outright, after showing why. A group create can reach only some mentees, which shows as a
 * warning naming the mentees who were missed (from `menteeNames`, keyed by application id). Upstream's create is
 * not idempotent, and a failure without a status of its own (a timeout, a 5xx) may still have created the task, so
 * every failure copy sends the caller to the row rather than to a retry. A group past
 * `MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS` is sent in batches of that size, one after another. A single-mentee
 * failure gets its status's copy; the impersonation guard's 403 shows the server's message.
 *
 * Which applications are getting a task lives here rather than in the page: switching tabs can destroy the tab that
 * started a create, and a rebuilt tab must not send the same task again meanwhile.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipTaskCreateService {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);

  private readonly creatingIds = new Set<string>();

  /** Whether a task is being created for the application; the page sends no other create for it meanwhile. */
  public isCreating(applicationId: string): boolean {
    return this.creatingIds.has(applicationId);
  }

  public create(request: MentorshipTaskCreateRequest, menteeNames: Readonly<Record<string, string>> = {}): Observable<MentorshipTaskCreateResponse | null> {
    return defer(() => {
      request.applicationIds.forEach((applicationId) => this.creatingIds.add(applicationId));
      return this.send(request);
    }).pipe(
      tap((result) => this.showResult(result, menteeNames)),
      catchError((err: HttpErrorResponse) => {
        this.showCreateError(err);
        return of(null);
      }),
      finalize(() => request.applicationIds.forEach((applicationId) => this.creatingIds.delete(applicationId)))
    );
  }

  /**
   * One request, or one per batch for a group past the BFF's cap, merged; a failed batch counts its mentees as failed.
   * The impersonation guard refuses every batch before any is created, so its 403 ends the send and shows its message.
   */
  private send(request: MentorshipTaskCreateRequest): Observable<MentorshipTaskCreateResponse> {
    const { applicationIds } = request;
    if (applicationIds.length <= MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS) return this.mentorshipService.createTasks(request);

    const batches: string[][] = [];
    for (let start = 0; start < applicationIds.length; start += MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS) {
      batches.push(applicationIds.slice(start, start + MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS));
    }
    const none: MentorshipTaskCreateResponse = { created: [], failed: [] };
    return from(batches).pipe(
      concatMap((batch) =>
        this.mentorshipService.createTasks({ ...request, applicationIds: batch }).pipe(
          catchError((err: HttpErrorResponse) => {
            if (this.isImpersonationRefusal(err)) return throwError(() => err);
            return of({ created: [], failed: batch });
          })
        )
      ),
      reduce((all, batch) => ({ created: [...all.created, ...batch.created], failed: [...all.failed, ...batch.failed] }), none)
    );
  }

  private showResult({ created, failed }: MentorshipTaskCreateResponse, menteeNames: Readonly<Record<string, string>>): void {
    const total = created.length + failed.length;
    if (failed.length === 0) {
      this.messageService.add({
        severity: 'success',
        summary: MENTORSHIP_TASK_CREATE_SUCCESS_SUMMARY,
        detail: total > 1 ? `${total} mentees were given the task.` : undefined,
        life: MENTORSHIP_TASK_CREATE_TOAST_LIFE,
      });
      return;
    }

    if (created.length === 0) {
      this.messageService.add({
        severity: 'error',
        summary: MENTORSHIP_TASK_CREATE_ERROR_SUMMARY,
        detail:
          total === 1
            ? MENTORSHIP_TASK_CREATE_ERROR_FALLBACK
            : `${failed.length} of ${total} tasks were not created. Check the mentees' rows before trying again.`,
        life: MENTORSHIP_TASK_CREATE_TOAST_LIFE,
      });
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: MENTORSHIP_TASK_CREATE_PARTIAL_SUMMARY,
      detail: `${this.missedMentees(failed, total, menteeNames)} did not get the task. Check their row, and create it there if it is still missing, so the others do not get it twice.`,
      life: MENTORSHIP_TASK_CREATE_TOAST_LIFE,
    });
  }

  /** The missed mentees by name, or a count when a name is not known. */
  private missedMentees(failed: string[], total: number, menteeNames: Readonly<Record<string, string>>): string {
    const names = failed.map((applicationId) => menteeNames[applicationId]).filter((name): name is string => !!name);
    return names.length === failed.length ? names.join(', ') : `${failed.length} of ${total} mentees`;
  }

  private showCreateError(err: HttpErrorResponse): void {
    let detail = MENTORSHIP_TASK_CREATE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_TASK_CREATE_ERROR_FALLBACK;
    if (this.isImpersonationRefusal(err)) {
      detail = serverAuthoredMessage(err, MENTORSHIP_TASK_CREATE_ERROR_FALLBACK);
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_TASK_CREATE_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_TASK_CREATE_TOAST_LIFE,
    });
  }

  private isImpersonationRefusal(err: HttpErrorResponse): boolean {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    return err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE;
  }
}
