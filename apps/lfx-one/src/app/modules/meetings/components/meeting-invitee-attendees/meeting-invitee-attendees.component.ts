// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingAttendeePreviewComponent } from '@app/modules/meetings/components/meeting-attendee-preview/meeting-attendee-preview.component';
import { MeetingRegistrantsDisplayComponent } from '@app/modules/meetings/components/meeting-registrants-display/meeting-registrants-display.component';
import { Meeting, MeetingAttendeePreviewPerson, MeetingOccurrence, MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { buildAttendeePreviewFromRegistrants, isMeetingInviteResponsesEnabled, resolveRsvpOccurrenceId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

/**
 * Attendee preview for an invitee's meeting card, plus the read-only guest drawer behind "View all".
 * @description Uses `GET /api/meetings/:uid/my-meeting-registrants`, which only answers registrants of
 * meetings with `show_meeting_attendees` on — the parent renders this only in that case, and inside
 * `@defer (on viewport)` so the roster is fetched per visible card rather than for the whole list.
 * A refused or failed fetch renders nothing.
 */
@Component({
  selector: 'lfx-meeting-invitee-attendees',
  imports: [MeetingAttendeePreviewComponent, MeetingRegistrantsDisplayComponent, DrawerModule],
  templateUrl: './meeting-invitee-attendees.component.html',
})
export class MeetingInviteeAttendeesComponent {
  private readonly meetingService = inject(MeetingService);

  public readonly meeting = input.required<Meeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);

  protected readonly drawerVisible = signal(false);
  protected readonly loading = signal(true);
  protected readonly registrants = this.initRegistrants();
  protected readonly previewPeople = computed<MeetingAttendeePreviewPerson[]>(() =>
    buildAttendeePreviewFromRegistrants(this.registrants(), { inviteResponsesEnabled: isMeetingInviteResponsesEnabled(this.meeting()) })
  );

  private initRegistrants(): Signal<MeetingRegistrant[]> {
    return toSignal(
      combineLatest([toObservable(this.meeting), toObservable(this.occurrence)]).pipe(
        switchMap(([meeting, occurrence]) => {
          this.loading.set(true);
          const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence });
          return this.meetingService.getMyMeetingRegistrants(meeting.id, isMeetingInviteResponsesEnabled(meeting), occurrenceId).pipe(
            catchError(() => of([] as MeetingRegistrant[])),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] as MeetingRegistrant[] }
    );
  }
}
