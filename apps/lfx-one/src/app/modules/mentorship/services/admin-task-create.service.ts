// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK,
  MENTORSHIP_ADMIN_TASK_CREATE_ERROR_MESSAGES,
  MENTORSHIP_ADMIN_TASK_CREATE_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_TASK_CREATE_SUCCESS_SUMMARY,
  MENTORSHIP_ADMIN_TASK_CREATE_TOAST_LIFE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskCreateRequest } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { catchError, defer, finalize, map, Observable, of } from 'rxjs';

/**
 * Gives one accepted mentee a task for an admin and toasts the outcome, for the admin program detail.
 * The caller handles no error: `create` emits `true` once the task is created and `false` when it was not, after
 * showing why. Upstream's create is not idempotent, and a failure without a status of its own (a timeout, a 5xx) may
 * still have created the task, so that copy sends the admin to the mentee's row rather than to a retry. A 400, a 403
 * and a 404 get their own copy; the impersonation guard's 403 shows the server's message.
 *
 * Which applications are getting a task lives here rather than in the tab: switching tabs destroys the Current
 * Mentees tab, so a create can outlive the tab that started it, and a rebuilt tab must not send the same task again.
 */
@Injectable({ providedIn: 'root' })
export class AdminTaskCreateService {
  private readonly adminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);

  private readonly creatingIds = new Set<string>();

  /** Whether a task is being created for the application; the tab sends no other create for it meanwhile. */
  public isCreating(applicationId: string): boolean {
    return this.creatingIds.has(applicationId);
  }

  public create(request: MentorshipMentorTaskCreateRequest): Observable<boolean> {
    return defer(() => {
      request.applicationIds.forEach((applicationId) => this.creatingIds.add(applicationId));
      return this.adminService.createTasks(request);
    }).pipe(
      map(({ failed }) => {
        if (failed.length > 0) {
          this.showCreateError(undefined);
          return false;
        }
        this.messageService.add({ severity: 'success', summary: MENTORSHIP_ADMIN_TASK_CREATE_SUCCESS_SUMMARY, life: MENTORSHIP_ADMIN_TASK_CREATE_TOAST_LIFE });
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        this.showCreateError(err);
        return of(false);
      }),
      finalize(() => request.applicationIds.forEach((applicationId) => this.creatingIds.delete(applicationId)))
    );
  }

  private showCreateError(err: HttpErrorResponse | undefined): void {
    const code = (err?.error as { code?: string } | null | undefined)?.code;
    let detail = (err && MENTORSHIP_ADMIN_TASK_CREATE_ERROR_MESSAGES[err.status]) ?? MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK;
    if (err?.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK);
    }

    this.messageService.add({ severity: 'error', summary: MENTORSHIP_ADMIN_TASK_CREATE_ERROR_SUMMARY, detail, life: MENTORSHIP_ADMIN_TASK_CREATE_TOAST_LIFE });
  }
}
