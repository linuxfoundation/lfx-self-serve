// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EntityWithProject, ProjectContext } from '@lfx-one/shared/interfaces';
import { distinctUntilChanged, filter } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';

/**
 * Syncs the active project/foundation context to the owning project of the given
 * entity whenever its data loads or changes. Call once from the component constructor.
 *
 * Lens decision is URL-prefix based: /foundation/* routes set the foundation context;
 * all other routes (project lens, top-level) set the project context. This prevents
 * the navigation service's default selection from leaving an unrelated project slug
 * active when navigating directly to an entity URL.
 */
export function syncEntityProjectContext<T extends EntityWithProject>(
  entitySignal: Signal<T | null>,
  projectContextService: ProjectContextService,
  router: Router,
  destroyRef: DestroyRef
): void {
  toObservable(entitySignal)
    .pipe(
      filter((entity): entity is T & { project_slug: string } => !!entity?.project_uid && !!entity?.project_slug),
      distinctUntilChanged((a, b) => a.uid === b.uid && a.project_uid === b.project_uid && a.project_slug === b.project_slug),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe((entity) => {
      const context: ProjectContext = {
        uid: entity.project_uid,
        name: entity.project_name || entity.foundation_name || entity.project_slug,
        slug: entity.project_slug,
      };
      // Only write ?project= to the URL if it was already present — mirrors the same
      // guard in NavigationService.applyDefaultSelection() to prevent injecting a wrong
      // project slug into entity-specific deep-link URLs (e.g. /project/groups/:id).
      const syncUrl = 'project' in router.parseUrl(router.url).queryParams;
      if (router.url.startsWith('/foundation/')) {
        projectContextService.setFoundation(context, syncUrl);
      } else {
        projectContextService.setProject(context, syncUrl);
      }
    });
}
