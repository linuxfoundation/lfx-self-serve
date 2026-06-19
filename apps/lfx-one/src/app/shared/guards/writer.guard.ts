// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';

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
 *    present in the query params and `writeFeature === 'meetings'`. The backend ruleset
 *    allows committee:uid#writer to create meetings associated with their committee
 *    (POST /itx/meetings when the request body includes a committee).
 *
 * Slug resolution: prefers the `?project=` query param (authoritative for the navigation
 * target, works before the lens has synced) then falls back to the active context's slug.
 * Redirects to the lens-appropriate overview on denial so the correct project context is
 * preserved and NavigationService.applyDefaultSelection does not override the selection.
 *
 * On denial, encodes `_notice=<writeFeature>` in the redirect URL instead of calling
 * MessageService directly. AppComponent detects `_notice` on NavigationEnd, shows the
 * contextual "Access Denied" toast, and strips the param via Location.replaceState. This
 * two-step approach works for both SPA navigation and full-page-load (SSR) scenarios where
 * MessageService.add() on the server has no client-side effect.
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

  const slug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;
  const committeeUid = route.queryParamMap.get('committee_uid') ?? null;

  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  if (!slug) {
    return router.parseUrl(overviewPath);
  }

  const writeFeature: string | undefined = route.data?.['writeFeature'];
  const deniedUrl = router.createUrlTree([overviewPath], { queryParams: { project: slug, _notice: writeFeature ?? 'access' } });
  const deny = () => deniedUrl;

  return projectService.getProject(slug, false, { meetingCoordinator: writeFeature === 'meetings' }).pipe(
    switchMap((project) => {
      // null means the project was unreachable or the user lacks viewer access — treat as
      // a denial so they get feedback. Silent redirect was confusing for committee members
      // who have committee access but no direct project-level OpenFGA relation.
      if (project === null) {
        return of(deny());
      }
      if (project.writer === true) {
        return of(true as const);
      }
      // meeting_coordinator can create meetings but not other write features
      if (writeFeature === 'meetings' && project.meetingCoordinator === true) {
        return of(true as const);
      }
      // Committee writers can create meetings associated with their committee.
      // Only applicable when a committee_uid is present in the route query params
      // (set by committee-meetings.component's createMeetingQueryParams()).
      // Note: CommitteeService.getCommittee has a tap() that sets the committee signal
      // as a side-effect. This is acceptable here — on deny the navigation is blocked
      // before any committee view renders; on allow the committee page overwrites it.
      if (committeeUid && writeFeature === 'meetings') {
        return committeeService.getCommittee(committeeUid).pipe(
          map((committee) => (committee?.writer === true ? (true as const) : deny())),
          catchError(() => of(deny()))
        );
      }
      return of(deny());
    })
  );
};
