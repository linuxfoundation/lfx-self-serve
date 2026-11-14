// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_REQUEST_SUCCESS_DETAIL,
  MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
  MENTORSHIP_MENTOR_REQUESTS_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorOpenProgram } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { catchError, concatMap, from, map, Observable, of, reduce } from 'rxjs';

/**
 * Sends mentor program requests and toasts the outcome, for the Become a Mentor form and the mentor
 * profile drawer. Neither caller handles an error: `request` emits `true` when the request was sent
 * and `false` when it was not, after showing why, and `requestMany` emits the programs that were sent.
 *
 * A failure toast names the program, so a batch with several failures can be told apart. The 404 (the
 * program is gone) and the 409 (a request, invitation or membership for it already) get their own copy
 * and re-read the requests, since both mean the page was out of date. A 404 also marks the program
 * unavailable, so the picker disables it: re-reading the requests cannot drop it from a page of
 * programs already read. The impersonation guard's 403 shows the server's message.
 *
 * Callers must not cancel the returned observable when their view goes away: the toasts are shown and
 * the cached requests dropped only when each request completes.
 */
@Injectable({ providedIn: 'root' })
export class MentorProgramRequestService {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);

  /** Sends one request and toasts its outcome. */
  public request(program: MentorshipMentorOpenProgram): Observable<boolean> {
    return this.send(program).pipe(
      map((sent) => {
        if (sent) {
          this.toastSuccess(MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY, MENTORSHIP_MENTOR_REQUEST_SUCCESS_DETAIL);
        }
        return sent;
      })
    );
  }

  /**
   * Sends the requests one at a time, in order, so each failure toast follows the request it names.
   * Each failure toasts on its own; the ones sent share one success toast listing them. Emits the
   * sent programs once, after the last request settles.
   */
  public requestMany(programs: MentorshipMentorOpenProgram[]): Observable<MentorshipMentorOpenProgram[]> {
    return from(programs).pipe(
      concatMap((program) => this.send(program).pipe(map((sent) => (sent ? [program] : [])))),
      reduce((sent: MentorshipMentorOpenProgram[], batch) => [...sent, ...batch], []),
      map((sent) => {
        if (sent.length) {
          this.toastSuccess(MENTORSHIP_MENTOR_REQUESTS_SUCCESS_SUMMARY, sent.map((program) => program.name).join(', '));
        }
        return sent;
      })
    );
  }

  private send(program: MentorshipMentorOpenProgram): Observable<boolean> {
    return this.mentorService.requestToMentor(program.id).pipe(
      map(() => true),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorProgramRequestService] request failed', err);
        this.showRequestError(program, err);
        return of(false);
      })
    );
  }

  private showRequestError(program: MentorshipMentorOpenProgram, err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    const staleMessage = MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES[err.status];
    let detail = MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK;

    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK);
    } else if (staleMessage) {
      detail = staleMessage;
      if (err.status === 404) this.mentorService.markProgramUnavailable(program.id);
      this.mentorService.clearMentorCaches();
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY,
      detail: `${program.name}: ${detail}`,
      life: MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE,
    });
  }

  private toastSuccess(summary: string, detail: string): void {
    this.messageService.add({ severity: 'success', summary, detail, life: MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE });
  }
}
