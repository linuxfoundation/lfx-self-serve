// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@shared/services/persona.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newsletterAccessGuard } from './newsletter-access.guard';

// Covers the GH-1570 resolution order: the route's own `:projectUid` wins over a stale
// `?project=` / cookie-restored context (including at the lens mount, where the param lives on
// the child snapshot), a failed uid lookup degrades to the legacy slug chain instead of
// denying, and every denial carries `_notice: 'access'` so AppComponent can toast it.
describe('newsletterAccessGuard', () => {
  let currentPersona: ReturnType<typeof signal<string>>;
  let activeContext: ReturnType<typeof signal<ProjectContext | null>>;
  let getProject: ReturnType<typeof vi.fn>;
  let router: { parseUrl: ReturnType<typeof vi.fn>; createUrlTree: ReturnType<typeof vi.fn> };
  // Per-test project registry keyed by the slugOrUid getProject is called with;
  // a missing key resolves null (relation-gated / failed lookup).
  let projectsByKey: Record<string, Partial<Project> | null>;

  const route = (
    options: { query?: Record<string, string>; params?: Record<string, string>; childParams?: Record<string, string>; lens?: 'foundation' | 'project' } = {}
  ): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap(options.query ?? {}),
      paramMap: convertToParamMap(options.params ?? {}),
      firstChild: options.childParams ? ({ paramMap: convertToParamMap(options.childParams) } as unknown as ActivatedRouteSnapshot) : null,
      parent: options.lens ? ({ data: { lens: options.lens } } as unknown as ActivatedRouteSnapshot) : null,
      data: {},
    }) as unknown as ActivatedRouteSnapshot;

  const runGuard = async (r: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    const result = TestBed.runInInjectionContext(() => newsletterAccessGuard(r, {} as RouterStateSnapshot));
    // The no-:projectUid ED fast path returns `true` synchronously and the no-context
    // fallback a bare UrlTree; every other branch returns an Observable.
    if (result instanceof Observable) {
      return firstValueFrom(result as Observable<boolean | UrlTree>);
    }
    return result as boolean | UrlTree;
  };

  beforeEach(() => {
    currentPersona = signal('maintainer');
    activeContext = signal<ProjectContext | null>(null);
    projectsByKey = {};
    getProject = vi.fn().mockImplementation((key: string) => of((projectsByKey[key] ?? null) as Project | null));

    router = {
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirect: url }) as unknown as UrlTree),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { currentPersona } },
        { provide: ProjectContextService, useValue: { activeContext } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('allows the executive-director persona synchronously on routes without a :projectUid', async () => {
    currentPersona.set('executive-director');

    const result = await runGuard(route());

    expect(result).toBe(true);
    expect(getProject).not.toHaveBeenCalled();
  });

  it('awaits the route-project resolution for the executive-director persona on :projectUid routes', async () => {
    // The page's reconcileRouteProjectContext reuses this shareReplay-cached lookup —
    // resolving it in the guard keeps chrome from painting a stale cookie-restored
    // context while the page's own fetch is in flight (GH-1570).
    currentPersona.set('executive-director');
    projectsByKey = { 'uid-a': { slug: 'route-project' } };

    const result = await runGuard(route({ params: { projectUid: 'uid-a', id: 'n1' } }));

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('uid-a', false);
  });

  it('does not deny the executive-director persona when the route-project resolution fails', async () => {
    // Fail-open: 'uid-gone' is intentionally unseeded, so the lookup resolves null —
    // a deleted/unknown project or fetch error must not deny the ED fast path.
    currentPersona.set('executive-director');

    const result = await runGuard(route({ params: { projectUid: 'uid-gone', id: 'n1' } }));

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('uid-gone', false);
  });

  it('authorizes against the route :projectUid rather than a stale query param or cookie-restored context', async () => {
    // The stale context is intentionally NOT writable: authorizing against it (the pre-fix
    // behavior) would deny a legitimate manager of the route's project.
    activeContext.set({ uid: 'uid-stale', slug: 'stale-slug', name: 'Stale Project' });
    projectsByKey = {
      'uid-a': { slug: 'route-project', writer: true },
      'stale-slug': { slug: 'stale-slug', writer: false },
    };

    const result = await runGuard(route({ params: { projectUid: 'uid-a', id: 'n1' }, query: { project: 'stale-slug' } }));

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('uid-a', false);
    expect(getProject).not.toHaveBeenCalledWith('stale-slug', false);
  });

  it('resolves :projectUid from the child snapshot when the guard runs at the lens mount', async () => {
    projectsByKey = { 'uid-a': { slug: 'route-project', writer: true } };

    const result = await runGuard(route({ childParams: { projectUid: 'uid-a', id: 'n1' } }));

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('uid-a', false);
  });

  it('degrades to the legacy slug chain when the uid lookup resolves null', async () => {
    activeContext.set({ uid: 'uid-ctx', slug: 'ctx-slug', name: 'Context Project' });
    projectsByKey = {
      'uid-gone': null, // deleted/unknown project
      'ctx-slug': { slug: 'ctx-slug', writer: true },
    };

    const result = await runGuard(route({ params: { projectUid: 'uid-gone', id: 'n1' } }));

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('uid-gone', false);
    expect(getProject).toHaveBeenCalledWith('ctx-slug', false);
  });

  it('redirects to the overview when the uid lookup fails and no slug context exists to fall back to', async () => {
    projectsByKey = { 'uid-gone': null };

    const result = await runGuard(route({ params: { projectUid: 'uid-gone', id: 'n1' } }));

    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it('denies with the resolved slug and the access notice when the route project is not writable', async () => {
    projectsByKey = { 'uid-a': { slug: 'route-project', writer: false } };

    const result = await runGuard(route({ params: { projectUid: 'uid-a', id: 'n1' } }));

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'route-project', _notice: 'access' } } });
  });

  it('prefers the ?project= query param over the active context on routes without :projectUid', async () => {
    activeContext.set({ uid: 'uid-ctx', slug: 'ctx-slug', name: 'Context Project' });
    projectsByKey = {
      'query-slug': { slug: 'query-slug', writer: true },
      'ctx-slug': { slug: 'ctx-slug', writer: false },
    };

    const result = await runGuard(route({ query: { project: 'query-slug' } }));

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('query-slug', false);
    expect(getProject).not.toHaveBeenCalledWith('ctx-slug', false);
  });

  it('falls back to the active context slug when the URL carries no project hint', async () => {
    activeContext.set({ uid: 'uid-ctx', slug: 'ctx-slug', name: 'Context Project' });
    projectsByKey = { 'ctx-slug': { slug: 'ctx-slug', writer: true } };

    const result = await runGuard(route());

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('ctx-slug', false);
  });

  it('denies fail-closed when the legacy-chain project lookup fails', async () => {
    activeContext.set({ uid: 'uid-ctx', slug: 'ctx-slug', name: 'Context Project' });
    projectsByKey = {};

    const result = await runGuard(route());

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'ctx-slug', _notice: 'access' } } });
  });

  it('redirects to the project overview when no project can be resolved at all', async () => {
    const result = await runGuard(route());

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
  });

  it('redirects to the foundation overview on foundation-lens denials', async () => {
    projectsByKey = { 'uid-a': { slug: 'route-project', writer: false } };

    const result = await runGuard(route({ params: { projectUid: 'uid-a', id: 'n1' }, lens: 'foundation' }));

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: 'route-project', _notice: 'access' } } });
  });
});
