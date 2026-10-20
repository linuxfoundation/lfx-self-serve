// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MEETING_GROUP_MEETINGS_LIMIT } from '@lfx-one/shared/constants';
import { MeetingGroupMeetingsState, PublicGroupSummary } from '@lfx-one/shared/interfaces';
import { isUuid, listOtherGroupMeetings } from '@lfx-one/shared/utils';
import { GroupService } from '@services/group.service';
import { MeetingService } from '@services/meeting.service';
import { catchError, map, Observable, of, startWith, switchMap } from 'rxjs';

/**
 * Reads the other meetings of the current meeting's group for the V2 page (E8-02, FR-045), the data
 * behind "Other meetings in this group" (E8-04).
 * @description Both reads are the public calendar page's, so nothing new is exposed and no route is
 * added:
 *
 * - **Group.** `GET /public/api/projects/:id/groups` is the only source of a group's name. The
 *   meetings feed carries committee uids without names by design, and lists only uids the directory
 *   lists. The first of the meeting's committees the directory lists is the group; a committee it
 *   does not list is never addressed, so the feed is not even asked about it (`none`).
 * - **Meetings.** `GET /public/api/projects/:id/meetings?committee=<uid>`, which serves PUBLIC
 *   meetings only, for anonymous and signed-in viewers alike. The current meeting is dropped here,
 *   each other series appears once at its next occurrence that has not ended, and the list is cut to
 *   `MEETING_GROUP_MEETINGS_LIMIT` (`hasMore` tells the section to link to the public calendar).
 *
 * HTTP only, no browser API, so it is SSR-safe; the section decides when to subscribe.
 */
@Injectable({ providedIn: 'root' })
export class MeetingGroupMeetingsService {
  private readonly groupService = inject(GroupService);
  private readonly meetingService = inject(MeetingService);

  /**
   * Emits `loading`, then `ready`, `none` or `error`.
   * @param projectIdentifier The meeting's project, by uid or slug
   * @param committeeUids The meeting's committees, in the order the page lists them
   * @param currentMeetingUid The current meeting's series uid (`getMeetingSeriesUid`)
   */
  public fetch(projectIdentifier: string, committeeUids: readonly string[], currentMeetingUid: string): Observable<MeetingGroupMeetingsState> {
    // The feed answers a non-UUID `committee` with a 400; no such uid can be in the directory anyway.
    const candidates = committeeUids.filter((uid) => isUuid(uid));
    if (!projectIdentifier || candidates.length === 0) {
      return of(this.state('none'));
    }

    return this.groupService.getPublicProjectGroups(projectIdentifier).pipe(
      map((directory) => this.pickGroup(directory.groups ?? [], candidates)),
      switchMap((group) => {
        if (!group) {
          return of(this.state('none'));
        }
        return this.meetingService.getPublicProjectMeetings(projectIdentifier, group.uid).pipe(
          map((response): MeetingGroupMeetingsState => {
            const others = listOtherGroupMeetings(response.meetings ?? [], currentMeetingUid, new Date());
            return {
              status: 'ready',
              group,
              meetings: others.slice(0, MEETING_GROUP_MEETINGS_LIMIT),
              hasMore: others.length > MEETING_GROUP_MEETINGS_LIMIT,
            };
          })
        );
      }),
      // `MeetingService.getPublicProjectMeetings` logs its own failure; `GroupService` does not.
      catchError((error: unknown) => {
        console.error(`Failed to load the other meetings of the group for project ${projectIdentifier}:`, error);
        return of(this.state('error'));
      }),
      startWith(this.state('loading'))
    );
  }

  /** The first of the meeting's committees that the public group directory lists. */
  private pickGroup(groups: PublicGroupSummary[], candidates: string[]): PublicGroupSummary | null {
    const byUid = new Map(groups.map((group) => [group.uid, group]));
    for (const uid of candidates) {
      const group = byUid.get(uid);
      if (group) {
        return group;
      }
    }
    return null;
  }

  private state(status: Exclude<MeetingGroupMeetingsState['status'], 'ready'>): MeetingGroupMeetingsState {
    return { status, group: null, meetings: [], hasMore: false };
  }
}
