// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_FALLBACK,
  MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_MESSAGES,
  MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_TASK_UPDATE_SUCCESS_SUMMARY,
  MENTORSHIP_ADMIN_TASK_UPDATE_TOAST_LIFE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminTaskUpdate, MentorshipApplicantTask } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { catchError, defer, finalize, map, Observable, of } from 'rxjs';

/**
 * Edits one task, or sets just its status, for an admin and toasts a failure.
 * `update` emits the task as the row reads it once it is saved, and `null` when it was not, after showing why, so the
 * caller keeps the row as it was. A success toasts only when `toastOnSuccess` is set: a status change is visible in the
 * row, while the edit dialog closes on save and wants the confirmation. A 400 (a submitted task that requires a file
 * with none uploaded), a 403 and a 404 get their own copy; the impersonation guard's 403 shows the server's message.
 *
 * Which tasks are being saved lives here rather than in the panel: collapsing a row destroys the panel, so a save can
 * outlive it, and a rebuilt panel must not send a second change for the same task meanwhile.
 */
@Injectable({ providedIn: 'root' })
export class AdminTaskUpdateService {
  private readonly adminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);

  private readonly updatingIds = new Set<string>();

  /** Whether a change to the task is being saved; the panel sends no other change for it meanwhile. */
  public isUpdating(taskId: string): boolean {
    return this.updatingIds.has(taskId);
  }

  public update(taskId: string, body: MentorshipAdminTaskUpdate, toastOnSuccess: boolean): Observable<MentorshipApplicantTask | null> {
    return defer(() => {
      this.updatingIds.add(taskId);
      return this.adminService.updateTask(taskId, body);
    }).pipe(
      map((task) => {
        if (toastOnSuccess) {
          this.messageService.add({
            severity: 'success',
            summary: MENTORSHIP_ADMIN_TASK_UPDATE_SUCCESS_SUMMARY,
            life: MENTORSHIP_ADMIN_TASK_UPDATE_TOAST_LIFE,
          });
        }
        return task;
      }),
      catchError((err: HttpErrorResponse) => {
        this.showUpdateError(err);
        return of(null);
      }),
      finalize(() => this.updatingIds.delete(taskId))
    );
  }

  private showUpdateError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_FALLBACK;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_FALLBACK);
    }

    this.messageService.add({ severity: 'error', summary: MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_SUMMARY, detail, life: MENTORSHIP_ADMIN_TASK_UPDATE_TOAST_LIFE });
  }
}
