// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { NO_MEETING_JOIN_LINK } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeRow, MeetingJoinLink } from '@lfx-one/shared/interfaces';
import { buildJoinUrlWithParams, canJoinMeeting } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/** Join flow of the meetings home page, shared by the Next meeting card and the list rows. */
@Injectable({ providedIn: 'root' })
export class MeetingsHomeJoinService {
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly meetingService = inject(MeetingService);

  /** The date is inside its join window, and is not a restricted meeting the viewer is not invited to; re-checked as `now` ticks. */
  public joinable(row: Signal<MeetingHomeRow | null>, now: Signal<Date>): Signal<boolean> {
    return computed(() => {
      now();
      const current = row();
      if (!current || (current.meeting.restricted && !current.meeting.invited)) return false;
      return canJoinMeeting(current.meeting, { occurrence_id: current.occurrenceId ?? '', start_time: current.startTime, duration: current.durationMinutes });
    });
  }

  /** Join link built for the real viewer while impersonating; null until joinable or when unavailable. Call it in an injection context. */
  public joinUrl(row: Signal<MeetingHomeRow | null>, joinable: Signal<boolean>): Signal<string | null> {
    const link = this.joinLink(row, joinable);
    return computed(() => link().url);
  }

  /** Like `joinUrl`, with the reason a request failed. Call it in an injection context. */
  public joinLink(row: Signal<MeetingHomeRow | null>, joinable: Signal<boolean>): Signal<MeetingJoinLink> {
    const request = computed(
      () => {
        const meeting = row()?.meeting;
        if (!meeting || !joinable() || !this.userService.authenticated()) return null;
        // Null while impersonating without a known operator: say so rather than load forever.
        const identity = this.userService.meetingJoinIdentity();
        return { id: meeting.id, password: meeting.password, user: identity?.email ? identity : null };
      },
      { equal: (a, b) => a?.id === b?.id && a?.password === b?.password && a?.user?.email === b?.user?.email && a?.user?.name === b?.user?.name }
    );
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          if (!target) return of(NO_MEETING_JOIN_LINK);
          const user = target.user;
          if (!user) return of({ ...NO_MEETING_JOIN_LINK, error: 'No email to join with' });
          return this.meetingService.getPublicMeetingJoinUrl(target.id, target.password, { email: user.email }).pipe(
            map(
              (response): MeetingJoinLink =>
                response.link
                  ? { ...NO_MEETING_JOIN_LINK, url: buildJoinUrlWithParams(response.link, user) }
                  : { ...NO_MEETING_JOIN_LINK, error: 'Join link unavailable' }
            ),
            catchError((error: HttpErrorResponse) =>
              of({ url: null, error: error?.error?.error || 'Failed to load the join link', code: error?.error?.code ?? null })
            ),
            // Never offer the previous meeting's link while this one loads.
            startWith(NO_MEETING_JOIN_LINK)
          );
        })
      ),
      { initialValue: NO_MEETING_JOIN_LINK }
    );
  }

  /** Opens the join link, or the meeting page's join flow when there is none. */
  public join(meeting: Meeting, url: string | null): void {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void this.router.navigate(['/meetings', meeting.id], { queryParams: meeting.password ? { password: meeting.password } : {} });
  }
}
