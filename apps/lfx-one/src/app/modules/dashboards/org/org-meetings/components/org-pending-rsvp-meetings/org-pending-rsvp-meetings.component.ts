// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { OrgMeetingRsvpChangeEvent, OrgPendingRsvpMeeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-pending-rsvp-meetings',
  imports: [DatePipe],
  templateUrl: './org-pending-rsvp-meetings.component.html',
})
export class OrgPendingRsvpMeetingsComponent {
  public readonly meetings = input.required<readonly OrgPendingRsvpMeeting[]>();
  public readonly loading = input<boolean>(false);
  public readonly rsvpChange = output<OrgMeetingRsvpChangeEvent>();

  protected deadlineChipClass(startTime: string): string {
    const hours = this.hoursUntil(startTime);
    if (hours < 24) return 'bg-red-100 text-red-700';
    if (hours < 72) return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-500';
  }

  protected deadlineLabel(startTime: string): string {
    const hours = Math.floor(this.hoursUntil(startTime));
    if (hours < 24) return hours > 0 ? `in ${hours}h` : 'Starting soon';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'tomorrow';
    return `in ${days} days`;
  }

  protected typePillClass(type: OrgPendingRsvpMeeting['type']): string {
    switch (type) {
      case 'board':
        return 'bg-violet-100 text-violet-700';
      case 'working-group':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  protected typeLabel(type: OrgPendingRsvpMeeting['type']): string {
    switch (type) {
      case 'board':
        return 'Board';
      case 'working-group':
        return 'Working Group';
      default:
        return 'Other';
    }
  }

  protected onRsvp(meetingId: string, status: 'yes' | 'maybe' | 'no'): void {
    this.rsvpChange.emit({ meetingId, status });
  }

  private hoursUntil(startTime: string): number {
    return (new Date(startTime).getTime() - Date.now()) / (60 * 60 * 1000);
  }
}
