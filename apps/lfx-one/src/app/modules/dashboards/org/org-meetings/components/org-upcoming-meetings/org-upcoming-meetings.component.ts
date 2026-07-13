// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { ORG_MEETING_TYPE_LABELS, ORG_MEETINGS_NO_RESPONSE_BADGE, ORG_MEETINGS_RSVP_BADGES } from '@lfx-one/shared/constants';
import type { OrgMeeting, OrgMeetingRsvpTally, OrgMeetingVm, OrgPrivateMeetingsRollupVm } from '@lfx-one/shared/interfaces';
import { deriveDemoPassword, deriveUpcomingMeetingDetailsUrl, splitOrgMeetingsByPrivacy, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';

@Component({
  selector: 'lfx-org-upcoming-meetings',
  imports: [DatePipe, PersonAvatarComponent, ClipboardModule, LinkifyPipe, ButtonComponent],
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

  // Splits the raw list into what renders its own card vs. what collapses into `privateRollup` (see `splitOrgMeetingsByPrivacy`).
  private readonly privacySplit = computed(() => splitOrgMeetingsByPrivacy(this.meetings(), (meeting) => meeting.orgInvitees.map((invitee) => invitee.name)));

  protected readonly privateRollup: Signal<OrgPrivateMeetingsRollupVm | null> = computed(() => this.privacySplit().rollup);

  // Pre-bake per-meeting presentation fields once per list change so the template's `@for` binds plain values (no method calls per change-detection).
  protected readonly meetingVms: Signal<readonly OrgMeetingVm[]> = computed(() => {
    const isBrowser = isPlatformBrowser(this.platformId);
    return this.privacySplit().visible.map((meeting) => this.toVm(meeting, isBrowser));
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
    const demoPassword = deriveDemoPassword(meeting.id, meeting.privacy);
    return {
      ...meeting,
      linkUrl: toAbsoluteUrl(`/meetings/${meeting.id}`, isBrowser),
      totalInvited: this.totalInvited(meeting.rsvpTally),
      inviteeVms: meeting.orgInvitees.map((invitee) => ({
        ...invitee,
        badge: invitee.rsvpStatus ? ORG_MEETINGS_RSVP_BADGES[invitee.rsvpStatus] : ORG_MEETINGS_NO_RESPONSE_BADGE,
      })),
      typeBadge: ORG_MEETING_TYPE_LABELS[meeting.type],
      detailsUrl: toAbsoluteUrl(deriveUpcomingMeetingDetailsUrl(meeting.id, demoPassword), isBrowser),
      // UI-only build: always show the CTA, even for demo-fallback rows with no backing meeting record —
      // the real link resolves once the account's data is wired up (see `deriveUpcomingMeetingDetailsUrl`).
      // TODO(LFXV2-1901 follow-up): once real invite/backing-record data lands, this must be computed
      // per-row instead of hardcoded true, so demo-fallback rows hide the CTA again.
      hasResolvableDetails: true,
    };
  }

  private totalInvited(tally: OrgMeetingRsvpTally): number {
    return tally.yes + tally.maybe + tally.no + tally.noResponse;
  }
}
