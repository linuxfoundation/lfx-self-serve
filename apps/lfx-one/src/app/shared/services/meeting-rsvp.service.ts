// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, Signal, signal } from '@angular/core';
import { RSVP_RESPONSES } from '@lfx-one/shared/constants';
import { CreateMeetingRsvpRequest, Meeting, MeetingRsvp, MeetingRsvpSubmitError, RsvpResponse, RsvpScope } from '@lfx-one/shared/interfaces';
import { occurrenceIdToSeconds } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { catchError, defer, filter, finalize, map, Observable, tap, throwError } from 'rxjs';

/**
 * Submits the signed-in user's RSVP and records the confirmed answer, with no UI of its own.
 * @description Callers own loading state and feedback: the stream emits the saved RSVP, completes without a value
 * when the registration was removed while the write was in flight, and errors with a {@link MeetingRsvpSubmitError}.
 */
@Injectable({ providedIn: 'root' })
export class MeetingRsvpService {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly lensService = inject(LensService);
  private readonly submittingIds = signal<ReadonlySet<string>>(new Set());

  /** Meetings with an RSVP write in flight; a second write to the same series could be confirmed out of order. */
  public readonly submittingMeetingIds: Signal<ReadonlySet<string>> = this.submittingIds.asReadonly();

  /**
   * RSVPs to `meeting`. `single` and `this_and_following` need `occurrenceId`; `all` ignores it.
   * Work starts on subscribe, which is when the subject and registration generation are captured.
   */
  public submit$(meeting: Meeting, occurrenceId: string | undefined, response: RsvpResponse, scope: RsvpScope): Observable<MeetingRsvp> {
    return defer(() => {
      const currentUser = this.userService.user();
      const subject = currentUser?.sub || this.userService.viewerUsername() || currentUser?.email || '';
      const generation = this.userService.meetingRegistrationGeneration(meeting.id, subject);
      const scopedOccurrenceId = scope === 'all' ? undefined : (occurrenceIdToSeconds(occurrenceId) ?? undefined);
      if (scope !== 'all' && !scopedOccurrenceId) {
        return throwError((): MeetingRsvpSubmitError => ({ message: 'This meeting date could not be resolved. Please reload the meeting and try again.' }));
      }

      const request: CreateMeetingRsvpRequest = { response, scope, email: currentUser?.email };
      if (scopedOccurrenceId) {
        request.occurrence_id = scopedOccurrenceId;
      }

      this.submittingIds.update((ids) => new Set(ids).add(meeting.id));
      return this.meetingService.createMeetingRsvp(meeting.id, request).pipe(
        map((rsvp: MeetingRsvp) => {
          const acknowledged = {
            ...rsvp,
            // The acknowledgement can omit or mangle the answer; the submitted response is what the user chose.
            response_type: RSVP_RESPONSES.includes(rsvp.response_type) ? rsvp.response_type : response,
            occurrence_id: rsvp.occurrence_id || scopedOccurrenceId,
            // Creation time may predate a changed answer; use confirmation time without a modification timestamp.
            updated_at: rsvp.updated_at || rsvp.modified_at || new Date().toISOString(),
          };
          // Use the retained copy so every view orders this answer after the confirmations it follows.
          return this.userService.recordConfirmedMeetingRsvp(acknowledged, subject, generation) ?? acknowledged;
        }),
        filter((savedRsvp) => this.userService.isMeetingRsvpCurrent(savedRsvp, meeting, subject)),
        // Defer personal refetches outside Me without keeping a stale replay on return.
        tap(() => this.userService.refreshUserMeetings(this.lensService.activeLens() === 'me')),
        catchError((error: HttpErrorResponse) => throwError((): MeetingRsvpSubmitError => this.describeFailure(error))),
        finalize(() => this.submittingIds.update((ids) => new Set([...ids].filter((id) => id !== meeting.id))))
      );
    });
  }

  private describeFailure(error: HttpErrorResponse): MeetingRsvpSubmitError {
    if (error?.status === 404) {
      return { message: 'Only invited users are allowed to RSVP to this meeting.', status: 404 };
    }
    const reason = error?.error?.error;
    return { message: reason || 'Failed to update RSVP. Please try again.', status: error?.status };
  }
}
