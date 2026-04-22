// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DashboardMeetingCardComponent } from '@app/modules/dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { getActiveOccurrences } from '@lfx-one/shared';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, Observable, of, switchMap, tap } from 'rxjs';

import type { Meeting, MeetingWithOccurrence, PastMeeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-my-meetings',
  imports: [DashboardMeetingCardComponent, SkeletonModule],
  templateUrl: './my-meetings.component.html',
  styleUrl: './my-meetings.component.scss',
})
export class MyMeetingsComponent {
  private readonly userService = inject(UserService);
  private readonly meetingService = inject(MeetingService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly lensService = inject(LensService);

  private static readonly bufferMs = 40 * 60 * 1000; // 40 minutes

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly upcomingLoading = signal(true);
  protected readonly pastLoading = signal(true);

  private readonly selectedProject = computed(() => this.projectContextService.activeContext());

  // Raw data from API — switches data source based on active lens
  private readonly rawMeetings = this.initRawMeetings();
  private readonly rawPastMeetings = this.initRawPastMeetings();

  // Computed: Next upcoming meeting (with occurrence expansion)
  protected readonly nextMeeting: Signal<MeetingWithOccurrence | null> = this.initNextMeeting();

  // Computed: Last past meeting
  protected readonly lastMeeting: Signal<PastMeeting | null> = this.initLastMeeting();

  // Text based on lens
  protected readonly sectionTitle = computed(() => (this.activeLens() === 'me' ? 'My Meetings' : 'Meetings'));
  protected readonly emptyPastText = computed(() => (this.activeLens() === 'me' ? 'Your past meetings will appear here.' : 'No past meetings found.'));
  protected readonly emptyUpcomingText = computed(() =>
    this.activeLens() === 'me' ? 'Your scheduled meetings will appear here.' : 'No upcoming meetings found.'
  );

  private initRawMeetings() {
    return this.initLensSwitchedData<Meeting>(
      this.upcomingLoading,
      () => this.userService.getUserMeetings(),
      (uid) => this.meetingService.getUpcomingMeetingsByProject(uid)
    );
  }

  private initRawPastMeetings() {
    return this.initLensSwitchedData<PastMeeting>(
      this.pastLoading,
      () => this.userService.getUserPastMeetings(),
      (uid) => this.meetingService.getPastMeetingsByProject(uid)
    );
  }

  private initLensSwitchedData<T>(
    loading: WritableSignal<boolean>,
    meFetcher: () => Observable<T[]>,
    projectFetcher: (projectUid: string) => Observable<T[]>
  ): Signal<T[]> {
    const project$ = toObservable(this.selectedProject);
    const lens$ = toObservable(this.activeLens);

    return toSignal(
      combineLatest([project$, lens$]).pipe(
        tap(() => loading.set(true)),
        switchMap(([project, lens]) => {
          if (lens === 'org') {
            loading.set(false);
            return of([] as T[]);
          }

          let source$: Observable<T[]>;
          if (lens === 'me') {
            source$ = meFetcher();
          } else if (project?.uid) {
            source$ = projectFetcher(project.uid);
          } else {
            loading.set(false);
            return of([] as T[]);
          }

          return source$.pipe(
            tap(() => loading.set(false)),
            catchError(() => {
              loading.set(false);
              return of([] as T[]);
            })
          );
        })
      ),
      { initialValue: [] as T[] }
    );
  }

  private initNextMeeting(): Signal<MeetingWithOccurrence | null> {
    return computed(() => {
      const meetings = this.rawMeetings();
      const now = Date.now();
      const entries: MeetingWithOccurrence[] = [];

      for (const meeting of meetings) {
        if (meeting.occurrences && meeting.occurrences.length > 0) {
          for (const occurrence of getActiveOccurrences(meeting.occurrences)) {
            const startMs = new Date(occurrence.start_time).getTime();
            const endMs = startMs + occurrence.duration * 60 * 1000 + MyMeetingsComponent.bufferMs;
            if (endMs >= now) {
              entries.push({ meeting, occurrence, sortTime: startMs, trackId: `${meeting.id}-${occurrence.occurrence_id}` });
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

      entries.sort((a, b) => a.sortTime - b.sortTime);
      return entries[0] ?? null;
    });
  }

  private initLastMeeting(): Signal<PastMeeting | null> {
    return computed(() => {
      const pastMeetings = this.rawPastMeetings();
      if (pastMeetings.length === 0) {
        return null;
      }

      // Sort by scheduled_start_time descending (most recent first)
      const sorted = [...pastMeetings].sort((a, b) =>
        (b.scheduled_start_time ?? b.start_time ?? '').localeCompare(a.scheduled_start_time ?? a.start_time ?? '')
      );
      return sorted[0] ?? null;
    });
  }
}
