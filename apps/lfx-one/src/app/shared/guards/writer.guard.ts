// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { map } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

const WRITE_FEATURE_MESSAGES: Record<string, string> = {
  meetings: "You don't have permission to schedule meetings for this project.",
  'mailing-lists': "You don't have permission to manage mailing lists for this project.",
  votes: "You don't have permission to manage votes for this project.",
  surveys: "You don't have permission to manage surveys for this project.",
  committees: "You don't have permission to manage committees for this project.",
};

/**
 * Protects create/edit/admin routes that require project write permission.
 *
 * Fast path: ED persona is synchronously allowed (cookie-seeded, no HTTP round-trip).
 * Slow path: fetches the project and evaluates write permission server-side via the
 * FGA-driven authorization check. Two fields drive the decision:
 *
 * - `project.writer` — covers project owner, project writer, and inherited parent-project writers.
 * - `project.meetingCoordinator` — covers the meeting_coordinator role, which is granted the
 *   ability to create meetings but not other write features (votes, surveys, mailing lists,
 *   committees). Only routes with `data.writeFeature === 'meetings'` accept this role.
 *
 * Slug resolution: prefers the `?project=` query param (authoritative for the navigation
 * target, works before the lens has synced) then falls back to the active context's slug.
 * Redirects to the lens-appropriate overview on denial so the correct project context is
 * preserved and NavigationService.applyDefaultSelection does not override the selection.
 *
 * On denial, shows a warning toast. Routes opt into a contextual message by setting
 * `data.writeFeature` (e.g. `'meetings'`, `'votes'`); falls back to a generic message
 * when absent.
 */
export const writerGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const messageService = inject(MessageService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const slug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

  // Use the lens encoded in the route ancestry (parent route carries data.lens) so the
  // denied redirect lands on the same lens the user was navigating within, preventing
  // NavigationService.applyDefaultSelection from overriding the project when it does not
  // appear in the foundation items list.
  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  if (!slug) {
    return router.parseUrl(overviewPath);
  }
  const deniedUrl = router.createUrlTree([overviewPath], { queryParams: { project: slug } });

  const writeFeature: string | undefined = route.data?.['writeFeature'];
  const deniedMessage = (writeFeature && WRITE_FEATURE_MESSAGES[writeFeature]) ?? "You don't have permission to perform this action for this project.";

  return projectService.getProject(slug, false).pipe(
    map((project) => {
      const isWriter = project?.writer === true;
      // meeting_coordinator can create meetings but not other write features
      const isMeetingCoordinator = writeFeature === 'meetings' && project?.meetingCoordinator === true;
      if (!isWriter && !isMeetingCoordinator) {
        messageService.add({
          severity: 'warn',
          summary: 'Access Denied',
          detail: deniedMessage,
        });
        return deniedUrl;
      }
      return true;
    })
  );
};
