// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MeetingRegistrantWithState, MeetingSelfGuest, MeetingSelfInviteResult } from '@lfx-one/shared/interfaces';
import { isMeetingSelfGuestListed, toMeetingSelfGuestRegistrant } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage, isBffValidationError } from '@shared/utils/http-error.utils';
import { defer, filter, map, Observable, of, switchMap, take, tap, throwError } from 'rxjs';

/**
 * Adds the signed-in user to a meeting as a regular guest, with no UI of its own.
 * @description Resolves the user as a guest from their profile, then checks the meeting's complete roster before
 * posting, so a stale feed that reads "not invited" cannot invite them twice. The invite covers every occurrence, the
 * same default as the Guests drawer's "Add myself". Callers own loading state and feedback: the stream emits the
 * result, completes without a value when the viewer changed while the request was in flight, and errors when the
 * roster could not be loaded or the invite was not saved; see {@link describeFailure}.
 */
@Injectable({ providedIn: 'root' })
export class MeetingSelfInviteService {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  /** Work starts on subscribe, which is when the viewer is captured. */
  public add$(meetingId: string): Observable<MeetingSelfInviteResult> {
    return defer(() => {
      const subject = this.subject();
      return this.userService.getMeetingSelfGuest().pipe(
        take(1),
        switchMap((self) =>
          self?.first_name && self.last_name ? this.addIfUnlisted(meetingId, self) : of<MeetingSelfInviteResult>({ status: 'unavailable' })
        ),
        filter(() => this.subject() === subject),
        tap((result) => {
          if (result.status === 'added') this.meetingService.clearRemovedRegistration(meetingId);
        })
      );
    });
  }

  /** User-facing copy for a failed add: the BFF's validation message, the saved batch's own failure, or generic copy. */
  public describeFailure(error: unknown): string {
    const fallback = 'Unable to add you to this meeting. Please try again.';
    return isBffValidationError(error) || error instanceof Error ? extractErrorMessage(error, fallback) : fallback;
  }

  /**
   * A failed roster fetch errors the stream, so nothing is posted when the list may be incomplete.
   * @description While the viewer's own removal stands, their rows are the deleted registrations the query index has
   * not dropped yet, as in the Guests drawer, so they do not count as listed; a row under a new uid is a re-invite.
   */
  private addIfUnlisted(meetingId: string, self: MeetingSelfGuest): Observable<MeetingSelfInviteResult> {
    return this.meetingService.getMeetingRegistrants(meetingId, false, undefined, true).pipe(
      take(1),
      switchMap((roster) => {
        const selfUids = roster.filter((row) => isMeetingSelfGuestListed(self, [row])).map((row) => row.uid);
        this.meetingService.clearRemovalIfReinvited(meetingId, selfUids);
        const listed = selfUids.length > 0 && !this.meetingService.removedRegistrationMeetingIds().has(meetingId);
        return listed ? of<MeetingSelfInviteResult>({ status: 'already-listed' }) : this.invite(meetingId, self);
      })
    );
  }

  private invite(meetingId: string, self: MeetingSelfGuest): Observable<MeetingSelfInviteResult> {
    // Same body as the Guests drawer's "Add myself", for every occurrence.
    const guest = toMeetingSelfGuestRegistrant(self) as MeetingRegistrantWithState;

    return this.meetingService.addMeetingRegistrants(meetingId, [this.meetingService.stripMetadata(meetingId, guest)]).pipe(
      // A rejected row carries its own reason; an empty one falls back to the generic copy in describeFailure.
      switchMap((response) =>
        response.summary.successful > 0 ? of(response.successes[0]) : throwError(() => new Error(response.failures[0]?.error?.message ?? ''))
      ),
      map((registrant): MeetingSelfInviteResult => ({ status: 'added', ...(registrant ? { registrant } : {}) }))
    );
  }

  private subject(): string {
    const user = this.userService.user();
    return user?.sub || this.userService.viewerUsername() || user?.email || '';
  }
}
