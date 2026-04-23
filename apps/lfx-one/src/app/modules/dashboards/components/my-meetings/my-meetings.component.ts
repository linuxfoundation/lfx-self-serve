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

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly upcomingLoading = signal(true);
  protected readonly pastLoading = signal(true);

  private readonly selectedProject = computed(() => this.projectContextService.activeContext());

  // Raw data from API — switches data source based on active lens
  private readonly rawMeetings = this.initRawMeetings();
  private readonly rawPastMeetings = this.initRawPastMeetings();

  // Computed: Active (not-ended) meeting entries sorted by start time
  private readonly activeEntries: Signal<MeetingWithOccurrence[]> = this.initActiveEntries();

  // Computed: Next upcoming meeting (with occurrence expansion)
  protected readonly nextMeeting: Signal<MeetingWithOccurrence | null> = this.initNextMeeting();

  // Computed: Last past meeting
  protected readonly lastMeeting: Signal<PastMeeting | null> = this.initLastMeeting();

  // Count of other meetings whose time range overlaps the displayed Next Meeting
  protected readonly overlappingNextCount: Signal<number> = this.initOverlappingNextCount();

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
      () => this.userService.getUserLatestPastMeetings(),
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

  private initActiveEntries(): Signal<MeetingWithOccurrence[]> {
    return computed(() => {
      const meetings = this.rawMeetings();
      const now = Date.now();
      const entries: MeetingWithOccurrence[] = [];

      for (const meeting of meetings) {
        if (meeting.occurrences && meeting.occurrences.length > 0) {
          for (const occurrence of getActiveOccurrences(meeting.occurrences)) {
            const startMs = new Date(occurrence.start_time).getTime();
            const endMs = startMs + occurrence.duration * 60 * 1000;
            if (endMs >= now) {
              entries.push({ meeting, occurrence, sortTime: startMs, trackId: `${meeting.id}-${occurrence.occurrence_id}` });
            }
          }
        } else {
          const startMs = new Date(meeting.start_time).getTime();
          const endMs = startMs + meeting.duration * 60 * 1000;
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
      return entries;
    });
  }

  private initNextMeeting(): Signal<MeetingWithOccurrence | null> {
    return computed(() => {
      const entries = this.activeEntries();
      const now = Date.now();
      const imminentWindowMs = 10 * 60 * 1000;

      const imminent = entries.find((entry) => entry.sortTime > now && entry.sortTime - now <= imminentWindowMs);
      if (imminent) return imminent;

      const inProgress = entries.find((entry) => entry.sortTime <= now);
      if (inProgress) return inProgress;

      return entries[0] ?? null;
    });
  }

  private initOverlappingNextCount(): Signal<number> {
    return computed(() => {
      const next = this.nextMeeting();
      if (!next) return 0;
      const nextStart = next.sortTime;
      const nextEnd = nextStart + next.occurrence.duration * 60 * 1000;
      return this.activeEntries().filter((entry) => {
        if (entry === next) return false;
        const entryStart = entry.sortTime;
        const entryEnd = entryStart + entry.occurrence.duration * 60 * 1000;
        return entryStart < nextEnd && entryEnd > nextStart;
      }).length;
    });
  }

  private initLastMeeting(): Signal<PastMeeting | null> {
    return computed(() => {
      // The backend `v1_past_meeting` index includes meetings as soon as they START (not end),
      // so both the Me-lens fast-path and the project-lens `getPastMeetingsByProject` stream can
      // contain in-progress meetings at the top. The Me-lens service already filters those out
      // upstream, but the project-lens path doesn't — so we re-apply the filter client-side here
      // to keep both lenses consistent. rawPastMeetings is already sorted newest-first.
      const now = Date.now();
      return (
        this.rawPastMeetings().find((meeting) => {
          if (meeting.scheduled_end_time) {
            const scheduledEnd = new Date(meeting.scheduled_end_time).getTime();
            if (!Number.isNaN(scheduledEnd)) return scheduledEnd < now;
          }
          const startIso = meeting.scheduled_start_time ?? meeting.start_time;
          if (!startIso) return false;
          const startMs = new Date(startIso).getTime();
          const duration = Number(meeting.duration);
          if (Number.isNaN(startMs) || Number.isNaN(duration)) return false;
          return startMs + duration * 60 * 1000 < now;
        }) ?? null
      );
    });
  }
}
