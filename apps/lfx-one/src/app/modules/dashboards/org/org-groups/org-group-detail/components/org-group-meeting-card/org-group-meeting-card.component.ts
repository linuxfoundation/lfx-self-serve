// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { ButtonComponent } from '@components/button/button.component';

import { MEETING_VISIBILITY_DOT_COLOR } from '@lfx-one/shared/constants';
import type { GroupMeeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-group-meeting-card',
  imports: [ButtonComponent, TooltipModule],
  templateUrl: './org-group-meeting-card.component.html',
})
export class OrgGroupMeetingCardComponent {
  public readonly meeting = input.required<GroupMeeting>();

  protected readonly visibilityDotColor = MEETING_VISIBILITY_DOT_COLOR;
}
