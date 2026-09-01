// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { EntityWithProject, ProjectContext } from '@lfx-one/shared/interfaces';
import { distinctUntilChanged, filter, map, merge } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';

/**
 * Writes the entity's context into the matching slot and re-points the route lens kind at the
 * entity's kind so `activeContext` actually follows it. The kind correction matters
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
 * Default lens decision is URL-prefix based: /foundation/* routes set the foundation context;
 * all other routes (project lens, top-level) set the project context. This prevents the
 * navigation service's default selection from leaving an unrelated project slug active when
 * navigating directly to an entity URL.
 *
 * `preferEntityKind` (opt-in per caller): when the entity carries `is_foundation`
 * (BFF-enriched detail payloads) it chooses setFoundation vs setProject directly AND re-points
 * `routeLensKind` at the entity's kind — the route prefix alone can't distinguish a
 * foundation-owned entity sitting under a /project/* URL (e.g. meeting edit). Off by default:
 * on flat routes that declare no `data.lens` (groups, mailing lists) the pin would move
 * `activeContext` from the persona-resolved selection to the project slot for the life of the
 * page, and an entity kind contradicting the URL prefix would re-point the kind while the URL
 * still reads otherwise — both behavior changes outside this fix's scope.
 *
 * `canonicalizeRoute` (opt-in, requires `preferEntityKind`): once the entity's kind is known
 * and contradicts the URL's leading `/foundation|project` segment, rewrite the URL to the
 * entity's tier so a copied link reflects ownership (GH-1567).
 */
export function syncEntityProjectContext<T extends EntityWithProject>(
  entitySignal: Signal<T | null>,
  projectContextService: ProjectContextService,
  router: Router,
  destroyRef: DestroyRef,
  options?: { preferEntityKind?: boolean; canonicalizeRoute?: boolean }
): void {
  const entityChanges$ = toObservable(entitySignal).pipe(
    distinctUntilChanged((a, b) => a?.uid === b?.uid && a?.project_uid === b?.project_uid && a?.project_slug === b?.project_slug)
  );

  // Query-param-only navigations (e.g. edit-step changes via `?step=N`) don't re-run guards
  // (default `runGuardsAndResolvers: 'paramsChange'`) but still fire NavigationEnd, and
  // MainLayoutComponent.syncLensFromRoute re-asserts the route's *declared* lens kind — clobbering
  // this entity correction when the entity contradicts the route. Re-apply after each
  // navigation while the component lives. Ordering is safe: MainLayout subscribed at bootstrap,
  // so its re-assert runs before this handler on the same NavigationEnd. Re-applying is
  // idempotent — same-value signal writes don't propagate and setProject/setFoundation no-op on
  // an unchanged context.
  const navigationReapply$ = router.events.pipe(
    filter((event) => event instanceof NavigationEnd),
    map(() => entitySignal())
  );

  merge(entityChanges$, navigationReapply$)
    .pipe(
      filter((entity): entity is T & { project_slug: string } => !!entity?.project_uid && !!entity?.project_slug),
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
      if (options?.preferEntityKind) {
        // Prefer the entity's own is_foundation (BFF-enriched) over the URL-prefix heuristic —
        // a foundation-owned entity can sit under a /project/* route (e.g. meeting edit).
        const useFoundation = entity.is_foundation ?? router.url.startsWith('/foundation/');
        applyEntityProjectContext(projectContextService, context, useFoundation, syncUrl);
        if (options?.canonicalizeRoute && entity.is_foundation != null) {
          canonicalizeTierPrefix(router, entity.is_foundation);
        }
      } else if (router.url.startsWith('/foundation/')) {
        projectContextService.setFoundation(context, syncUrl);
      } else {
        projectContextService.setProject(context, syncUrl);
      }
    });
}

// Swaps only the leading tier segment so the URL reflects entity ownership (GH-1567); the
// already-canonical no-op keeps the NavigationEnd re-apply loop-free, replaceUrl keeps history clean.
function canonicalizeTierPrefix(router: Router, isFoundation: boolean): void {
  const url = router.url;
  const isFoundationUrl = url.startsWith('/foundation/');
  const isProjectUrl = url.startsWith('/project/');
  if ((!isFoundationUrl && !isProjectUrl) || isFoundationUrl === isFoundation) {
    return;
  }
  const from = isFoundationUrl ? '/foundation/' : '/project/';
  const to = isFoundation ? '/foundation/' : '/project/';
  router.navigateByUrl(to + url.slice(from.length), { replaceUrl: true });
}
