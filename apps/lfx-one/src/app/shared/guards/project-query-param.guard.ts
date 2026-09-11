// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
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
  const declaredKind = routeLens === 'foundation' || routeLens === 'project' ? routeLens : null;

  // Record the route's declared kind up front, before the async project fetch, so a route that
  // declares one (the lens-prefixed routes) has `activeContext` resolving the right slot from the
  // first render. `activeContext` prefers this over the lens, which is clamped against a grant set
  // that only resolves after hydration (LFXV2-2754); without it a deep link onto `/foundation/...`
  // reads the project slot and create flows would build their payload from the wrong project.
  // Writing `null` when the route declares no kind stops a previous route's override from leaking
  // in; the flat write routes (which declare no lens) get their kind from the resolved project
  // below instead — see the `effectiveKind` note.
  projectContextService.setRouteLensKind(declaredKind);

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
      // When the route declares no lens (the flat write routes, e.g. `/meetings/create` reached by
      // a direct URL rather than the lens-prefixed form the dialog redirects to), derive the kind
      // from the project itself. `computeIsFoundation` reads the project's own attributes, so it is
      // independent of the viewer's persona and of the post-hydration grant set — a foundation
      // target lands in the foundation slot even when the active lens is still `me`. Without this,
      // context would fall back to the lens and the create component would build its payload from
      // the wrong slot (the target `writerGuard` authorised via `?project=` would be discarded).
      const effectiveKind = declaredKind ?? (computeIsFoundation(project) ? 'foundation' : 'project');
      if (effectiveKind !== declaredKind) {
        projectContextService.setRouteLensKind(effectiveKind);
      }
      if (effectiveKind === 'foundation') {
        projectContextService.setFoundation(context);
      } else {
        projectContextService.setProject(context);
      }
      return true;
    }),
    catchError(() => of(true))
  );
};
