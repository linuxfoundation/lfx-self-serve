// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { distinctUntilChanged, filter } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';

interface EntityWithProject {
  uid: string;
  project_uid: string;
  project_slug?: string | null;
  project_name?: string | null;
  foundation_name?: string | null;
}

/**
 * Syncs the active project/foundation context to the owning project of the given
 * entity whenever its data loads or changes. Call once from the component constructor.
 *
 * Mirrors projectQueryParamGuard's lens decision: /foundation/* routes set the
 * foundation context; all other routes (project lens, top-level) set the project
 * context. This prevents the navigation service's default selection from leaving an
 * unrelated project slug active when navigating directly to an entity URL.
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
      distinctUntilChanged((a, b) => a.uid === b.uid),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe((entity) => {
      const context: ProjectContext = {
        uid: entity.project_uid,
        name: entity.project_name || entity.foundation_name || entity.project_slug,
        slug: entity.project_slug,
      };
      if (router.url.startsWith('/foundation/')) {
        projectContextService.setFoundation(context);
      } else {
        projectContextService.setProject(context);
      }
    });
}
