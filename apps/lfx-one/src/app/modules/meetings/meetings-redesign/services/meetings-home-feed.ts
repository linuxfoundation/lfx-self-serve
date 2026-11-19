// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Provider, Signal } from '@angular/core';
import { LATEST_PAST_MEETINGS_RETURN_LIMIT } from '@lfx-one/shared/constants';
import { Meeting, MeetingsHomePastPage, PastMeeting } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { map, Observable, of } from 'rxjs';

/**
 * Where the meetings home reads its meetings from: the viewer's own meetings (Me lens) or one project's.
 * @description Edits, deletes and RSVPs refresh through {@link UserService}'s refresh streams, which both feeds follow.
 */
export abstract class MeetingsHomeFeed {
  /** Changes with the viewer or the scope; the store reloads its feeds and resets search and filters when it does. */
  public abstract readonly key: Signal<string>;
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

/** Every meeting of the active project or foundation, as the viewer can see them; past meetings are paged. */
@Injectable()
export class ProjectMeetingsHomeFeed extends MeetingsHomeFeed {
  private readonly userService = inject(UserService);
  private readonly meetingService = inject(MeetingService);
  private readonly projectContext = inject(ProjectContextService);

  public readonly key: Signal<string> = computed(() => `${this.userService.meetingFeedIdentity()}\0${this.projectContext.activeContextUid()}`);
  public readonly pagedPast = true;
  public readonly upcomingRefresh$: Observable<void> = this.userService.meetingsRefresh$;
  public readonly pastRefresh$: Observable<void> = this.userService.pastMeetingsRefresh$;

  public upcoming(): Observable<Meeting[]> {
    const projectUid = this.projectContext.activeContextUid();
    return projectUid ? this.meetingService.getProjectMeetingsForHome(projectUid) : of([]);
  }

  public past(search: string, pageToken?: string): Observable<MeetingsHomePastPage> {
    const projectUid = this.projectContext.activeContextUid();
    return projectUid ? this.meetingService.getProjectPastMeetingsForHome(projectUid, search, pageToken) : of({ meetings: [] });
  }

  public latestPast(): Observable<PastMeeting[]> {
    const projectUid = this.projectContext.activeContextUid();
    if (!projectUid) return of([]);
    return this.meetingService.getProjectPastMeetingsForHome(projectUid, '', undefined, LATEST_PAST_MEETINGS_RETURN_LIMIT).pipe(map((page) => page.meetings));
  }
}

/** The Me lens reads the viewer's meetings; a project or foundation lens reads that project's. */
export function provideMeetingsHomeFeed(): Provider[] {
  return [
    UserMeetingsHomeFeed,
    ProjectMeetingsHomeFeed,
    {
      provide: MeetingsHomeFeed,
      useFactory: (): MeetingsHomeFeed => (inject(LensService).activeLens() === 'me' ? inject(UserMeetingsHomeFeed) : inject(ProjectMeetingsHomeFeed)),
    },
  ];
}
