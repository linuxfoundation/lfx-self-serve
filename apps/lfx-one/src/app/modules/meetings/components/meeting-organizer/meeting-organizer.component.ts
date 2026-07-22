// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { buildMeetingOrganizerDisplay, collectMeetingOrganizers, Meeting, MeetingHostCandidate, MeetingOrganizerDisplay, PastMeeting } from '@lfx-one/shared';
import { UserService } from '@services/user.service';
import { TooltipModule } from 'primeng/tooltip';

/**
 * Shared "Organized by" chip reused across meeting cards, the join page, and past-meeting
 * details. Resolves the organizer from `meeting.created_by` (with an optional host fallback),
 * renders nothing when nothing resolves, and shows "Organized by you" when the viewer is the
 * organizer. Multiple organizers collapse to "Organized by {first} +N" with a tooltip listing all.
 */
@Component({
  selector: 'lfx-meeting-organizer',
  imports: [TagComponent, TooltipModule],
  templateUrl: './meeting-organizer.component.html',
})
export class MeetingOrganizerComponent {
  private readonly userService = inject(UserService);

  public readonly meeting = input.required<Meeting | PastMeeting>();
  public readonly hosts = input<MeetingHostCandidate[]>([]);

  public readonly display: Signal<MeetingOrganizerDisplay | null> = this.initDisplay();
  public readonly allNames: Signal<string> = computed(() => {
    const organizer = this.display();
    if (!organizer) {
      return '';
    }
    return [organizer.primaryName, ...organizer.overflowNames].filter(Boolean).join(', ');
  });

  private initDisplay(): Signal<MeetingOrganizerDisplay | null> {
    return computed(() => {
      // v1 privacy constraint (LFXV2-2802): the organizer is member-visible info, so it is
      // never shown to unauthenticated visitors even on public meetings. Gated in this single
      // component so the whole "Organized by" surface can be un-gated in one place once the
      // data-privacy review clears it.
      if (!this.userService.authenticated()) {
        return null;
      }
      const organizers = collectMeetingOrganizers(this.meeting(), this.hosts());
      const viewerUsername = this.userService.user()?.username ?? null;
      return buildMeetingOrganizerDisplay(organizers, viewerUsername);
    });
  }
}
