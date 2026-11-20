// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Provider, Signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meeting, MeetingProjectQueryOptions, MeetingsHomePastPage, PastMeeting } from '@lfx-one/shared/interfaces';
import { parseToInt } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { map, Observable, of, startWith, switchMap } from 'rxjs';

/**
 * Where the meetings home reads its meetings from: the viewer's own meetings (Me lens) or one project's.
 * @description Edits, deletes and RSVPs refresh through {@link UserService}'s refresh streams: the upcoming and latest past
 * feeds re-emit on them, and the store reloads a paged past feed from its first page.
 */
export abstract class MeetingsHomeFeed {
  /** Changes with the viewer or the scope; the store reloads its feeds and resets search and filters when it does. */
  public abstract readonly key: Signal<string>;
  /** `me` lists the viewer's meetings across projects; `project` one project's or foundation's, without project labels. */
  public abstract readonly scope: 'me' | 'project';
  /** Past meetings come a page at a time and are searched on the server. */
  public abstract readonly pagedPast: boolean;
  public abstract readonly upcomingRefresh$: Observable<void>;
  public abstract readonly pastRefresh$: Observable<void>;
  public abstract upcoming(): Observable<Meeting[]>;
  /** Past meetings, most recent first; `search` and `pageToken` apply only when {@link pagedPast} is true. */
  public abstract past(search: string, pageToken?: string): Observable<MeetingsHomePastPage>;
  /** The few most recent past meetings, for the Last meeting card. */
  public abstract latestPast(): Observable<PastMeeting[]>;
}

/** The viewer's meetings across every project, loaded whole. */
@Injectable()
export class UserMeetingsHomeFeed extends MeetingsHomeFeed {
  private readonly userService = inject(UserService);

  public readonly key: Signal<string> = this.userService.meetingFeedIdentity;
  public readonly scope = 'me';
  public readonly pagedPast = false;
  public readonly upcomingRefresh$: Observable<void> = this.userService.meetingsRefresh$;
  public readonly pastRefresh$: Observable<void> = this.userService.pastMeetingsRefresh$;

  public upcoming(): Observable<Meeting[]> {
    return this.userService.getUserMeetings({ includeAttendance: true });
  }

  public past(): Observable<MeetingsHomePastPage> {
    return this.userService.getUserPastMeetings({ includeArtifactsAndAttendance: true }).pipe(map((meetings) => ({ meetings })));
  }

  public latestPast(): Observable<PastMeeting[]> {
    return this.userService.getUserLatestPastMeetings();
  }
}

/**
 * Every meeting of the active project, or of a foundation and its sub-projects, as the viewer can see them.
 * @description Past meetings are paged; meetings still running are left out of them, as the user feed's server does.
 */
@Injectable()
export class ProjectMeetingsHomeFeed extends MeetingsHomeFeed {
  private readonly userService = inject(UserService);
  private readonly meetingService = inject(MeetingService);
  private readonly projectContext = inject(ProjectContextService);

  public readonly key: Signal<string> = computed(
    () => `${this.userService.meetingFeedIdentity()}\0${this.projectContext.activeContextUid()}\0${this.projectContext.isFoundationContext()}`
  );
  public readonly scope = 'project';
  public readonly pagedPast = true;
  public readonly upcomingRefresh$: Observable<void> = this.userService.meetingsRefresh$;
  public readonly pastRefresh$: Observable<void> = this.userService.pastMeetingsRefresh$;

  public upcoming(): Observable<Meeting[]> {
    return this.followRefresh(this.upcomingRefresh$, (projectUid, options) => this.meetingService.getProjectMeetingsForHome(projectUid, options), []);
  }

  public past(search: string, pageToken?: string): Observable<MeetingsHomePastPage> {
    const projectUid = this.projectContext.activeContextUid();
    if (!projectUid) return of({ meetings: [] });
    return this.meetingService
      .getProjectPastMeetingsForHome(projectUid, search, pageToken, undefined, this.scopeOptions())
      .pipe(map((page) => ({ ...page, meetings: this.ended(page.meetings) })));
  }

  // shortcut: the project lens has no Last meeting card, so nothing loads. revisit: when its right column shows one.
  public latestPast(): Observable<PastMeeting[]> {
    return of([]);
  }

  /** A foundation lists its sub-projects' meetings too; a project only its own. */
  private scopeOptions(): MeetingProjectQueryOptions {
    return { includeSubProjects: this.projectContext.isFoundationContext() };
  }

  /** Loads now and again on every refresh, as the user feed's shared streams do. */
  private followRefresh<T>(
    refresh$: Observable<void>,
    load: (projectUid: string, options: MeetingProjectQueryOptions) => Observable<T>,
    empty: T
  ): Observable<T> {
    return refresh$.pipe(
      startWith(undefined),
      switchMap(() => {
        const projectUid = this.projectContext.activeContextUid();
        return projectUid ? load(projectUid, this.scopeOptions()) : of(empty);
      })
    );
  }

  private ended(meetings: PastMeeting[]): PastMeeting[] {
    const now = Date.now();
    return meetings.filter((meeting) => {
      const end = this.effectiveEndMs(meeting);
      return end !== null && end < now;
    });
  }

  /** Scheduled end, else start plus duration; null when neither can be read. */
  private effectiveEndMs(meeting: PastMeeting): number | null {
    const scheduledEnd = meeting.scheduled_end_time ? Date.parse(meeting.scheduled_end_time) : NaN;
    if (!Number.isNaN(scheduledEnd)) return scheduledEnd;
    const start = Date.parse(meeting.scheduled_start_time || meeting.start_time);
    const duration = parseToInt(meeting.duration);
    return Number.isNaN(start) || duration === undefined ? null : start + duration * 60_000;
  }
}

/**
 * `/project/meetings` and `/foundation/meetings` read that project's meetings; the flat `/meetings` reads the viewer's.
 * @description Chosen from the route's `lens` data, as the page's gate is, not from the active lens, which can lag a deep link.
 */
export function provideMeetingsHomeFeed(): Provider[] {
  return [
    UserMeetingsHomeFeed,
    ProjectMeetingsHomeFeed,
    {
      provide: MeetingsHomeFeed,
      useFactory: (): MeetingsHomeFeed => {
        const lens = inject(ActivatedRoute)
          .snapshot.pathFromRoot.map((route) => route.data?.['lens'])
          .find(Boolean);
        return lens === 'project' || lens === 'foundation' ? inject(ProjectMeetingsHomeFeed) : inject(UserMeetingsHomeFeed);
      },
    },
  ];
}
