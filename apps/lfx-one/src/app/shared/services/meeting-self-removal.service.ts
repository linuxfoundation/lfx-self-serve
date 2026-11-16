// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MeetingRegistrationRemovalResult, MeetingRemovalSource } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage, isBffValidationError } from '@shared/utils/http-error.utils';
import { defer, filter, Observable, tap } from 'rxjs';

/**
 * Removes the signed-in user's own registration from a meeting, with no UI of its own.
 * @description Clears the RSVPs confirmed for the removed registrations, then marks the meeting removed when nothing is
 * left, or defers a feed refresh when some registrations survived. Callers own confirmation, loading state and feedback:
 * the stream emits the result (check `remaining_registrant_ids` for a partial removal), completes without a value when
 * the viewer changed while the request was in flight, and errors with the HTTP error; see {@link describeFailure}.
 */
@Injectable({ providedIn: 'root' })
export class MeetingSelfRemovalService {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  /** Work starts on subscribe, which is when the viewer is captured. */
  public remove$(meetingId: string, source: MeetingRemovalSource): Observable<MeetingRegistrationRemovalResult> {
    return defer(() => {
      const subject = this.subject();
      return this.meetingService.removeMyMeetingRegistration(meetingId, source).pipe(
        tap((result) => this.userService.clearConfirmedMeetingRsvps(meetingId, subject, result)),
        filter(() => this.subject() === subject),
        tap((result) => {
          if (result.remaining_registrant_ids.length > 0) {
            this.meetingService.rememberRemovedRegistrants(meetingId, result.removed_registrant_ids);
            this.userService.refreshUserMeetings(false);
          } else {
            this.meetingService.markRegistrationRemoved(meetingId, result.removed_registrant_ids);
          }
        })
      );
    });
  }

  /** User-facing copy for a failed removal: the BFF's own validation message, or generic copy. */
  public describeFailure(error: unknown): string {
    const fallback = 'Unable to remove you from this meeting. Please try again.';
    return isBffValidationError(error) ? extractErrorMessage(error, fallback) : fallback;
  }

  private subject(): string {
    const user = this.userService.user();
    return user?.sub || this.userService.viewerUsername() || user?.email || '';
  }
}
