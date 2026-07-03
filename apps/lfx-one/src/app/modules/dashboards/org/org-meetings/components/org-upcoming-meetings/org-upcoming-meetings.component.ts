// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { ORG_MEETINGS_NO_RESPONSE_BADGE, ORG_MEETINGS_RSVP_BADGES } from '@lfx-one/shared/constants';
import type { OrgMeeting, OrgMeetingRsvpStatus, OrgMeetingRsvpTally } from '@lfx-one/shared/interfaces';
import { toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';

@Component({
  selector: 'lfx-org-upcoming-meetings',
  imports: [DatePipe, PersonAvatarComponent, ClipboardModule, LinkifyPipe],
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

  protected totalInvited(tally: OrgMeetingRsvpTally): number {
    return tally.yes + tally.maybe + tally.no + tally.noResponse;
  }

  protected attendingPercent(tally: OrgMeetingRsvpTally): number {
    const total = this.totalInvited(tally);
    return total === 0 ? 0 : Math.round((tally.yes / total) * 100);
  }

  protected rsvpPercent(count: number, tally: OrgMeetingRsvpTally): number {
    const total = this.totalInvited(tally);
    return total === 0 ? 0 : (count / total) * 100;
  }

  protected rsvpBadge(status: OrgMeetingRsvpStatus): { label: string; badgeClass: string } {
    return status ? ORG_MEETINGS_RSVP_BADGES[status] : ORG_MEETINGS_NO_RESPONSE_BADGE;
  }
}
