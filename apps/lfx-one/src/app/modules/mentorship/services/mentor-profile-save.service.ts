// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { isBffValidationError, serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_PROFILE_SAVE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProfileUpdateRequest, MentorshipMentorProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { EMPTY, finalize, Observable, tap } from 'rxjs';

/**
 * Saves the signed-in mentor's profile edits from the mentor profile edit drawer: one in-flight flag,
 * one success toast and one error-to-copy mapping. The drawer keeps itself open on a failure and shows
 * `errorMessage(err)` inline; it does not toast the failure.
 *
 * A save is not retried and is not queued: a second `save` while one is in flight completes empty
 * without a request.
 */
@Injectable({ providedIn: 'root' })
export class MentorProfileSaveService {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);

  private readonly savingSignal = signal(false);

  /** True while a mentor profile save is in flight. */
  public readonly saving = this.savingSignal.asReadonly();

  /** PATCHes the changed fields. Emits the saved profile once and toasts the success; always clears `saving`. */
  public save(request: MentorshipMentorProfileUpdateRequest): Observable<MentorshipMentorProfileUpdateResponse> {
    if (this.savingSignal()) {
      return EMPTY;
    }

    this.savingSignal.set(true);
    return this.mentorService.updateMentorProfile(request).pipe(
      tap(() =>
        this.messageService.add({
          severity: 'success',
          summary: MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY,
          life: MENTORSHIP_MENTOR_PROFILE_SAVE_TOAST_LIFE,
        })
      ),
      finalize(() => this.savingSignal.set(false))
    );
  }

  /**
   * The copy for a failed save. Only two messages are the server's own: the BFF's field reason on a
   * validation 400 and the impersonation guard's 403. Every other status uses fixed copy, because the
   * body of a relayed upstream failure is a composed wire string that must not reach the screen.
   */
  public errorMessage(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK;
    }

    if (isBffValidationError(err)) {
      return serverAuthoredMessage(err, MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES[400]);
    }

    const code = (err.error as { code?: string } | null | undefined)?.code;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      return serverAuthoredMessage(err, MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK);
    }

    return MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK;
  }
}
