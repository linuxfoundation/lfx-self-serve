// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, PLATFORM_ID } from '@angular/core';
import type { OrgPastMeeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-past-meetings',
  imports: [DatePipe],
  templateUrl: './org-past-meetings.component.html',
})
export class OrgPastMeetingsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly meetings = input.required<readonly OrgPastMeeting[]>();
  public readonly loading = input<boolean>(false);

  protected copyLink(meetingId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard?.writeText(`${window.location.origin}/meetings/${meetingId}`)?.catch(() => {
      // Clipboard access denied or unavailable — fail silently.
    });
  }
}
