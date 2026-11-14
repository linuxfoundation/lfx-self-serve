// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_NOTE_CLEAR_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_NOTE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_NOTE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Saves a mentor's reviewer note on an application and toasts the outcome, for the mentor program detail.
 * The caller handles no error: `save` emits `true` once the note is saved and `false` when it was not,
 * after showing why. A 403 (no longer a mentor of the program) and a 404 (the application is gone) get
 * their own copy; the impersonation guard's 403 shows the server's message.
 */
@Injectable({ providedIn: 'root' })
export class MentorNoteSaveService {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);

  /** Saves the note, already trimmed; an empty note clears it. */
  public save(applicationId: string, note: string): Observable<boolean> {
    return this.mentorService.updateApplicationNote(applicationId, note).pipe(
      map(() => {
        this.messageService.add({
          severity: 'success',
          summary: note ? MENTORSHIP_MENTOR_NOTE_SAVE_SUCCESS_SUMMARY : MENTORSHIP_MENTOR_NOTE_CLEAR_SUCCESS_SUMMARY,
          life: MENTORSHIP_MENTOR_NOTE_TOAST_LIFE,
        });
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorNoteSaveService] save failed', err);
        this.showSaveError(err);
        return of(false);
      })
    );
  }

  private showSaveError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_FALLBACK;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_FALLBACK);
    }

    this.messageService.add({ severity: 'error', summary: MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_SUMMARY, detail, life: MENTORSHIP_MENTOR_NOTE_TOAST_LIFE });
  }
}
