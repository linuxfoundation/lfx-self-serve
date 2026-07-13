// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import { ButtonComponent } from '@components/button/button.component';

import type { GroupMeeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-group-meeting-card',
  imports: [ButtonComponent],
  templateUrl: './org-group-meeting-card.component.html',
})
export class OrgGroupMeetingCardComponent {
  public readonly meeting = input.required<GroupMeeting>();
}
