// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MeetingService } from '@app/shared/services/meeting.service';
import { ButtonComponent } from '@components/button/button.component';
import { DashboardMeetingCardComponent } from '@components/dashboard-meeting-card/dashboard-meeting-card.component';
import { getActiveOccurrences } from '@lfx-one/shared';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize } from 'rxjs';

import type { MeetingWithOccurrence } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-my-meetings',
  standalone: true,
  imports: [CommonModule, DashboardMeetingCardComponent, ButtonComponent, SkeletonModule],
  templateUrl: './my-meetings.component.html',
  styleUrl: './my-meetings.component.scss',
})
export class MyMeetingsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly router = inject(Router);
  protected readonly loading = signal(true);
  private readonly allMeetings = toSignal(this.meetingService.getMeetings().pipe(finalize(() => this.loading.set(false))), { initialValue: [] });

  protected readonly todayMeetings = computed<MeetingWithOccurrence[]>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const currentTime = now.getTime();
    const buffer = 40 * 60 * 1000; // 40 minutes in milliseconds

    const meetings: MeetingWithOccurrence[] = [];

    for (const meeting of this.allMeetings()) {
      // Process occurrences if they exist
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        // Get only active (non-cancelled) occurrences
        const activeOccurrences = getActiveOccurrences(meeting.occurrences);

        for (const occurrence of activeOccurrences) {
          const startTime = new Date(occurrence.start_time);
          const startTimeMs = startTime.getTime();
          const endTime = startTimeMs + occurrence.duration * 60 * 1000 + buffer;

          // Include if meeting is today and hasn't ended yet (including buffer)
          if (startTime >= today && startTime < todayEnd && endTime >= currentTime) {
            meetings.push({
              meeting,
              occurrence,
              sortTime: startTimeMs,
            });
          }
        }
      } else {
        // Handle meetings without occurrences (single meetings)
        const startTime = new Date(meeting.start_time);
        const startTimeMs = startTime.getTime();
        const endTime = startTimeMs + meeting.duration * 60 * 1000 + buffer;

        // Include if meeting is today and hasn't ended yet (including buffer)
        if (startTime >= today && startTime < todayEnd && endTime >= currentTime) {
          meetings.push({
            meeting,
            occurrence: {
              occurrence_id: '',
              title: meeting.title,
              description: meeting.description,
              start_time: meeting.start_time,
              duration: meeting.duration,
            },
            sortTime: startTimeMs,
          });
        }
      }
    }

    // Sort by earliest time first
    return meetings.sort((a, b) => a.sortTime - b.sortTime);
  });

  protected readonly upcomingMeetings = computed<MeetingWithOccurrence[]>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const meetings: MeetingWithOccurrence[] = [];

    for (const meeting of this.allMeetings()) {
      // Process occurrences if they exist
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        // Get only active (non-cancelled) occurrences
        const activeOccurrences = getActiveOccurrences(meeting.occurrences);

        for (const occurrence of activeOccurrences) {
          const startTime = new Date(occurrence.start_time);
          const startTimeMs = startTime.getTime();

          // Include if meeting is after today
          if (startTime >= todayEnd) {
            meetings.push({
              meeting,
              occurrence,
              sortTime: startTimeMs,
            });
          }
        }
      } else {
        // Handle meetings without occurrences (single meetings)
        const startTime = new Date(meeting.start_time);
        const startTimeMs = startTime.getTime();

        // Include if meeting is after today
        if (startTime >= todayEnd) {
          meetings.push({
            meeting,
            occurrence: {
              occurrence_id: '',
              title: meeting.title,
              description: meeting.description,
              start_time: meeting.start_time,
              duration: meeting.duration,
            },
            sortTime: startTimeMs,
          });
        }
      }
    }

    // Sort by earliest time first and limit to 5
    return meetings.sort((a, b) => a.sortTime - b.sortTime).slice(0, 5);
  });

  public handleViewAll(): void {
    this.router.navigate(['/meetings']);
  }
}
