// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DashboardMeetingCardComponent } from '@app/modules/dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { ButtonComponent } from '@components/button/button.component';
import { getActiveOccurrences } from '@lfx-one/shared';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, of, switchMap, tap } from 'rxjs';

import type { MeetingWithOccurrence } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-my-meetings',
  standalone: true,
  imports: [CommonModule, DashboardMeetingCardComponent, ButtonComponent, SkeletonModule],
  templateUrl: './my-meetings.component.html',
  styleUrl: './my-meetings.component.scss',
})
export class MyMeetingsComponent {
  private readonly userService = inject(UserService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly loading = signal(true);
  private readonly selectedProject = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  private readonly allMeetings = this.initializeAllMeetings();
  protected readonly todayMeetings = this.initializeTodayMeetings();
  protected readonly upcomingMeetings = this.initializeUpcomingMeetings();

  private initializeTodayMeetings() {
    return computed<MeetingWithOccurrence[]>(() => {
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
  }

  private initializeUpcomingMeetings() {
    return computed<MeetingWithOccurrence[]>(() => {
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
  }

  private initializeAllMeetings() {
    // Convert project signal to observable to react to project changes
    const project$ = toObservable(this.selectedProject);

    return toSignal(
      project$.pipe(
        tap(() => this.loading.set(true)),
        switchMap((project) => {
          // If no project/foundation selected, return empty array
          if (!project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          return this.userService.getUserMeetings(project.uid).pipe(
            tap(() => this.loading.set(false)),
            catchError((error) => {
              console.error('Failed to load user meetings:', error);
              this.loading.set(false);
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
