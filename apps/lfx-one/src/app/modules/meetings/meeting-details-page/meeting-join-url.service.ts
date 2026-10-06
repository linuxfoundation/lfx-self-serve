// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MeetingJoinUrlState } from '@lfx-one/shared/interfaces';
import { isHttpUrl } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { catchError, map, Observable, of, startWith } from 'rxjs';

/**
 * Fetches a meeting's join link for the V2 page (E2-01, E2-06), for both the signed-in Join control
 * and the guest form, so the two read the BFF's answer the same way.
 * @description The request is V1's: `getPublicMeetingJoinUrl` with the meeting password and the
 * email to match against the registrants. Only an absolute http(s) link reaches `ready`, since the
 * link is bound to an anchor and may be passed to `window.open`. Errors carry the BFF's message and
 * code (e.g. `NOT_REGISTERED_FOR_MEETING`). `url` is the bare link: each caller adds its own Zoom
 * display-name params with `buildJoinUrlWithParams`.
 */
@Injectable({ providedIn: 'root' })
export class MeetingJoinUrlService {
  private readonly meetingService = inject(MeetingService);

  /** Emits `loading`, then `ready` with the link or `error`. */
  public fetch(meetingId: string, password: string | null, email: string): Observable<MeetingJoinUrlState> {
    return this.meetingService.getPublicMeetingJoinUrl(meetingId, password, { email }).pipe(
      map((res): MeetingJoinUrlState => {
        if (!res.link || !isHttpUrl(res.link, true)) {
          return { status: 'error', error: 'Failed to load meeting join URL. Please try again.' };
        }
        return { status: 'ready', url: res.link };
      }),
      catchError((error) =>
        of<MeetingJoinUrlState>({
          status: 'error',
          error: error?.error?.error || 'Failed to load meeting join URL. Please try again.',
          code: error?.error?.code ?? null,
        })
      ),
      startWith<MeetingJoinUrlState>({ status: 'loading' })
    );
  }
}
