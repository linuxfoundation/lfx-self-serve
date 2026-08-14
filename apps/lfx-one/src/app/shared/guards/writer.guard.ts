// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
import { COMMITTEE_WRITE_FEATURES } from '@lfx-one/shared/constants';
import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

import { CommitteeService } from '../services/committee.service';
import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Protects create/edit/admin routes that require project write permission.
 *
 * Fast path: ED persona is synchronously allowed (cookie-seeded, no HTTP round-trip).
 * Slow path: evaluates write permission in priority order:
 *
 * 1. `project.writer` — project owner, writer, or inherited parent-project writer.
 * 2. `project.meetingCoordinator` — meeting_coordinator role on the project; accepted
 *    only for routes with `data.writeFeature === 'meetings'`.
 * 3. `committee.writer` — committee writer; accepted only when `committee_uid` is
 *    present in the query params and `writeFeature` is one of `'meetings'`,
 *    `'surveys'`, or `'votes'`. The backend ruleset allows committee:uid#writer to
 *    create resources associated with their committee.
 *
 * Slug resolution: on meeting EDIT routes (`writeFeature: 'meetings'` + `:id/edit`), resolves
 * the slug from the meeting itself first (gh-1432 — the active context can belong to a
 * different project when the edit link carried no `?project=`); otherwise prefers the
 * `?project=` query param (authoritative for the navigation target, works before the lens has
 * synced), then falls back to the active context's slug.
 * Redirects to the lens-appropriate overview on denial so the correct project context is
 * preserved and NavigationService.applyDefaultSelection does not override the selection.
 *
 * On denial, encodes `_notice=<writeFeature>` in the redirect URL instead of calling
 * MessageService directly. AppComponent detects `_notice` on NavigationEnd, shows the
 * contextual "Access Denied" toast, and strips the param via Location.replaceState. This
 * two-step approach works for both SPA navigation and full-page-load (SSR) scenarios where
 * MessageService.add() on the server has no client-side effect.
 *
 * When `project` is `null` (403/404/5xx from the BFF), the committee check is still
 * attempted when `committee_uid` is present — a committee writer may hold their role
 * without having a direct project-level OpenFGA viewer relation. Only if that check also
 * fails or is inapplicable does the guard deny.
 */
export const writerGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const committeeService = inject(CommitteeService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const committeeUid = route.queryParamMap.get('committee_uid') ?? null;

  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  // gh-1432 Bug 2: on a meeting EDIT route, a missing or stale `?project=` means the active
  // context can belong to a different project than the meeting being edited (bare
  // `/meetings/:id/edit` links redirect by active lens and carry no project param). Authorizing
  // against that stale context intermittently denied legitimate organizers — or worse, could
  // authorize against the wrong project. Resolve the slug from the meeting itself first; fall
  // back to the active context when the meeting can't be read (it may simply not exist — the
  // manage component handles that error path).
  const writeFeature: string | undefined = route.data?.['writeFeature'];
  const resolveSlug = (): Observable<string | null> => {
    const fromContext = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;
    if (writeFeature !== 'meetings') {
      return of(fromContext);
    }
    const meetingId = route.paramMap.get('id');
    if (!meetingId || route.routeConfig?.path !== ':id/edit') {
      return of(fromContext);
    }
    // Probe-only: getProjectForMeeting never touches ProjectService's shared `project` state.
    // Pass the meetingCoordinator flag through so the downstream access re-check hits the
    // getProject cache instead of issuing a second project fetch.
    return projectService.getProjectForMeeting(meetingId, { meetingCoordinator: true }).pipe(
      map((project) => project?.slug ?? fromContext),
      catchError(() => of(fromContext))
    );
  };

  return resolveSlug().pipe(
    switchMap((slug) => {
      if (!slug) {
        return of(router.parseUrl(overviewPath));
      }

      const deniedUrl = router.createUrlTree([overviewPath], { queryParams: { project: slug, _notice: writeFeature ?? 'access' } });
      const deny = () => deniedUrl;
      const supportsCommitteeWriter = writeFeature != null && COMMITTEE_WRITE_FEATURES.includes(writeFeature);

      // Committee writers can create meetings, surveys, and votes associated with
      // their committee. Only applicable when committee_uid is in the route query params.
      // CommitteeService.getCommittee has a tap() that sets the committee signal as a
      // side-effect — acceptable here: on deny navigation is blocked before any committee
      // view renders; on allow the committee page overwrites it.
      const checkCommittee = (): Observable<true | ReturnType<typeof deny>> =>
        committeeService.getCommittee(committeeUid!).pipe(
          map((committee) => (committee?.writer === true ? (true as const) : deny())),
          catchError(() => of(deny()))
        );

      return projectService.getProject(slug, false, { meetingCoordinator: writeFeature === 'meetings' }).pipe(
        switchMap((project) => {
          // project === null means the BFF returned 403/404/5xx — could be a real access
          // denial (committee member without a direct project-level OpenFGA viewer relation)
          // or a transient server error. Still attempt the committee check when applicable so
          // a committee writer is not incorrectly denied solely because the project fetch
          // failed. If no committee check is applicable, deny with feedback.
          if (project === null) {
            return committeeUid && supportsCommitteeWriter ? checkCommittee() : of(deny());
          }
          if (project.writer === true) {
            return of(true as const);
          }
          // meeting_coordinator can create meetings but not other write features
          if (writeFeature === 'meetings' && project.meetingCoordinator === true) {
            return of(true as const);
          }
          if (committeeUid && supportsCommitteeWriter) {
            return checkCommittee();
          }
          return of(deny());
        })
      );
    })
  );
};
