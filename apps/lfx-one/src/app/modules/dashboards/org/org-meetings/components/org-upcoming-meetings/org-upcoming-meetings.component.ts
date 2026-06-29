// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, PLATFORM_ID, signal } from '@angular/core';
import type { OrgMeeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-upcoming-meetings',
  imports: [DatePipe],
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
    void navigator.clipboard?.writeText(`${window.location.origin}/meetings/${meetingId}`);
  }
}
