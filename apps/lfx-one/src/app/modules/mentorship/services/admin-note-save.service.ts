// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_ADMIN_NOTE_CLEAR_SUCCESS_SUMMARY,
  MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_NOTE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_ADMIN_NOTE_TOAST_LIFE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Saves an admin's reviewer note on an application and toasts the outcome, for the admin program detail.
 * The caller handles no error: `save` emits `true` once the note is saved and `false` when it was not,
 * after showing why. A 403 (no longer an admin of the program) and a 404 (the application is gone) get
 * their own copy; the impersonation guard's 403 shows the server's message.
 */
@Injectable({ providedIn: 'root' })
export class AdminNoteSaveService {
  private readonly adminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);

  /** Saves the note, already trimmed; an empty note clears it. */
  public save(applicationId: string, note: string): Observable<boolean> {
    return this.adminService.updateApplicationNote(applicationId, note).pipe(
      map(() => {
        this.messageService.add({
          severity: 'success',
          summary: note ? MENTORSHIP_ADMIN_NOTE_SAVE_SUCCESS_SUMMARY : MENTORSHIP_ADMIN_NOTE_CLEAR_SUCCESS_SUMMARY,
          life: MENTORSHIP_ADMIN_NOTE_TOAST_LIFE,
        });
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        this.showSaveError(err);
        return of(false);
      })
    );
  }

  private showSaveError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK);
    }

    this.messageService.add({ severity: 'error', summary: MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_SUMMARY, detail, life: MENTORSHIP_ADMIN_NOTE_TOAST_LIFE });
  }
}
