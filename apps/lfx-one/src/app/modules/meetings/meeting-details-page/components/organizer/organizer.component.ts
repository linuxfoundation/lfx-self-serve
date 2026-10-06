// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MeetingUserInfo } from '@lfx-one/shared/interfaces';
import { getMeetingOrganizerDisplayName, resolveMeetingOrganizer } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * "Organized by" in the V2 rail card, under the action slot (E2-01, #1775, FR-014; moved here from
 * E1-03, where the prototype does not put it).
 * @description The organizer is the meeting's owner, else its creator (`resolveMeetingOrganizer`, as
 * V1's chip resolves it, without V1's host fallback: V2 does not load the registrants yet). The
 * whole block is absent when nobody resolves, and for anonymous viewers, from whom the BFF removes
 * these fields anyway. The name falls back to the username, then the email, so a missing name never
 * renders as "undefined".
 */
@Component({
  selector: 'lfx-meeting-organizer',
  imports: [AvatarComponent],
  templateUrl: './organizer.component.html',
})
export class MeetingOrganizerComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly userService = inject(UserService);

  protected readonly organizer: Signal<MeetingUserInfo | null> = this.initOrganizer();
  protected readonly name = computed(() => getMeetingOrganizerDisplayName(this.organizer()));

  private initOrganizer(): Signal<MeetingUserInfo | null> {
    return computed(() => {
      if (!this.userService.authenticated()) {
        return null;
      }
      const organizer = resolveMeetingOrganizer(this.state.meeting());
      return organizer && getMeetingOrganizerDisplayName(organizer) ? organizer : null;
    });
  }
}
