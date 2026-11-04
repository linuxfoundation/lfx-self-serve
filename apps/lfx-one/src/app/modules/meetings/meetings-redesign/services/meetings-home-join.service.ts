// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Meeting, MeetingHomeRow } from '@lfx-one/shared/interfaces';
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
    const request = computed(
      () => {
        const meeting = row()?.meeting;
        if (!meeting || !joinable() || !this.userService.authenticated()) return null;
        const user = this.userService.meetingJoinIdentity();
        if (!user?.email) return null;
        return { id: meeting.id, password: meeting.password, user };
      },
      { equal: (a, b) => a?.id === b?.id && a?.password === b?.password && a?.user.email === b?.user.email && a?.user.name === b?.user.name }
    );
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) =>
          target
            ? this.meetingService.getPublicMeetingJoinUrl(target.id, target.password, { email: target.user.email }).pipe(
                map((response) => buildJoinUrlWithParams(response.link, target.user)),
                catchError(() => of(null)),
                // Never offer the previous meeting's link while this one loads.
                startWith(null)
              )
            : of(null)
        )
      ),
      { initialValue: null }
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
