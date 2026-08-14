// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EntityWithProject, ProjectContext } from '@lfx-one/shared/interfaces';
import { distinctUntilChanged, filter } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';

/**
 * Writes the entity's context into the matching slot and re-points the route lens kind at the
 * entity's kind so `activeContext` actually follows it (gh-1432). The kind correction matters
 * when the entity contradicts the route's declared lens — e.g. a foundation-owned meeting
 * edited under `/project/meetings/:id/edit` (bare `/meetings/:id/edit` links redirect by active
 * lens, not entity kind): `routeLensKind` would otherwise pin `activeContext` to the project
 * slot and writing only the foundation slot would leave the stale context visible. When kinds
 * agree the re-point is a same-value signal write (no propagation), so matching-kind consumers
 * are unaffected.
 */
export function applyEntityProjectContext(
  projectContextService: ProjectContextService,
  context: ProjectContext,
  isFoundation: boolean,
  syncUrl: boolean
): void {
  projectContextService.setRouteLensKind(isFoundation ? 'foundation' : 'project');
  if (isFoundation) {
    projectContextService.setFoundation(context, syncUrl);
  } else {
    projectContextService.setProject(context, syncUrl);
  }
}

/**
 * Syncs the active project/foundation context to the owning project of the given
 * entity whenever its data loads or changes. Call once from the component constructor.
 *
 * Lens decision: when the entity carries `is_foundation` (BFF-enriched detail payloads,
 * gh-1432) it chooses setFoundation vs setProject directly — the route prefix alone can't
 * distinguish a foundation-owned entity sitting under a /project/* URL. When the entity
 * doesn't know, the URL-prefix heuristic is the fallback: /foundation/* routes set the
 * foundation context; all other routes (project lens, top-level) set the project context.
 * Either way this prevents the navigation service's default selection from leaving an
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
      // Prefer the entity's own is_foundation (BFF-enriched) over the URL-prefix heuristic —
      // a foundation-owned entity can sit under a /project/* route (e.g. meeting edit, gh-1432).
      const useFoundation = entity.is_foundation ?? router.url.startsWith('/foundation/');
      applyEntityProjectContext(projectContextService, context, useFoundation, syncUrl);
    });
}
