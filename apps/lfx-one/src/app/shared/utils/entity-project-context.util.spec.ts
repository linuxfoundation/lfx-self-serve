// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, computed, DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileRouteProjectContext } from './entity-project-context.util';

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
  let getProject: ReturnType<typeof vi.fn>;
  let setRouteLensKind: ReturnType<typeof vi.fn>;
  let setFoundation: ReturnType<typeof vi.fn>;
  let setProject: ReturnType<typeof vi.fn>;
  let routeLensKind: ReturnType<typeof signal<'foundation' | 'project' | null>>;
  let projectContextService: ProjectContextService;

  const start = (): void => {
    TestBed.runInInjectionContext(() =>
      reconcileRouteProjectContext(routeProjectUid.asReadonly(), { getProject } as unknown as ProjectService, projectContextService, router, inject(DestroyRef))
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
    getProject = vi.fn().mockReturnValue(of(foundationProject));

    // Mini ProjectContextService: the two context slots + the route-kind override, composed the
    // way the real service composes activeContext from them — so a MainLayout-style re-assert
    // (routeLensKind back to the route's declared 'project') visibly flips activeContext back
    // to the stale cookie-restored project, exactly what the re-apply must undo.
    routeLensKind = signal<'foundation' | 'project' | null>('project');
    const projectSlot = signal<ProjectContext | null>({ uid: 'other-uid', name: 'Other Project', slug: 'other-project' });
    const foundationSlot = signal<ProjectContext | null>(null);
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

    expect(getProject).toHaveBeenCalledWith(ROUTE_UID, false);
    expect(setRouteLensKind).toHaveBeenCalledWith('foundation');
    expect(setFoundation).toHaveBeenCalledWith(resolvedContext, false);
    expect(setProject).not.toHaveBeenCalled();
    expect(projectContextService.activeContext()).toEqual(resolvedContext);
  });

  it('re-applies the cached context on a later NavigationEnd after the route-lens re-assert clobbers it, without a second fetch', async () => {
    start();
    await stable();
    expect(getProject).toHaveBeenCalledTimes(1);

    // A ?step= navigation doesn't re-run guards, but MainLayout.syncLensFromRoute re-asserts the
    // route's declared lens on the NavigationEnd — flipping the selector/sidebar back to the
    // stale cookie project if the cached re-apply regresses.
    routeLensKind.set('project');
    await emitStepNavigation(1);

    expect(getProject).toHaveBeenCalledTimes(1);
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
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(setFoundation).toHaveBeenCalledTimes(1);
    expect(setRouteLensKind).toHaveBeenCalledTimes(1);
  });

  it('leaves the existing context untouched when the route project lookup resolves null', async () => {
    getProject.mockReturnValue(of(null));

    start();
    await stable();

    // Deleted/unknown project (or no viewer relation): fail-open, no writes — the stale context
    // stays rather than erroring the page.
    expect(getProject).toHaveBeenCalledWith(ROUTE_UID, false);
    expect(setRouteLensKind).not.toHaveBeenCalled();
    expect(setFoundation).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
    expect(projectContextService.activeContext()?.slug).toBe('other-project');
  });
});
