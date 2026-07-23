// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { environment } from '@environments/environment';
import { Meeting, MeetingHostCandidate, MeetingOrganizerChipModel, PastMeeting } from '@lfx-one/shared/interfaces';
import { buildMeetingOrganizerChip, collectMeetingOrganizers, getPastMeetingResourceId, getPastMeetingStartTimeMs } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { PopoverModule } from 'primeng/popover';

/**
 * Shared "Organized by" chip reused across meeting cards, the join page, and past-meeting
 * details. Resolves organizers from the same host set the participants/registrants modal badges
 * (with `meeting.created_by` folded in), so the two surfaces never disagree. Multiple organizers
 * collapse to "Organized by {first} +N" with a popover listing all. Each organizer name is a
 * pre-filled `mailto:` link (plain text when the record has no email, or for "you").
 *
 * Rendered only to authenticated users (v1 privacy constraint — see initChip).
 */
@Component({
  selector: 'lfx-meeting-organizer',
  imports: [PopoverModule],
  templateUrl: './meeting-organizer.component.html',
})
export class MeetingOrganizerComponent {
  private readonly userService = inject(UserService);

  public readonly meeting = input.required<Meeting | PastMeeting>();
  public readonly hosts = input<MeetingHostCandidate[]>([]);
  public readonly pastMeeting = input<boolean>(false);
  // The surface's resolved display start time (recurring cards show the current/next occurrence,
  // not the series origin). Used for the mailto subject date; falls back to the meeting's own start.
  public readonly startTime = input<string | null>(null);

  public readonly chip: Signal<MeetingOrganizerChipModel | null> = this.initChip();

  private initChip(): Signal<MeetingOrganizerChipModel | null> {
    return computed(() => {
      // v1 privacy constraint (LFXV2-2802): the organizer is authenticated-visible info, so it is
      // never shown to unauthenticated visitors even on public meetings. Gated in this single
      // component so the whole "Organized by" surface can be un-gated in one place once the
      // data-privacy review clears it.
      if (!this.userService.authenticated()) {
        return null;
      }

      const meeting = this.meeting();
      const organizers = collectMeetingOrganizers(meeting, this.hosts());
      // The optional `username` alias is often absent; the namespaced LFID claim is the canonical
      // identity (matches the created_by/host username), so fall back to it for the "you" variant.
      const user = this.userService.user();
      const viewerUsername = user?.username || user?.['https://sso.linuxfoundation.org/claims/username'] || null;

      return buildMeetingOrganizerChip(organizers, viewerUsername, {
        meetingTitle: meeting.title,
        meetingDate: this.formatMeetingDate(meeting),
        detailUrl: this.buildDetailUrl(meeting),
      });
    });
  }

  private formatMeetingDate(meeting: Meeting | PastMeeting): string {
    const ms = this.resolveStartMs(meeting);
    if (ms === null) {
      return '';
    }
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(ms));
  }

  private resolveStartMs(meeting: Meeting | PastMeeting): number | null {
    // Prefer the surface's resolved display start (the occurrence a recurring card actually shows).
    const explicit = this.parseIso(this.startTime());
    if (explicit !== null) {
      return explicit;
    }
    // Past meetings can carry a Go zero-date on scheduled_start_time — the shared helper falls back.
    if (this.pastMeeting() || 'scheduled_start_time' in meeting) {
      return getPastMeetingStartTimeMs(meeting as PastMeeting);
    }
    return this.parseIso(meeting.start_time);
  }

  private parseIso(iso: string | null | undefined): number | null {
    if (!iso || iso.startsWith('0001-01-01')) {
      return null;
    }
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  private buildDetailUrl(meeting: Meeting | PastMeeting): string {
    const id = this.pastMeeting() ? getPastMeetingResourceId(meeting) : meeting.id;
    return `${environment.urls.home}/meetings/${id}`;
  }
}
