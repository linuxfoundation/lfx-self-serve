// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DashboardMeetingCardComponent } from '@app/modules/dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { getActiveOccurrences } from '@lfx-one/shared';
import { DASHBOARD_UPCOMING_MEETINGS_PAGE_LIMIT } from '@lfx-one/shared/constants';
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

  // Set when the underlying fetch failed (e.g. a `fga-sync` read_tuples outage, GH-4780) rather
  // than genuinely returning zero rows — lets the template show "couldn't load" + retry instead of
  // silently rendering the same empty state as a user with no meetings. Backed by
  // UserService.getUserMeetings / getUserLatestPastMeetings, both of which now propagate failures.
  protected readonly upcomingError = signal(false);
  protected readonly pastError = signal(false);

  private readonly upcomingRetry = signal(0);
  private readonly pastRetry = signal(0);

  private readonly selectedProject = computed(() => this.projectContextService.activeContext());

  // The meeting the user stepped to with the pager, by track id. Cleared whenever the upcoming fetch re-runs (lens,
  // project or retry), and ignored when it is no longer in the window, so the card falls back to its default meeting.
  private readonly selectedTrackId = signal<string | null>(null);

  // Raw data from API — switches data source based on active lens
  private readonly rawMeetings = this.initRawMeetings();
  private readonly rawPastMeetings = this.initRawPastMeetings();

  // Computed: Active (not-ended) meeting entries sorted by start time
  private readonly activeEntries: Signal<MeetingWithOccurrence[]> = this.initActiveEntries();

  // Computed: the meeting the card opens on (with occurrence expansion)
  private readonly defaultUpcomingMeeting: Signal<MeetingWithOccurrence | null> = this.initDefaultUpcomingMeeting();

  // Computed: the meetings the pager steps through, starting from the one the card opens on
  protected readonly upcomingWindow: Signal<MeetingWithOccurrence[]> = this.initUpcomingWindow();

  // Computed: the meeting shown in the upcoming card
  protected readonly shownUpcoming: Signal<MeetingWithOccurrence | null> = this.initShownUpcoming();

  // Computed: zero-based position of the shown meeting in the pager's window
  protected readonly upcomingPosition: Signal<number> = this.initUpcomingPosition();

  // Computed: "NEXT MEETING" only while the card shows the meeting it opened on
  protected readonly upcomingLabel: Signal<string> = this.initUpcomingLabel();

  // Computed: Last past meeting
  protected readonly lastMeeting: Signal<PastMeeting | null> = this.initLastMeeting();

  // Count of other meetings whose time range overlaps the displayed Next Meeting
  protected readonly overlappingNextCount: Signal<number> = this.initOverlappingNextCount();

  // Text based on lens
  protected readonly sectionTitle = 'Meetings';
  protected readonly emptyPastText = computed(() => (this.activeLens() === 'me' ? 'Your past meetings will appear here.' : 'No past meetings found.'));
  protected readonly emptyUpcomingText = computed(() =>
    this.activeLens() === 'me' ? 'Your scheduled meetings will appear here.' : 'No upcoming meetings found.'
  );
  // initLensSwitchedData sets `error` for both the Me-lens fetch and the project/foundation-lens
  // fetch, so the copy must not always claim it's "your" meetings — only true on the Me lens.
  protected readonly pastErrorText = computed(() => (this.activeLens() === 'me' ? "Couldn't load your past meetings" : "Couldn't load past meetings"));
  protected readonly upcomingErrorText = computed(() =>
    this.activeLens() === 'me' ? "Couldn't load your upcoming meetings" : "Couldn't load upcoming meetings"
  );

  protected showPreviousUpcoming(): void {
    this.stepUpcoming(-1);
  }

  protected showNextUpcoming(): void {
    this.stepUpcoming(1);
  }

  protected retryUpcoming(): void {
    this.upcomingRetry.update((n) => n + 1);
  }

  protected retryPast(): void {
    this.pastRetry.update((n) => n + 1);
  }

  private initRawMeetings() {
    return this.initLensSwitchedData<Meeting>(
      this.upcomingLoading,
      this.upcomingError,
      this.upcomingRetry,
      () => this.userService.getUserMeetings(),
      (uid) => this.meetingService.getUpcomingMeetingsByProject(uid),
      () => this.selectedTrackId.set(null)
    );
  }

  private initRawPastMeetings() {
    return this.initLensSwitchedData<PastMeeting>(
      this.pastLoading,
      this.pastError,
      this.pastRetry,
      () => this.userService.getUserLatestPastMeetings(),
      (uid) => this.meetingService.getPastMeetingsByProject(uid)
    );
  }

  private initLensSwitchedData<T>(
    loading: WritableSignal<boolean>,
    error: WritableSignal<boolean>,
    retry: Signal<number>,
    meFetcher: () => Observable<T[]>,
    projectFetcher: (projectUid: string) => Observable<T[]>,
    onReload: () => void = () => undefined
  ): Signal<T[]> {
    const project$ = toObservable(this.selectedProject);
    const lens$ = toObservable(this.activeLens);
    const retry$ = toObservable(retry);

    return toSignal(
      combineLatest([project$, lens$, retry$]).pipe(
        tap(() => {
          loading.set(true);
          error.set(false);
          onReload();
        }),
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
            catchError((err) => {
              console.error('my-meetings fetch failed', err);
              loading.set(false);
              error.set(true);
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
          for (const occurrence of getActiveOccurrences(meeting.occurrences, meeting.cancelled_occurrences)) {
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

  private initDefaultUpcomingMeeting(): Signal<MeetingWithOccurrence | null> {
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

  private initUpcomingWindow(): Signal<MeetingWithOccurrence[]> {
    return computed(() => {
      const entries = this.activeEntries();
      const defaultMeeting = this.defaultUpcomingMeeting();
      if (!defaultMeeting) return [];
      const start = Math.max(0, entries.indexOf(defaultMeeting));
      return entries.slice(start, start + DASHBOARD_UPCOMING_MEETINGS_PAGE_LIMIT);
    });
  }

  private initShownUpcoming(): Signal<MeetingWithOccurrence | null> {
    return computed(() => {
      const selected = this.selectedTrackId();
      const chosen = selected ? this.upcomingWindow().find((entry) => entry.trackId === selected) : undefined;
      return chosen ?? this.defaultUpcomingMeeting();
    });
  }

  private initUpcomingPosition(): Signal<number> {
    return computed(() => {
      const shown = this.shownUpcoming();
      return shown ? Math.max(0, this.upcomingWindow().indexOf(shown)) : 0;
    });
  }

  private initUpcomingLabel(): Signal<string> {
    return computed(() => (this.shownUpcoming() === this.defaultUpcomingMeeting() ? 'NEXT MEETING' : 'UPCOMING MEETING'));
  }

  private stepUpcoming(delta: number): void {
    const target = this.upcomingWindow()[this.upcomingPosition() + delta];
    if (target) {
      this.selectedTrackId.set(target.trackId);
    }
  }

  private initOverlappingNextCount(): Signal<number> {
    return computed(() => {
      const next = this.shownUpcoming();
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
