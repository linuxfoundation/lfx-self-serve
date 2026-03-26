// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DashboardMeetingCardComponent } from '@app/modules/dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { ButtonComponent } from '@components/button/button.component';
import { getActiveOccurrences } from '@lfx-one/shared';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, of, switchMap, tap } from 'rxjs';

import type { Meeting, MeetingWithOccurrence } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-my-meetings',
  imports: [DashboardMeetingCardComponent, ButtonComponent, SkeletonModule, ScrollShadowDirective],
  templateUrl: './my-meetings.component.html',
  styleUrl: './my-meetings.component.scss',
})
export class MyMeetingsComponent {
  private readonly scrollShadowDirective = viewChild(ScrollShadowDirective);
  protected readonly showTopShadow = computed(() => this.scrollShadowDirective()?.showTopShadow() ?? false);
  protected readonly showBottomShadow = computed(() => this.scrollShadowDirective()?.showBottomShadow() ?? false);

  private readonly userService = inject(UserService);
  private readonly projectContextService = inject(ProjectContextService);

  private static readonly bufferMs = 40 * 60 * 1000; // 40 minutes

  protected readonly loading = signal(true);
  private readonly selectedProject = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  private readonly rawMeetings = this.initializeRawMeetings();
  private readonly allMeetings = computed(() => this.expandAndSort(this.rawMeetings()));

  // Next 2 meetings chronologically (deduplicated by meeting)
  protected readonly nextMeetings = this.initializeNextMeetings();

  private initializeNextMeetings() {
    return computed<MeetingWithOccurrence[]>(() => {
      const seen = new Set<string>();

      return this.allMeetings()
        .filter((m) => {
          if (seen.has(m.trackId)) {
            return false;
          }
          seen.add(m.trackId);
          return true;
        })
        .slice(0, 2);
    });
  }

  private initializeRawMeetings() {
    const project$ = toObservable(this.selectedProject);

    return toSignal(
      project$.pipe(
        tap(() => this.loading.set(true)),
        switchMap((project) => {
          if (!project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          return this.userService.getUserMeetings(project.uid, 100).pipe(
            tap(() => this.loading.set(false)),
            catchError((error) => {
              console.error('Failed to load user meetings:', error);
              this.loading.set(false);
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] as Meeting[] }
    );
  }

  /** Expand raw meetings into a sorted MeetingWithOccurrence list, filtering out ended entries */
  private expandAndSort(meetings: Meeting[]): MeetingWithOccurrence[] {
    const now = Date.now();
    const entries: MeetingWithOccurrence[] = [];

    for (const meeting of meetings) {
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        for (const occurrence of getActiveOccurrences(meeting.occurrences)) {
          const startMs = new Date(occurrence.start_time).getTime();
          const endMs = startMs + occurrence.duration * 60 * 1000 + MyMeetingsComponent.bufferMs;
          if (endMs >= now) {
            entries.push({ meeting, occurrence, sortTime: startMs, trackId: meeting.id });
          }
        }
      } else {
        const startMs = new Date(meeting.start_time).getTime();
        const endMs = startMs + meeting.duration * 60 * 1000 + MyMeetingsComponent.bufferMs;
        if (endMs >= now) {
          entries.push({
            meeting,
            occurrence: {
              occurrence_id: '',
              title: meeting.title,
              description: meeting.description,
              start_time: meeting.start_time,
              duration: meeting.duration,
            },
            sortTime: startMs,
            trackId: meeting.id,
          });
        }
      }
    }

    return entries.sort((a, b) => a.sortTime - b.sortTime);
  }
}
