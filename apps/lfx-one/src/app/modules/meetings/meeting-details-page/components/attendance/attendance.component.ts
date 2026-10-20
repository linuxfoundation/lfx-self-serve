// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import { getPastMeetingResourceId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { catchError, map, of, switchMap } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * An ended meeting's attendance figures on the V2 page: attended, absent and the attendance rate,
 * as V1 shows them (`meeting-join.component.ts` `participantCount` … `hasAttendanceData`, and the
 * `attendance-summary` row of its template). No named roster, as V1 has none.
 * @description Same source and gating as V1: a signed-in viewer with the past endpoint's
 * `full_access` reads `/api/past-meetings/:uid/participants` by the occurrence's composite id. When
 * that returns no rows (the BFF hides them from a viewer who is not on them, or the read fails), the
 * counts the past endpoint put on the meeting stand in. Nothing renders until there is at least one
 * participant.
 */
@Component({
  selector: 'lfx-meeting-attendance',
  templateUrl: './attendance.component.html',
})
export class MeetingAttendanceComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  /** The participants of the meeting the page holds, empty until read, without access, or on a failed read. */
  private readonly participants: Signal<PastMeetingParticipant[]> = this.initParticipants();

  /** Participants, else the past endpoint's count (V1 `participantCount`). */
  protected readonly participantCount = computed(() => this.participants().length || (this.state.meeting()?.participant_count ?? 0));
  /** V1 `attendedCount`. */
  protected readonly attendedCount = computed(() => {
    const participants = this.participants();
    return participants.length ? participants.filter((p) => p.is_attended).length : (this.state.meeting()?.attended_count ?? 0);
  });
  /** V1 `absentCount`. */
  protected readonly absentCount = computed(() => this.participantCount() - this.attendedCount());
  /** V1 `attendancePercentage`: rounded, 0 with no participants. */
  protected readonly attendancePercentage = computed(() => {
    const total = this.participantCount();
    return total > 0 ? Math.round((this.attendedCount() / total) * 100) : 0;
  });
  /** V1 `hasAttendanceData`: an ended meeting with at least one participant, for the meeting the route names. */
  protected readonly hasAttendanceData = computed(() => this.state.matchesRoute() && this.state.timeState() === 'ended' && this.participantCount() > 0);

  private initParticipants(): Signal<PastMeetingParticipant[]> {
    // V1's gate (`initializePastMeetingParticipants`): signed in, with full access, by the past resource id.
    const request = computed(() => {
      const meeting = this.state.meeting();
      if (!meeting || !this.state.matchesRoute() || !this.userService.authenticated() || !this.state.pastMeetingFullAccess()) {
        return null;
      }
      return getPastMeetingResourceId(meeting);
    });
    const read = toSignal(
      toObservable(request).pipe(
        switchMap((id) => {
          if (!id) {
            return of({ id, participants: [] as PastMeetingParticipant[] });
          }
          return this.meetingService.getPastMeetingParticipants(id).pipe(
            catchError((error: unknown) => {
              // As V1, the past endpoint's counts stand in; logged so the failure is not silent.
              console.error('Failed to load past meeting participants', id, error);
              return of([] as PastMeetingParticipant[]);
            }),
            map((participants) => ({ id, participants }))
          );
        })
      ),
      { initialValue: { id: null as string | null, participants: [] as PastMeetingParticipant[] } }
    );
    // A read still in flight for the previous meeting never counts for the one now shown.
    return computed(() => {
      const { id, participants } = read();
      return id !== null && id === request() ? participants : [];
    });
  }
}
