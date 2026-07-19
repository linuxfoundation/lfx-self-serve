// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { catchError, map, of } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Seeds the active project/foundation context from a `?project=<slug>` query param.
 * Returns true in all branches — this guard sets context, not access control.
 * If the slug is missing, invalid, or resolves to nothing, navigation continues normally
 * and NavigationService.applyDefaultSelection handles the fallback selection.
 */
export const projectQueryParamGuard: CanActivateFn = (route) => {
  const projectService = inject(ProjectService);
  const projectContextService = inject(ProjectContextService);

  const routeLens = route.data['lens'];
  const routeKind = routeLens === 'foundation' || routeLens === 'project' ? routeLens : null;

  // Record the route's declared kind before anything else, on every navigation this guard runs for
  // — including the no-slug early return below. `activeContext` prefers this over the lens, which
  // is clamped against a grant set that only resolves after hydration (LFXV2-2754); without it a
  // deep link onto `/foundation/...` reads the project slot and create flows would build their
  // payload from the wrong project. Writing `null` when the route declares no kind is what stops a
  // previous route's override from leaking into this one.
  projectContextService.setRouteLensKind(routeKind);

  const slug = route.queryParamMap.get('project');
  if (!slug) return true;

  return projectService.getProject(slug, false).pipe(
    map((project) => {
      if (!project) return true;
      const context: ProjectContext = {
        uid: project.uid,
        name: project.name,
        slug: project.slug,
        parent_uid: project.parent_uid,
        logoUrl: project.logo_url,
      };
      if (routeKind === 'foundation') {
        projectContextService.setFoundation(context);
      } else {
        projectContextService.setProject(context);
      }
      return true;
    }),
    catchError(() => of(true))
  );
};
