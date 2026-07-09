// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ORG_MEETING_TYPE_LABELS } from '@lfx-one/shared/constants';
import type { OrgPastMeeting, OrgPastMeetingVm } from '@lfx-one/shared/interfaces';
import { deriveDemoDetailsPath, deriveDemoDetailsQueryParams, deriveDemoPassword, deriveDemoViewerInvited, toAbsoluteUrl } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-org-past-meetings',
  imports: [DatePipe, ClipboardModule, RouterLink],
  templateUrl: './org-past-meetings.component.html',
})
export class OrgPastMeetingsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly meetings = input.required<readonly OrgPastMeeting[]>();
  public readonly loading = input<boolean>(false);
  public readonly orgName = input<string>('');

  // Pre-bake per-meeting presentation fields once per list change so the template's `@for` binds plain values (no method calls per change-detection).
  protected readonly meetingVms: Signal<readonly OrgPastMeetingVm[]> = computed(() => this.meetings().map((meeting) => this.toVm(meeting)));

  protected meetingLinkUrl(meetingId: string): string {
    return toAbsoluteUrl(`/meetings/${meetingId}`, isPlatformBrowser(this.platformId));
  }

  private toVm(meeting: OrgPastMeeting): OrgPastMeetingVm {
    const demoPassword = deriveDemoPassword(meeting.id, meeting.privacy);
    return {
      ...meeting,
      typeBadge: ORG_MEETING_TYPE_LABELS[meeting.type],
      demoIsViewerInvited: meeting.privacy !== 'private' || deriveDemoViewerInvited(meeting.id),
      demoPassword,
      demoDetailsPath: deriveDemoDetailsPath(meeting.id),
      demoDetailsQueryParams: deriveDemoDetailsQueryParams(demoPassword),
    };
  }
}
