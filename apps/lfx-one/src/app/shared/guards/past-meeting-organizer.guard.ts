// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { getPastMeetingResourceId } from '@lfx-one/shared/utils';
import { catchError, map, of } from 'rxjs';

import { MeetingService } from '../services/meeting.service';
import { ProjectRecoveryService } from '../services/project-recovery.service';
import { retryTransientHttpError } from '../utils/http-error.utils';

/**
 * Opens the past-meeting admin page (`/meetings/:id/details`) to the meeting's organizers only (N-03,
 * #3265). The outcomes are the ADR's (`meeting-surface-boundary.md` § Who sees what on `/details`):
 *
 * - `organizer` true → the admin page.
 * - `organizer` false → redirect to the public page, `/meetings/:id`, which applies its own
 *   `full_access` tiering.
 * - 400 / 403 / 404 → `/meetings/not-found`, as the public page does.
 * - Any other failure → the retry view in place; the admin page stays closed until the read succeeds.
 *
 * `organizer` comes from the detail read (`GET /api/past-meetings/:uid`), where the BFF works it out
 * with `isPastMeetingOrganizer`, not from a list row. Anonymous viewers never get here: Express sends
 * them to login on the server, and `authGuard`, which runs first, does on the client.
 *
 * A navigation boundary, not the authorization boundary: the BFF and upstream still enforce
 * organizer on every write the page makes.
 */
export const pastMeetingOrganizerGuard: CanActivateFn = (route, state) => {
  const meetingService = inject(MeetingService);
  const projectRecoveryService = inject(ProjectRecoveryService);
  const router = inject(Router);

  const id = route.paramMap.get('id') ?? '';

  return meetingService.getPastMeetingById(id).pipe(
    retryTransientHttpError(),
    map((meeting) => (meeting.organizer ? true : new RedirectCommand(router.createUrlTree(['/meetings', getPastMeetingResourceId(meeting)])))),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && (error.status === 400 || error.status === 403 || error.status === 404)) {
        return of(new RedirectCommand(router.parseUrl('/meetings/not-found')));
      }
      return of(projectRecoveryService.unavailable(state.url));
    })
  );
};
