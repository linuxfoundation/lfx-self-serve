// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import type { OrgMeeting, OrgMeetingInvitee } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-upcoming-meetings',
  imports: [DatePipe],
  templateUrl: './org-upcoming-meetings.component.html',
})
export class OrgUpcomingMeetingsComponent {
  public readonly meetings = input.required<readonly OrgMeeting[]>();
  public readonly loading = input<boolean>(false);

  private readonly expandedIds = new Set<string>();

  protected isExpanded(id: string): boolean {
    return this.expandedIds.has(id);
  }

  protected toggleExpand(id: string): void {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
    }
  }

  protected rsvpBarWidth(count: number, total: number): string {
    if (total === 0) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  protected rsvpTotal(meeting: OrgMeeting): number {
    return meeting.rsvpTally.yes + meeting.rsvpTally.maybe + meeting.rsvpTally.no + meeting.rsvpTally.noResponse;
  }

  protected rsvpPercent(meeting: OrgMeeting): string {
    const total = this.rsvpTotal(meeting);
    if (total === 0) return '0%';
    return `${Math.round((meeting.rsvpTally.yes / total) * 100)}%`;
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  protected avatarColor(index: number): string {
    const colors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-600'];
    return colors[index % colors.length];
  }

  protected rsvpBadgeClass(status: OrgMeetingInvitee['rsvpStatus']): string {
    switch (status) {
      case 'yes': return 'bg-emerald-100 text-emerald-700';
      case 'maybe': return 'bg-amber-100 text-amber-700';
      case 'no': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-500';
    }
  }

  protected rsvpDotClass(status: OrgMeetingInvitee['rsvpStatus']): string {
    switch (status) {
      case 'yes': return 'bg-emerald-500';
      case 'maybe': return 'bg-amber-400';
      case 'no': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  }

  protected rsvpLabel(status: OrgMeetingInvitee['rsvpStatus']): string {
    switch (status) {
      case 'yes': return 'Accepted';
      case 'maybe': return 'Tentative';
      case 'no': return 'Declined';
      default: return 'Pending';
    }
  }

  protected copyLink(meetingId: string): void {
    void navigator.clipboard?.writeText(`${window.location.origin}/meetings/${meetingId}`);
  }

  protected openJoin(joinUrl: string | null): void {
    if (joinUrl) window.open(joinUrl, '_blank', 'noopener,noreferrer');
  }
}
