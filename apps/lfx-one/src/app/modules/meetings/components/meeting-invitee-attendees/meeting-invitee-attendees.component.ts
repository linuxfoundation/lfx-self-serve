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
import { catchError, combineLatest, filter, finalize, Observable, of, switchMap, take } from 'rxjs';

/**
 * Attendee preview for an invitee's meeting card, plus the read-only guest drawer behind "View all".
 * @description Uses `GET /api/meetings/:uid/my-meeting-registrants`, which only checks that the
 * caller is a registrant or organizer of the meeting. It does NOT check `show_meeting_attendees`:
 * the parent card enforces that by rendering this component only when the flag is on, inside
 * `@defer (on viewport)` so only visible cards fetch.
 *
 * The card fetches a `preview` roster (no committee enrichment, partial roster tolerated). The
 * full enriched roster is fetched once, the first time the drawer opens. A refused or failed
 * preview fetch renders nothing.
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
  protected readonly fullRosterLoading = signal(false);
  protected readonly registrants = this.initPreviewRegistrants();
  protected readonly fullRegistrants = this.initFullRegistrants();
  // Until the full roster lands, or if its fetch fails, the drawer shows the preview roster.
  protected readonly drawerRegistrants = computed<MeetingRegistrant[]>(() => {
    const full = this.fullRegistrants();
    return full && full.length > 0 ? full : this.registrants();
  });
  protected readonly previewPeople = computed<MeetingAttendeePreviewPerson[]>(() =>
    buildAttendeePreviewFromRegistrants(this.registrants(), { inviteResponsesEnabled: isMeetingInviteResponsesEnabled(this.meeting()) })
  );

  private initPreviewRegistrants(): Signal<MeetingRegistrant[]> {
    return toSignal(
      combineLatest([toObservable(this.meeting), toObservable(this.occurrence)]).pipe(
        switchMap(([meeting, occurrence]) => {
          this.loading.set(true);
          return this.fetchRegistrants(meeting, occurrence, true).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: [] as MeetingRegistrant[] }
    );
  }

  private initFullRegistrants(): Signal<MeetingRegistrant[] | null> {
    const firstOpen$ = toObservable(this.drawerVisible).pipe(filter(Boolean), take(1));
    return toSignal(
      combineLatest([toObservable(this.meeting), toObservable(this.occurrence), firstOpen$]).pipe(
        switchMap(([meeting, occurrence]) => {
          this.fullRosterLoading.set(true);
          return this.fetchRegistrants(meeting, occurrence, false).pipe(finalize(() => this.fullRosterLoading.set(false)));
        })
      ),
      { initialValue: null }
    );
  }

  private fetchRegistrants(meeting: Meeting, occurrence: MeetingOccurrence | null, preview: boolean): Observable<MeetingRegistrant[]> {
    const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence });
    return this.meetingService.getMyMeetingRegistrants(meeting.id, isMeetingInviteResponsesEnabled(meeting), occurrenceId, preview).pipe(
      catchError((error) => {
        console.error('Failed to fetch my meeting registrants:', error);
        return of([] as MeetingRegistrant[]);
      })
    );
  }
}
