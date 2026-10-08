// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_TASK_UPDATE_ERROR_FALLBACK,
  MENTORSHIP_TASK_UPDATE_ERROR_MESSAGES,
  MENTORSHIP_TASK_UPDATE_ERROR_SUMMARY,
  MENTORSHIP_TASK_UPDATE_SUCCESS_SUMMARY,
  MENTORSHIP_TASK_UPDATE_TOAST_LIFE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipApplicantTask, MentorshipTaskUpdate } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { catchError, defer, finalize, map, Observable, of } from 'rxjs';

/**
 * Edits one task, or sets just its status, for an admin or a mentor and toasts a failure.
 * `update` emits the task as the row reads it once it is saved, and `null` when it was not, after showing why, so the
 * caller keeps the row as it was. A success toasts only when `toastOnSuccess` is set: a status change is visible in the
 * row, while the edit dialog closes on save and wants the confirmation. A 400 from a change that can trip the file guard
 * (a submitted task that requires a file with none uploaded), a 403 and a 404 get their own copy; any other 400 gets the
 * generic one, and the impersonation guard's 403 shows the server's message.
 *
 * Which tasks are being saved lives here rather than in the panel: collapsing a row destroys the panel, so a save can
 * outlive it, and a rebuilt panel must not send a second change for the same task meanwhile.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipTaskUpdateService {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);

  /** A signal, so a panel rebuilt mid-save re-enables Edit when the save settles. */
  private readonly updatingIds = signal<ReadonlySet<string>>(new Set());

  /** Whether a change to the task is being saved; the panel sends no other change for it meanwhile. */
  public isUpdating(taskId: string): boolean {
    return this.updatingIds().has(taskId);
  }

  public update(taskId: string, body: MentorshipTaskUpdate, toastOnSuccess: boolean): Observable<MentorshipApplicantTask | null> {
    return defer(() => {
      this.setUpdating(taskId, true);
      return this.mentorshipService.updateTask(taskId, body);
    }).pipe(
      map((task) => {
        if (toastOnSuccess) {
          this.messageService.add({
            severity: 'success',
            summary: MENTORSHIP_TASK_UPDATE_SUCCESS_SUMMARY,
            life: MENTORSHIP_TASK_UPDATE_TOAST_LIFE,
          });
        }
        return task;
      }),
      catchError((err: HttpErrorResponse) => {
        this.showUpdateError(err, body);
        return of(null);
      }),
      finalize(() => this.setUpdating(taskId, false))
    );
  }

  private setUpdating(taskId: string, updating: boolean): void {
    this.updatingIds.update((current) => {
      const next = new Set(current);
      if (updating) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  /** A 400 gets the file copy only when the change could trip upstream's file guard: a move to Submitted or a new file requirement. */
  private showUpdateError(err: HttpErrorResponse, body: MentorshipTaskUpdate): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    const fileGuard = body.status === 'submitted' || body.requiresFileSubmission !== undefined;
    let detail = MENTORSHIP_TASK_UPDATE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_TASK_UPDATE_ERROR_FALLBACK;
    if (err.status === 400 && !fileGuard) {
      detail = MENTORSHIP_TASK_UPDATE_ERROR_FALLBACK;
    } else if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_TASK_UPDATE_ERROR_FALLBACK);
    }

    this.messageService.add({ severity: 'error', summary: MENTORSHIP_TASK_UPDATE_ERROR_SUMMARY, detail, life: MENTORSHIP_TASK_UPDATE_TOAST_LIFE });
  }
}
