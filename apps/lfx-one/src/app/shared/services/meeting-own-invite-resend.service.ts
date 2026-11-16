// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { MeetingService } from '@services/meeting.service';
import { extractErrorMessage, isBffValidationError } from '@shared/utils/http-error.utils';
import { defer, EMPTY, finalize, Observable, take } from 'rxjs';

/**
 * Resends the meeting invitation to the signed-in user's own registration, with no UI of its own.
 * @description The server resolves which registrant is the caller's, and upstream verifies it is theirs. In-flight
 * tracking lives here so every surface shares it; callers own the feedback and pair errors with
 * {@link describeOwnResendFailure}.
 */
@Injectable({ providedIn: 'root' })
export class MeetingOwnInviteResendService {
  private readonly meetingService = inject(MeetingService);

  private readonly resendingOwnMeetingUids = signal<ReadonlySet<string>>(new Set());

  /** Whether the signed-in user's own resend is in flight for the meeting; reads a signal, so templates stay reactive. */
  public isResendingOwn(meetingUid: string | undefined): boolean {
    return !!meetingUid && this.resendingOwnMeetingUids().has(meetingUid);
  }

  /**
   * Resends for the occurrence being viewed when the surface has one (registrations can be scoped to a single
   * occurrence). No confirmation: it only emails the caller. Tracks the in-flight send from subscribe until it settles
   * and completes without a value when the meeting id is empty or a send for it is already in flight.
   */
  public resendOwn$(meetingUid: string, occurrenceId?: string | null): Observable<{ message: string }> {
    return defer(() => {
      if (!meetingUid || this.isResendingOwn(meetingUid)) {
        return EMPTY;
      }

      this.setResendingOwn(meetingUid, true);
      return this.meetingService.resendMyMeetingInvitation(meetingUid, occurrenceId).pipe(
        take(1),
        finalize(() => this.setResendingOwn(meetingUid, false))
      );
    });
  }

  /**
   * User-facing copy for a failed own-resend.
   * A 429 is the per-user limit: retrying right away cannot work, so say to wait, in fixed words rather than the
   * server's. A server-written validation reason is shown as is. Anything else gets generic copy, since an upstream
   * status line is not something to put on screen.
   */
  public describeOwnResendFailure(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 429) {
      return 'You have resent your invitation too many times. Please try again later.';
    }

    const fallback = 'Unable to resend the invitation. Please try again.';
    return isBffValidationError(error) ? extractErrorMessage(error, fallback) : fallback;
  }

  private setResendingOwn(meetingUid: string, resending: boolean): void {
    this.resendingOwnMeetingUids.update((current) => {
      const next = new Set(current);
      if (resending) {
        next.add(meetingUid);
      } else {
        next.delete(meetingUid);
      }
      return next;
    });
  }
}
