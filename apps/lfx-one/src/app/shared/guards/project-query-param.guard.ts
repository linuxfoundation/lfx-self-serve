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
  const slug = route.queryParamMap.get('project');
  if (!slug) return true;

  const projectService = inject(ProjectService);
  const projectContextService = inject(ProjectContextService);

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
      if (route.data['lens'] === 'foundation') {
        projectContextService.setFoundation(context);
      } else {
        projectContextService.setProject(context);
      }
      return true;
    }),
    catchError(() => of(true))
  );
};
