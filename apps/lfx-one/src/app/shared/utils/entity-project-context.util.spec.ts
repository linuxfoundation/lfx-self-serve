// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, computed, DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import { EntityWithProject, Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileRouteProjectContext, syncEntityProjectContextFallback } from './entity-project-context.util';

// Regression coverage for the GH-1570 route-param reconciliation's NavigationEnd re-apply
// (PR #2224 review): a query-param-only navigation (?step=N on the newsletter edit stepper)
// doesn't re-run guards, but MainLayoutComponent.syncLensFromRoute re-asserts the route's
// DECLARED lens kind on every NavigationEnd — clobbering the correction for a foundation-owned
// newsletter sitting under /project/newsletters/:projectUid/... The re-apply must restore the
// resolved context synchronously from the per-uid cache (no second fetch) and stay a same-value
// no-op once kind + full context already match (loop guard). Mirrors the fallback-path coverage
// in vote-manage.component.spec.ts.
describe('reconcileRouteProjectContext', () => {
  const ROUTE_UID = 'foundation-uid-1';
  const EDIT_URL = `/project/newsletters/${ROUTE_UID}/n-1/edit`;

  // computeIsFoundation: Funded + Membership + Active, and not an Internal Allocation.
  const foundationProject = {
    uid: ROUTE_UID,
    name: 'Test Foundation',
    slug: 'test-foundation',
    parent_uid: '',
    logo_url: '',
    stage: ProjectStage.Active,
    funding: ProjectFunding.Funded,
    funding_model: ['Membership'],
    legal_entity_type: 'Series LLC',
  } as Project;

  // The context shape reconcileRouteProjectContext builds from the resolved project.
  const resolvedContext: ProjectContext = {
    uid: ROUTE_UID,
    name: 'Test Foundation',
    slug: 'test-foundation',
    parent_uid: '',
    logoUrl: '',
  };

  let routeProjectUid: ReturnType<typeof signal<string | null>>;
  let routerEvents$: Subject<NavigationEnd>;
  let getProjectStrict: ReturnType<typeof vi.fn>;
  let setRouteLensKind: ReturnType<typeof vi.fn>;
  let setFoundation: ReturnType<typeof vi.fn>;
  let setProject: ReturnType<typeof vi.fn>;
  let routeLensKind: ReturnType<typeof signal<'foundation' | 'project' | null>>;
  let foundationSlot: ReturnType<typeof signal<ProjectContext | null>>;
  let projectContextService: ProjectContextService;

  const start = (): void => {
    TestBed.runInInjectionContext(() =>
      reconcileRouteProjectContext(
        routeProjectUid.asReadonly(),
        { getProjectStrict } as unknown as ProjectService,
        projectContextService,
        router,
        inject(DestroyRef)
      )
    );
  };

  const stable = (): Promise<void> => TestBed.inject(ApplicationRef).whenStable();

  const emitStepNavigation = async (step: number): Promise<void> => {
    routerEvents$.next(new NavigationEnd(1, `${EDIT_URL}?step=${step}`, `${EDIT_URL}?step=${step}`));
    await stable();
  };

  let router: Router;

  beforeEach(() => {
    routeProjectUid = signal<string | null>(ROUTE_UID);
    routerEvents$ = new Subject<NavigationEnd>();
    getProjectStrict = vi.fn().mockReturnValue(of(foundationProject));

    // Mini ProjectContextService: the two context slots + the route-kind override, composed the
    // way the real service composes activeContext from them — so a MainLayout-style re-assert
    // (routeLensKind back to the route's declared 'project') visibly flips activeContext back
    // to the stale cookie-restored project, exactly what the re-apply must undo.
    routeLensKind = signal<'foundation' | 'project' | null>('project');
    const projectSlot = signal<ProjectContext | null>({ uid: 'other-uid', name: 'Other Project', slug: 'other-project' });
    foundationSlot = signal<ProjectContext | null>(null);
    setRouteLensKind = vi.fn((kind: 'foundation' | 'project' | null) => routeLensKind.set(kind));
    setFoundation = vi.fn((context: ProjectContext) => foundationSlot.set(context));
    setProject = vi.fn((context: ProjectContext) => projectSlot.set(context));
    projectContextService = {
      activeRouteLensKind: computed(() => routeLensKind()),
      activeContext: computed(() => (routeLensKind() === 'foundation' ? foundationSlot() : projectSlot())),
      setRouteLensKind,
      setFoundation,
      setProject,
    } as unknown as ProjectContextService;

    // parseUrl returns no query params: the URL carries no ?project= to reseed (syncUrl=false).
    router = {
      events: routerEvents$.asObservable(),
      url: EDIT_URL,
      parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
    } as unknown as Router;

    TestBed.configureTestingModule({});
  });

  it('resolves the route project on activation and re-points the lens kind at its tier', async () => {
    start();
    await stable();

    expect(getProjectStrict).toHaveBeenCalledWith(ROUTE_UID);
    expect(setRouteLensKind).toHaveBeenCalledWith('foundation');
    expect(setFoundation).toHaveBeenCalledWith(resolvedContext, false);
    expect(setProject).not.toHaveBeenCalled();
    expect(projectContextService.activeContext()).toEqual(resolvedContext);
  });

  it('refreshes a matching-kind context carrying the route uid but stale name/slug/logo', async () => {
    // Cookie-restored contexts can drift from the backend while keeping the right uid. The
    // activation write only suppresses on a FULL context match (isSameProjectContext) — a
    // uid-only regression would short-circuit here and leave the stale name/logo in the chrome.
    routeLensKind.set('foundation');
    foundationSlot.set({ uid: ROUTE_UID, name: 'Stale Foundation', slug: 'stale-foundation', logoUrl: 'https://stale.example/logo.png' });

    start();
    await stable();

    expect(getProjectStrict).toHaveBeenCalledWith(ROUTE_UID);
    expect(setFoundation).toHaveBeenCalledWith(resolvedContext, false);
    expect(projectContextService.activeContext()).toEqual(resolvedContext);
  });

  it('re-applies the cached context on a later NavigationEnd after the route-lens re-assert clobbers it, without a second fetch', async () => {
    start();
    await stable();
    expect(getProjectStrict).toHaveBeenCalledTimes(1);

    // A ?step= navigation doesn't re-run guards, but MainLayout.syncLensFromRoute re-asserts the
    // route's declared lens on the NavigationEnd — flipping the selector/sidebar back to the
    // stale cookie project if the cached re-apply regresses.
    routeLensKind.set('project');
    await emitStepNavigation(1);

    expect(getProjectStrict).toHaveBeenCalledTimes(1);
    expect(setFoundation).toHaveBeenCalledTimes(2);
    expect(setRouteLensKind).toHaveBeenLastCalledWith('foundation');
    expect(projectContextService.activeContext()).toEqual(resolvedContext);
  });

  it('suppresses the re-apply once kind and full context already match (loop guard)', async () => {
    start();
    await stable();

    await emitStepNavigation(1);

    // Kind and context already agree with the resolution — the NavigationEnd is a same-value
    // no-op: no re-write and no second fetch.
    expect(getProjectStrict).toHaveBeenCalledTimes(1);
    expect(setFoundation).toHaveBeenCalledTimes(1);
    expect(setRouteLensKind).toHaveBeenCalledTimes(1);
  });

  it('defers the stale ?project= repair past navigation finalization, then re-applies with the URL sync', async () => {
    // A deep link carrying a stale slug from a prior selection: syncUrl=true (param present),
    // urlAgrees=false (stale) — the activation apply corrects the context but syncProjectQueryParam
    // no-ops while a navigation is in flight, and Angular only clears currentNavigation in the
    // navigation stream's finalize (after NavigationEnd subscribers run), so the re-apply can't
    // repair the URL synchronously either. The repair must re-fire from a microtask once the
    // navigation has finalized (PR #2224 review: Cursor Bugbot + Copilot).
    router.parseUrl = vi.fn().mockReturnValue({ queryParams: { project: 'stale-slug' } });
    // Model Angular's finalize: the apply's check runs during the NavigationEnd dispatch
    // (navigation still set — cleared only in the stream's finalize, after subscribers run);
    // the deferred repair's check runs post-finalization (null).
    let navChecks = 0;
    router.getCurrentNavigation = vi.fn(() => (++navChecks === 1 ? ({ id: 1 } as unknown as ReturnType<Router['getCurrentNavigation']>) : null));

    start();
    await stable();

    // Without the deferred repair the activation apply is the ONLY write (and its URL sync is
    // suppressed); with it, a second same-value apply lands post-finalization with syncUrl=true.
    expect(setFoundation).toHaveBeenCalledTimes(2);
    expect(setFoundation).toHaveBeenLastCalledWith(resolvedContext, true);
  });

  it('leaves the existing context untouched when the route project lookup fails', async () => {
    getProjectStrict.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    start();
    await stable();

    // Deleted/unknown project (or no viewer relation): fail-open, no writes — the stale context
    // stays rather than erroring the page.
    expect(getProjectStrict).toHaveBeenCalledWith(ROUTE_UID);
    expect(setRouteLensKind).not.toHaveBeenCalled();
    expect(setFoundation).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
    expect(projectContextService.activeContext()?.slug).toBe('other-project');
  });
});

/**
 * The fallback resolver outliving the thing it was asked about. Every host that mounts it clears
 * its entity on the way out - the meeting composer nulls `meetingEntityContext` when the drawer
 * closes, list pages null theirs on navigation - and the lookup it kicked off is a page-context
 * write waiting to happen. A resolution landing after that point repoints the chrome to a project
 * the organizer already walked away from, with nothing on screen explaining why.
 */
describe('syncEntityProjectContextFallback - a lookup outliving its entity', () => {
  const ENTITY_UID = 'meeting-1';
  const PROJECT_UID = 'project-1';

  // Unresolved on purpose: project_uid present, project_slug missing - the exact shape that sends
  // the helper looking the project up instead of applying it straight from the payload.
  const unresolvedEntity: EntityWithProject = { uid: ENTITY_UID, project_uid: PROJECT_UID };

  const resolvedProject = {
    uid: PROJECT_UID,
    name: 'Test Project',
    slug: 'test-project',
    parent_uid: '',
    logo_url: '',
    stage: ProjectStage.Active,
    funding: ProjectFunding.Unfunded,
    funding_model: [],
    legal_entity_type: '',
  } as unknown as Project;

  let entity: ReturnType<typeof signal<EntityWithProject | null>>;
  let lookup: Subject<Project | null>;
  let getProject: ReturnType<typeof vi.fn>;
  let freshFetch: ReturnType<typeof vi.fn>;
  let freshLookup: Subject<Pick<EntityWithProject, 'project_uid' | 'project_slug' | 'project_name' | 'is_foundation'> | null>;
  let setRouteLensKindSpy: ReturnType<typeof vi.fn>;
  let setProjectSpy: ReturnType<typeof vi.fn>;
  let setFoundationSpy: ReturnType<typeof vi.fn>;
  let fallbackRouter: Router;
  let contextService: ProjectContextService;

  const settle = (): Promise<void> => TestBed.inject(ApplicationRef).whenStable();

  const startFallback = (options?: { withFreshFetch?: boolean }): void => {
    TestBed.runInInjectionContext(() =>
      syncEntityProjectContextFallback(
        entity.asReadonly(),
        { getProject } as unknown as ProjectService,
        contextService,
        fallbackRouter,
        inject(DestroyRef),
        options?.withFreshFetch ? { entityKind: 'meeting', freshFetch } : undefined
      )
    );
  };

  beforeEach(() => {
    entity = signal<EntityWithProject | null>(unresolvedEntity);
    lookup = new Subject<Project | null>();
    getProject = vi.fn().mockReturnValue(lookup);
    freshLookup = new Subject<Pick<EntityWithProject, 'project_uid' | 'project_slug' | 'project_name' | 'is_foundation'> | null>();
    freshFetch = vi.fn().mockReturnValue(freshLookup);
    setRouteLensKindSpy = vi.fn();
    setProjectSpy = vi.fn();
    setFoundationSpy = vi.fn();
    contextService = {
      setRouteLensKind: setRouteLensKindSpy,
      setProject: setProjectSpy,
      setFoundation: setFoundationSpy,
    } as unknown as ProjectContextService;
    fallbackRouter = {
      events: new Subject<NavigationEnd>().asObservable(),
      url: `/project/meetings/${ENTITY_UID}/edit`,
      parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
    } as unknown as Router;

    TestBed.configureTestingModule({});
  });

  it('resolves the owning project of an entity whose payload carries no slug', async () => {
    startFallback();
    await settle();
    lookup.next(resolvedProject);

    expect(getProject).toHaveBeenCalledWith(PROJECT_UID, false);
    expect(setRouteLensKindSpy).toHaveBeenCalledWith('project');
    expect(setProjectSpy).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: 'test-project' }, false);
  });

  it('tears the lookup down when the entity is cleared, instead of leaving it subscribed', async () => {
    startFallback();
    await settle();
    expect(lookup.observed).toBe(true);

    entity.set(null);
    await settle();

    expect(lookup.observed).toBe(false);
  });

  it('does not repoint the page context with a resolution that lands after the entity is gone', async () => {
    startFallback();
    await settle();

    entity.set(null);
    await settle();
    lookup.next(resolvedProject);

    expect(setProjectSpy).not.toHaveBeenCalled();
    expect(setFoundationSpy).not.toHaveBeenCalled();
    expect(setRouteLensKindSpy).not.toHaveBeenCalled();
  });

  it('cancels the fresh-detail retry too, not just the relation-gated lookup', async () => {
    // The second leg is nested inside the same switchMap: a null from the gated lookup hands off
    // to the ungated detail fetch, so a cancellation has to reach through both.
    startFallback({ withFreshFetch: true });
    await settle();
    lookup.next(null);
    expect(freshLookup.observed).toBe(true);

    entity.set(null);
    await settle();
    freshLookup.next({ project_uid: PROJECT_UID, project_slug: 'test-project', project_name: 'Test Project', is_foundation: false });

    expect(freshLookup.observed).toBe(false);
    expect(setProjectSpy).not.toHaveBeenCalled();
  });
});
