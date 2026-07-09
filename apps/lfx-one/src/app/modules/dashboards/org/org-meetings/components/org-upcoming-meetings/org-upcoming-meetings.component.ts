// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { ORG_MEETING_TYPE_LABELS, ORG_MEETINGS_NO_RESPONSE_BADGE, ORG_MEETINGS_RSVP_BADGES } from '@lfx-one/shared/constants';
import type { OrgMeeting, OrgMeetingRsvpTally, OrgMeetingVm } from '@lfx-one/shared/interfaces';
import { deriveDemoDetailsPath, deriveDemoDetailsQueryParams, deriveDemoPassword, deriveDemoViewerInvited, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';

@Component({
  selector: 'lfx-org-upcoming-meetings',
  imports: [DatePipe, PersonAvatarComponent, ClipboardModule, LinkifyPipe, RouterLink],
  templateUrl: './org-upcoming-meetings.component.html',
})
export class OrgUpcomingMeetingsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly meetings = input.required<readonly OrgMeeting[]>();
  public readonly loading = input<boolean>(false);
  public readonly loadingMore = input<boolean>(false);
  public readonly loadMoreError = input<boolean>(false);
  public readonly error = input<boolean>(false);
  public readonly orgName = input<string>('');
  public readonly hasMore = input<boolean>(false);
  public readonly retry = output<void>();
  public readonly loadMore = output<void>();

  protected readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  // Pre-bake per-meeting presentation fields once per list change so the template's `@for` binds plain values (no method calls per change-detection).
  protected readonly meetingVms: Signal<readonly OrgMeetingVm[]> = computed(() => {
    const isBrowser = isPlatformBrowser(this.platformId);
    return this.meetings().map((meeting) => this.toVm(meeting, isBrowser));
  });

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

  private toVm(meeting: OrgMeeting, isBrowser: boolean): OrgMeetingVm {
    const tally = meeting.rsvpTally;
    const total = this.totalInvited(tally);
    const demoPassword = deriveDemoPassword(meeting.id, meeting.privacy);
    return {
      ...meeting,
      linkUrl: toAbsoluteUrl(`/meetings/${meeting.id}`, isBrowser),
      totalInvited: total,
      attendingPercent: total === 0 ? 0 : Math.round((tally.yes / total) * 100),
      yesPercent: this.rsvpPercent(tally.yes, total),
      maybePercent: this.rsvpPercent(tally.maybe, total),
      noPercent: this.rsvpPercent(tally.no, total),
      inviteeVms: meeting.orgInvitees.map((invitee) => ({
        ...invitee,
        badge: invitee.rsvpStatus ? ORG_MEETINGS_RSVP_BADGES[invitee.rsvpStatus] : ORG_MEETINGS_NO_RESPONSE_BADGE,
      })),
      typeBadge: ORG_MEETING_TYPE_LABELS[meeting.type],
      demoIsViewerInvited: meeting.privacy !== 'private' || deriveDemoViewerInvited(meeting.id),
      demoDetailsPath: deriveDemoDetailsPath(meeting.id),
      demoDetailsQueryParams: deriveDemoDetailsQueryParams(demoPassword),
    };
  }

  private totalInvited(tally: OrgMeetingRsvpTally): number {
    return tally.yes + tally.maybe + tally.no + tally.noResponse;
  }

  private rsvpPercent(count: number, total: number): number {
    return total === 0 ? 0 : (count / total) * 100;
  }
}
