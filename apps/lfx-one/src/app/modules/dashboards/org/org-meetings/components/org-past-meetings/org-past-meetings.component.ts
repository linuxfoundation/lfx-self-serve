// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import type { OrgPastMeeting, OrgPastMeetingInvitee } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-past-meetings',
  imports: [DatePipe],
  templateUrl: './org-past-meetings.component.html',
})
export class OrgPastMeetingsComponent {
  public readonly meetings = input.required<readonly OrgPastMeeting[]>();
  public readonly loading = input<boolean>(false);

  protected attendanceBadgeClass(status: OrgPastMeetingInvitee['attendanceStatus']): string {
    switch (status) {
      case 'attended':
        return 'bg-emerald-100 text-emerald-700';
      case 'missed':
        return 'bg-red-100 text-red-700';
      case 'excused':
        return 'bg-amber-100 text-amber-700';
    }
  }

  protected attendanceLabel(status: OrgPastMeetingInvitee['attendanceStatus']): string {
    switch (status) {
      case 'attended':
        return 'Attended';
      case 'missed':
        return 'Missed';
      case 'excused':
        return 'Excused';
    }
  }

  protected typePillClass(type: OrgPastMeeting['type']): string {
    switch (type) {
      case 'board':
        return 'bg-violet-100 text-violet-700';
      case 'working-group':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  protected typeLabel(type: OrgPastMeeting['type']): string {
    switch (type) {
      case 'board':
        return 'Board';
      case 'working-group':
        return 'Working Group';
      default:
        return 'Other';
    }
  }

  protected attendanceBarWidth(count: number, total: number): string {
    if (total === 0) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  protected copyLink(meetingId: string): void {
    void navigator.clipboard?.writeText(`${window.location.origin}/meetings/${meetingId}`);
  }
}
