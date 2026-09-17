// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RedirectCommand, Router, UrlTree } from '@angular/router';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectQueryParamGuard } from './project-query-param.guard';

// ---------------------------------------------------------------------------
// Minimal project fixtures
// ---------------------------------------------------------------------------

/** A membership-funded Active project — computeIsFoundation returns true. */
const FOUNDATION_PROJECT = {
  uid: 'f-uid',
  name: 'My Foundation',
  slug: 'my-foundation',
  parent_uid: null,
  logo_url: 'https://example.com/logo.png',
  stage: 'Active',
  legal_entity_type: 'LLC',
  funding: 'Funded',
  funding_model: ['Membership'],
} as const;

/** A project without Membership funding — computeIsFoundation returns false. */
const REGULAR_PROJECT = {
  uid: 'p-uid',
  name: 'My Project',
  slug: 'my-project',
  parent_uid: 'f-uid',
  logo_url: null,
  stage: 'Active',
  legal_entity_type: 'LLC',
  funding: 'Funded',
  funding_model: [],
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRoute = (slug: string | null, lens?: string): ActivatedRouteSnapshot =>
  ({
    queryParamMap: { get: vi.fn().mockReturnValue(slug) },
    data: lens !== undefined ? { lens } : {},
  }) as unknown as ActivatedRouteSnapshot;

describe('projectQueryParamGuard', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let setRouteLensKind: ReturnType<typeof vi.fn>;
  let setFoundation: ReturnType<typeof vi.fn>;
  let setProject: ReturnType<typeof vi.fn>;
  let parseUrl: ReturnType<typeof vi.fn>;

  // The guard may return a synchronous boolean or an Observable; normalise to a
  // Promise so every test can simply `await runGuard(route)`.
  const runGuard = (route: ActivatedRouteSnapshot): Promise<boolean | UrlTree | RedirectCommand> => {
    const result = TestBed.runInInjectionContext(() => projectQueryParamGuard(route, {} as never)) as
      | boolean
      | UrlTree
      | RedirectCommand
      | Observable<boolean | UrlTree | RedirectCommand>;
    return isObservable(result) ? firstValueFrom(result) : Promise.resolve(result);
  };

  beforeEach(() => {
    getProject = vi.fn().mockReturnValue(of(REGULAR_PROJECT));
    setRouteLensKind = vi.fn();
    setFoundation = vi.fn();
    setProject = vi.fn();
    // parseUrl is called by RedirectCommand construction; return a distinct fake
    // UrlTree so assertions can verify the correct path was requested.
    parseUrl = vi.fn().mockImplementation((path: string) => ({ path }) as unknown as UrlTree);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProject } },
        { provide: ProjectContextService, useValue: { setRouteLensKind, setFoundation, setProject } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
  });

  it('allows navigation immediately when no ?project= param is present', async () => {
    const result = await runGuard(makeRoute(null));

    expect(result).toBe(true);
    expect(getProject).not.toHaveBeenCalled();
  });

  it('sets the project context and allows navigation when the slug resolves (project lens)', async () => {
    const result = await runGuard(makeRoute('my-project', 'project'));

    expect(getProject).toHaveBeenCalledWith('my-project', false);
    expect(setProject).toHaveBeenCalledWith({
      uid: REGULAR_PROJECT.uid,
      name: REGULAR_PROJECT.name,
      slug: REGULAR_PROJECT.slug,
      parent_uid: REGULAR_PROJECT.parent_uid,
      logoUrl: REGULAR_PROJECT.logo_url,
    });
    expect(setFoundation).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('sets the foundation context and allows navigation when the slug resolves (foundation lens)', async () => {
    getProject.mockReturnValue(of(FOUNDATION_PROJECT));

    const result = await runGuard(makeRoute('my-foundation', 'foundation'));

    expect(getProject).toHaveBeenCalledWith('my-foundation', false);
    expect(setFoundation).toHaveBeenCalledWith({
      uid: FOUNDATION_PROJECT.uid,
      name: FOUNDATION_PROJECT.name,
      slug: FOUNDATION_PROJECT.slug,
      parent_uid: FOUNDATION_PROJECT.parent_uid,
      logoUrl: FOUNDATION_PROJECT.logo_url,
    });
    expect(setProject).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('derives foundation kind from the project when the route declares no lens and the project is a foundation', async () => {
    getProject.mockReturnValue(of(FOUNDATION_PROJECT));

    // No `lens` in route.data → effectiveKind is derived from computeIsFoundation
    const result = await runGuard(makeRoute('my-foundation'));

    expect(setFoundation).toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
    // setRouteLensKind is called once with null (route declares no lens) then again
    // with 'foundation' once the effective kind is derived
    expect(setRouteLensKind).toHaveBeenCalledWith(null);
    expect(setRouteLensKind).toHaveBeenCalledWith('foundation');
    expect(result).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Regression: GH-2441 — unresolvable slug must NOT silently substitute a project
  // ---------------------------------------------------------------------------

  it('activates the not-found view in-place when the slug is present but resolves to null (GH-2441 regression)', async () => {
    getProject.mockReturnValue(of(null));

    const result = await runGuard(makeRoute('s2c2f', 'project'));

    expect(getProject).toHaveBeenCalledWith('s2c2f', false);
    // Must use RedirectCommand with skipLocationChange so the browser retains the
    // original URL and the server emits HTTP 404 at the requested path — not a 302.
    expect(result).toBeInstanceOf(RedirectCommand);
    const cmd = result as RedirectCommand;
    expect(parseUrl).toHaveBeenCalledWith('/not-found');
    expect(cmd.navigationBehaviorOptions?.skipLocationChange).toBe(true);
    // Context must NOT be touched — no substitution
    expect(setProject).not.toHaveBeenCalled();
    expect(setFoundation).not.toHaveBeenCalled();
  });

  it('propagates an unexpected fetch error unchanged rather than silently swallowing it (defense-in-depth)', async () => {
    // ProjectService.getProject maps all errors to null internally, so this branch
    // is currently unreachable. The test documents the intended behavior if the
    // service is ever refactored to propagate errors.
    getProject.mockReturnValue(throwError(() => new Error('network error')));

    // The Observable errors out; firstValueFrom rejects — guard emits no value.
    // This is acceptable: Angular's error handler surfaces it rather than a silent miss.
    await expect(runGuard(makeRoute('bad-slug', 'project'))).rejects.toThrow('network error');

    expect(setProject).not.toHaveBeenCalled();
    expect(setFoundation).not.toHaveBeenCalled();
  });
});
