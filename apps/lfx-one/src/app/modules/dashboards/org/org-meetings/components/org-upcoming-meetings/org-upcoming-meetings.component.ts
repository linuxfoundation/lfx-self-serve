// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import type { OrgMeeting, OrgMeetingRsvpStatus, OrgMeetingRsvpTally } from '@lfx-one/shared/interfaces';

const RSVP_BADGES: Record<Exclude<OrgMeetingRsvpStatus, null>, { label: string; badgeClass: string }> = {
  yes: { label: 'Accepted', badgeClass: 'bg-emerald-50 text-emerald-600' },
  maybe: { label: 'Tentative', badgeClass: 'bg-amber-50 text-amber-600' },
  no: { label: 'Declined', badgeClass: 'bg-red-50 text-red-600' },
};

const NO_RESPONSE_BADGE = { label: 'No Response', badgeClass: 'bg-gray-100 text-gray-500' };

@Component({
  selector: 'lfx-org-upcoming-meetings',
  imports: [DatePipe, PersonAvatarComponent],
  templateUrl: './org-upcoming-meetings.component.html',
})
export class OrgUpcomingMeetingsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly meetings = input.required<readonly OrgMeeting[]>();
  public readonly loading = input<boolean>(false);

  private readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

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

  protected copyLink(meetingId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard?.writeText(`${window.location.origin}/meetings/${meetingId}`)?.catch(() => {
      // Clipboard access denied or unavailable — fail silently.
    });
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
    return status ? RSVP_BADGES[status] : NO_RESPONSE_BADGE;
  }
}
