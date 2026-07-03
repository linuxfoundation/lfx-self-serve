// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, PLATFORM_ID } from '@angular/core';
import type { OrgPastMeeting } from '@lfx-one/shared/interfaces';
import { toAbsoluteUrl } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-org-past-meetings',
  imports: [DatePipe, ClipboardModule],
  templateUrl: './org-past-meetings.component.html',
})
export class OrgPastMeetingsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly meetings = input.required<readonly OrgPastMeeting[]>();
  public readonly loading = input<boolean>(false);

  protected meetingLinkUrl(meetingId: string): string {
    return toAbsoluteUrl(`/meetings/${meetingId}`, isPlatformBrowser(this.platformId));
  }
}
