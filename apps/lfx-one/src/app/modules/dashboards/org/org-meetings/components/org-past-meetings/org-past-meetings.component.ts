// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, PLATFORM_ID } from '@angular/core';
import type { OrgPastMeeting } from '@lfx-one/shared/interfaces';

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
    const path = `/meetings/${meetingId}`;
    // SSR fallback: `window` is undefined during server rendering, so this must return the
    // relative path — the copy button renders unconditionally, so this runs on every SSR pass.
    if (!isPlatformBrowser(this.platformId)) return path;
    return `${window.location.origin}${path}`;
  }
}
