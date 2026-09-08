// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { EntityWithProject, ProjectContext } from '@lfx-one/shared/interfaces';
import { computeIsFoundation, isSameProjectContext } from '@lfx-one/shared/utils';
import { catchError, distinctUntilChanged, filter, map, merge, Observable, of, switchMap } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

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
          canonicalizeTierPrefix(router, entity.is_foundation, entity.project_slug);
        }
      } else if (router.url.startsWith('/foundation/')) {
        projectContextService.setFoundation(context, syncUrl);
      } else {
        projectContextService.setProject(context, syncUrl);
      }
    });
}

/**
 * Route-carried-project reconciliation for entity pages whose URL carries the owning project
 * as a `:projectUid` route param (newsletter edit/analytics, GH-1570) rather than inside the
 * entity payload. The URL is authoritative for the page's fetches, but page chrome (name/logo,
 * sidebar) follows `activeContext()`, which a stale cookie-restored context can leave pointing
 * at a different project. Resolve the route project by uid and re-point the context via
 * applyEntityProjectContext — the uid-only variant of the entity-signal syncs above, for routes
 * with no enriched entity payload.
 *
 * Two triggers:
 *  - Route-uid changes resolve at least once per activation, even when the active context's uid
 *    already matches: a uid-equal cookie context can still carry a stale name/logo/slug or sit
 *    under the wrong context kind (a foundation-owned newsletter under /project/newsletters), so
 *    the write below only suppresses once the FULL context (isSameProjectContext), the
 *    computed kind, and the URL's ?project= all agree. The resolve hits the shareReplay-cached
 *    getProject — the route's
 *    guard already resolved the same uid on activation — so the happy path costs no request.
 *  - NavigationEnd re-applies synchronously from the per-uid resolved cache: query-param-only
 *    navigations (?step=N) don't re-run guards, but MainLayout.syncLensFromRoute re-asserts the
 *    route's DECLARED lens kind on every navigation, clobbering this correction when the route
 *    project contradicts the URL lens. Ordering is safe (MainLayout subscribed at bootstrap, so
 *    its re-assert runs first on the same NavigationEnd), and applying before change detection
 *    runs means chrome never renders the stale context — a post-hoc signal self-heal would
 *    flash the wrong project for a frame per step change.
 *
 * Call once from the component constructor (injection context is required for toObservable).
 * A failed uid lookup resolves null (relation-gated `getProject(uid, false)`) and leaves the
 * existing context untouched — legacy behavior, same degradation philosophy as the fallback sync.
 */
export function reconcileRouteProjectContext(
  routeProjectUid: Signal<string | null>,
  projectService: ProjectService,
  projectContextService: ProjectContextService,
  router: Router,
  destroyRef: DestroyRef
): void {
  // Resolved route projects by uid: populated on first resolve, read by NavigationEnd re-applies
  // so they run synchronously (pre-change-detection) instead of healing a frame late.
  const resolvedCache = new Map<string, { context: ProjectContext; isFoundation: boolean }>();

  const routeProjectChange$ = toObservable(routeProjectUid).pipe(distinctUntilChanged());
  const navigationReapply$ = router.events.pipe(
    filter((event) => event instanceof NavigationEnd),
    map(() => routeProjectUid())
  );

  merge(routeProjectChange$, navigationReapply$)
    .pipe(
      filter((uid): uid is string => !!uid),
      switchMap((uid) => {
        const cached = resolvedCache.get(uid);
        if (cached) {
          return of(cached);
        }
        return projectService.getProject(uid, false).pipe(
          map((project) => {
            // null = deleted/unknown project (or no viewer relation) — keep the
            // existing context rather than erroring the page.
            if (!project) return null;
            const resolved = {
              context: {
                uid: project.uid,
                name: project.name,
                slug: project.slug,
                parent_uid: project.parent_uid,
                logoUrl: project.logo_url,
              },
              isFoundation: computeIsFoundation(project),
            };
            resolvedCache.set(uid, resolved);
            return resolved;
          })
        );
      }),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe((resolved) => {
      if (!resolved) return;
      // Suppress the repeat only once the FULL context (isSameProjectContext compares
      // name/slug/logoUrl, not just uid), the computed kind, AND the URL all agree — a uid-equal
      // cookie context can still carry stale chrome or sit under the wrong kind, and a stale
      // ?project= must still fall through so it gets repaired: suppressing on context alone
      // would leave the old slug in the URL for the session. The repair can't land
      // synchronously, though — syncProjectQueryParam skips while a navigation is in flight,
      // and Angular only clears currentNavigation in the navigation stream's finalize, AFTER
      // NavigationEnd subscribers run — so both the activation apply and this re-apply see the
      // URL sync suppressed. The actual repair is deferred to a microtask below.
      const urlParams = router.parseUrl(router.url).queryParams;
      const urlAgrees = !('project' in urlParams) || urlParams['project'] === resolved.context.slug;
      if (
        projectContextService.activeRouteLensKind() === (resolved.isFoundation ? 'foundation' : 'project') &&
        isSameProjectContext(projectContextService.activeContext(), resolved.context) &&
        urlAgrees
      ) {
        return;
      }
      // Mirror syncEntityProjectContext: only write ?project= to the URL when already present.
      const syncUrl = 'project' in urlParams;
      applyEntityProjectContext(projectContextService, resolved.context, resolved.isFoundation, syncUrl);
      // The apply above corrects the context synchronously (pre-change-detection), but its URL
      // sync is suppressed while a navigation is in flight — and this re-apply is itself still
      // inside the navigation (currentNavigation clears in the stream's finalize, after
      // NavigationEnd subscribers run). Defer the URL repair to a microtask: it runs after the
      // finalizer, when getCurrentNavigation() is null and the re-invoked setter's URL sync can
      // land (setProject/setFoundation run it outside the same-context early return, so the
      // context re-writes are same-value no-ops and only the ?project= repair takes effect).
      if (syncUrl && !urlAgrees && router.getCurrentNavigation()) {
        queueMicrotask(() => {
          // A newer navigation owns the URL now — skip; its own re-apply re-queues the repair.
          if (router.getCurrentNavigation()) return;
          applyEntityProjectContext(projectContextService, resolved.context, resolved.isFoundation, true);
        });
      }
    });
}

// Swaps only the leading tier segment so the URL reflects entity ownership (GH-1567); the
// already-canonical no-op keeps the NavigationEnd re-apply loop-free, replaceUrl keeps history clean.
export function canonicalizeTierPrefix(router: Router, isFoundation: boolean, projectSlug: string): void {
  const url = router.url;
  const isFoundationUrl = url.startsWith('/foundation/');
  const isProjectUrl = url.startsWith('/project/');
  if ((!isFoundationUrl && !isProjectUrl) || isFoundationUrl === isFoundation) {
    return;
  }
  const from = isFoundationUrl ? '/foundation/' : '/project/';
  const to = isFoundation ? '/foundation/' : '/project/';
  const urlTree = router.parseUrl(to + url.slice(from.length));
  // router.url still carries the pre-sync ?project= (the Location.replaceState sync bypasses the
  // router) — pin the entity's slug so projectQueryParamGuard reseeds the right project.
  if ('project' in urlTree.queryParams) {
    urlTree.queryParams['project'] = projectSlug;
  }
  router.navigateByUrl(urlTree, { replaceUrl: true });
}

/**
 * Fallback companion to {@link syncEntityProjectContext} for entities whose payload lacks
 * `project_slug` (BFF enrichment failure): resolves the project by uid and applies it, re-applied
 * on every NavigationEnd (query-param step navigations re-assert the route's declared lens kind
 * without re-running guards).
 *
 * `getProject(uid, false)` is relation-gated: when it resolves null for a caller without a viewer
 * relation, `options.freshFetch` (when provided) re-fetches the entity detail uncached — the
 * ungated detail enrichment can carry the slug the lookup withheld. Each uid gets one fresh
 * attempt; transient failures release it so a later NavigationEnd retries. Fresh-fetch resolutions
 * are cached per uid because the entity signal's payload never changes — without the cache the
 * once-only retry guard would swallow the NavigationEnd re-apply and MainLayout's route-lens
 * re-assert would clobber the resolved context.
 *
 * `canonicalizeRoute` mirrors the syncEntityProjectContext option: rewrite a wrong-tier URL to the
 * resolved context's tier after applying it.
 */
export function syncEntityProjectContextFallback<T extends EntityWithProject>(
  entitySignal: Signal<T | null>,
  projectService: ProjectService,
  projectContextService: ProjectContextService,
  router: Router,
  destroyRef: DestroyRef,
  options?: {
    entityKind?: string;
    freshFetch?: (uid: string) => Observable<Pick<EntityWithProject, 'project_uid' | 'project_slug' | 'project_name' | 'is_foundation'> | null>;
    canonicalizeRoute?: boolean;
  }
): void {
  const freshFetchRetried = new Set<string>();
  const resolvedCache = new Map<string, { context: ProjectContext; isFoundation: boolean }>();

  // Last resort when the relation-gated project lookup returns null: the ungated detail
  // enrichment can supply the project the lookup withheld. Emits null when it can't.
  const resolveFromFreshFetch = (entity: EntityWithProject): Observable<{ context: ProjectContext; isFoundation: boolean } | null> => {
    const freshFetch = options?.freshFetch;
    if (!freshFetch || freshFetchRetried.has(entity.uid)) {
      return of(null);
    }
    freshFetchRetried.add(entity.uid);
    return freshFetch(entity.uid).pipe(
      map((fresh) => {
        if (!fresh?.project_slug) {
          console.warn(`Unable to resolve project context for ${options?.entityKind ?? 'entity'} ${entity.uid}: detail payload carries no project_slug`);
          return null;
        }
        const resolved = {
          context: { uid: fresh.project_uid, name: fresh.project_name || fresh.project_slug, slug: fresh.project_slug },
          isFoundation: fresh.is_foundation === true,
        };
        resolvedCache.set(entity.uid, resolved);
        return resolved;
      }),
      catchError((error) => {
        // Transient failures (network, 5xx) shouldn't burn the retry — release the uid so a later
        // NavigationEnd re-apply can attempt the fresh fetch again.
        freshFetchRetried.delete(entity.uid);
        console.warn(`Unable to resolve project context for ${options?.entityKind ?? 'entity'} ${entity.uid}:`, error);
        return of(null);
      })
    );
  };

  const unresolvedEntity$ = toObservable(entitySignal).pipe(distinctUntilChanged((a, b) => a?.uid === b?.uid && a?.project_uid === b?.project_uid));
  const navigationReapply$ = router.events.pipe(
    filter((event) => event instanceof NavigationEnd),
    map(() => entitySignal())
  );

  merge(unresolvedEntity$, navigationReapply$)
    .pipe(
      filter((entity): entity is T => !!entity?.project_uid && !entity.project_slug),
      switchMap((entity) => {
        const cached = resolvedCache.get(entity.uid);
        if (cached) {
          return of(cached);
        }
        // `current: false` so the fetch doesn't clobber ProjectService's shared `project` state;
        // null on failure leaves the (stale) context untouched rather than erroring the page.
        return projectService.getProject(entity.project_uid, false).pipe(
          switchMap((project) => {
            if (!project) {
              return resolveFromFreshFetch(entity);
            }
            const context: ProjectContext = { uid: project.uid, name: project.name, slug: project.slug };
            return of({ context, isFoundation: computeIsFoundation(project) });
          })
        );
      }),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe((resolved) => {
      if (!resolved) {
        return;
      }
      // Mirror syncEntityProjectContext: only write ?project= to the URL when already present.
      const syncUrl = 'project' in router.parseUrl(router.url).queryParams;
      applyEntityProjectContext(projectContextService, resolved.context, resolved.isFoundation, syncUrl);
      if (options?.canonicalizeRoute) {
        canonicalizeTierPrefix(router, resolved.isFoundation, resolved.context.slug);
      }
    });
}
