// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingHomeAttendance, MeetingRegistrant } from '@lfx-one/shared/interfaces';
import {
  countMeetingRsvpSummary,
  getMeetingRsvpAttendance,
  isMeetingGuestViewer,
  isMeetingInviteResponsesEnabled,
  selectApplicableRsvp,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { MeetingsHomeEditService } from '../../../../services/meetings-home-edit.service';
import { MeetingAttendeeGridComponent } from '../../../meeting-attendee-grid/meeting-attendee-grid.component';
import { MeetingHomeAttendanceComponent } from '../../../meeting-home-attendance/meeting-home-attendance.component';
import { MeetingDetailsContext } from '../../meeting-details.context';
import { MeetingDetailsSource } from '../../meeting-details.source';

/** The organizer's RSVP counts for the date the meeting details drawer shows, and Invite people. */
@Component({
  selector: 'lfx-meeting-details-rsvp',
  imports: [MeetingAttendeeGridComponent, MeetingHomeAttendanceComponent, UiButtonComponent, UiSkeletonComponent],
  templateUrl: './meeting-details-rsvp.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class MeetingDetailsRsvpComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly editService = inject(MeetingsHomeEditService);
  private readonly hostRef = inject(MeetingDetailsSource).hostRef;
  protected readonly context = inject(MeetingDetailsContext);

  protected readonly responsesOn: Signal<boolean> = computed(() => isMeetingInviteResponsesEnabled(this.context.meeting()));
  /** The shown date's registrants; undefined while loading, null when the lookup failed. */
  protected readonly roster: Signal<MeetingRegistrant[] | null | undefined> = this.initRoster();
  /** The roster with this session's own answers and removals applied. */
  protected readonly rows: Signal<MeetingRegistrant[]> = this.initRows();
  /** "X of Y attending" for the shown date. */
  protected readonly rsvpAttendance: Signal<MeetingHomeAttendance | null> = computed(() =>
    this.roster() && this.responsesOn() ? getMeetingRsvpAttendance(countMeetingRsvpSummary(this.rows())) : null
  );

  protected invitePeople(): void {
    // As Edit Meeting at its Guests step: the drawer stays open under the scope question and closes once the editor opens.
    this.editService.edit(this.context.shownRow(), 'guests', this.hostRef);
  }

  private initRoster(): Signal<MeetingRegistrant[] | null | undefined> {
    const key = computed(() => {
      const meeting = this.context.meeting();
      const occurrenceId = this.context.shownRow().occurrenceId ?? undefined;
      const responsesOn = this.responsesOn();
      // A series row without a date counts only answers for all dates, as the meeting page does.
      return { id: meeting.id, occurrenceId, responsesOn, allDatesOnly: responsesOn && !!meeting.recurrence && !occurrenceId };
    });
    const roster$ = toObservable(key).pipe(
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      switchMap((params) =>
        this.meetingService.getMeetingRegistrants(params.id, params.responsesOn, params.occurrenceId, true, undefined, false, params.allDatesOnly).pipe(
          map((registrants): MeetingRegistrant[] | null => registrants),
          catchError((error: unknown) => {
            console.error('Failed to load the meeting registrants:', error);
            return of(null);
          }),
          startWith(undefined)
        )
      )
    );
    return toSignal(roster$, { initialValue: undefined });
  }

  private initRows(): Signal<MeetingRegistrant[]> {
    return computed(() => {
      const roster = this.withoutRemoved(this.roster() ?? []);
      const meeting = this.context.meeting();
      const occurrenceId = this.context.shownRow().occurrenceId;
      const allDatesOnly = !!meeting.recurrence && !occurrenceId;
      // Answers the organizer saved here can be newer than the roster.
      const confirmed = this.userService.confirmedMeetingRsvps(meeting.id).filter((rsvp) => !allDatesOnly || rsvp.scope === 'all');
      if (confirmed.length === 0) return roster;
      return roster.map((registrant) => {
        const own = confirmed.filter((rsvp) => rsvp.registrant_id === registrant.uid);
        if (own.length === 0) return registrant;
        return { ...registrant, rsvp: selectApplicableRsvp(occurrenceId, registrant.rsvp ? [...own, registrant.rsvp] : own) };
      });
    });
  }

  /** Drops guests removed here and, after Remove Myself, the viewer, as the roster can lag. */
  private withoutRemoved(roster: MeetingRegistrant[]): MeetingRegistrant[] {
    const removed = this.context.removedRegistrantUids();
    const removedSelf = this.meetingService.removedRegistrationMeetingIds().has(this.context.meeting().id);
    if (!removed.size && !removedSelf) return roster;
    const viewer = { username: this.userService.viewerUsername(), email: this.userService.user()?.email ?? null };
    return roster.filter((registrant) => !removed.has(registrant.uid) && !(removedSelf && isMeetingGuestViewer(registrant, viewer)));
  }
}
