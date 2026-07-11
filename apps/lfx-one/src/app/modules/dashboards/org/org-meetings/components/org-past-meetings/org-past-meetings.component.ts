// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal, Signal } from '@angular/core';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { ORG_MEETING_TYPE_LABELS, ORG_MEETINGS_ATTENDANCE_BADGES } from '@lfx-one/shared/constants';
import type { OrgPastMeeting, OrgPastMeetingVm, OrgPrivateMeetingsRollupVm } from '@lfx-one/shared/interfaces';
import { deriveDemoPassword, deriveMeetingDetailsUrl, splitOrgMeetingsByPrivacy, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';

@Component({
  selector: 'lfx-org-past-meetings',
  imports: [DatePipe, PersonAvatarComponent, ClipboardModule, LinkifyPipe],
  templateUrl: './org-past-meetings.component.html',
})
export class OrgPastMeetingsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly meetings = input.required<readonly OrgPastMeeting[]>();
  public readonly loading = input<boolean>(false);
  public readonly orgName = input<string>('');

  protected readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  // Splits the raw list into what renders its own card vs. what collapses into `privateRollup` (see `splitOrgMeetingsByPrivacy`).
  private readonly privacySplit = computed(() =>
    splitOrgMeetingsByPrivacy(this.meetings(), (meeting) => meeting.orgPastInvitees.map((invitee) => invitee.name))
  );

  protected readonly privateRollup: Signal<OrgPrivateMeetingsRollupVm | null> = computed(() => this.privacySplit().rollup);

  // Pre-bake per-meeting presentation fields once per list change so the template's `@for` binds plain values (no method calls per change-detection).
  protected readonly meetingVms: Signal<readonly OrgPastMeetingVm[]> = computed(() => this.privacySplit().visible.map((meeting) => this.toVm(meeting)));

  protected toggleExpand(id: string): void {
    this.expandedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  protected meetingLinkUrl(meetingId: string): string {
    return toAbsoluteUrl(`/meetings/${meetingId}`, isPlatformBrowser(this.platformId));
  }

  private toVm(meeting: OrgPastMeeting): OrgPastMeetingVm {
    const demoPassword = deriveDemoPassword(meeting.id, meeting.privacy);
    return {
      ...meeting,
      totalInvited: meeting.orgPastInvitees.length,
      inviteeVms: meeting.orgPastInvitees.map((invitee) => ({
        ...invitee,
        badge: ORG_MEETINGS_ATTENDANCE_BADGES[invitee.attendanceStatus],
      })),
      typeBadge: ORG_MEETING_TYPE_LABELS[meeting.type],
      detailsUrl: deriveMeetingDetailsUrl(meeting.id, demoPassword),
    };
  }
}
