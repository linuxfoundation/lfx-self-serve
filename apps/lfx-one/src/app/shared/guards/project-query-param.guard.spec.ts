// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RedirectCommand, Router, UrlTree } from '@angular/router';
import { TRANSIENT_RETRY_DELAY_MS } from '@lfx-one/shared/constants';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { defer, firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let getProjectStrict: ReturnType<typeof vi.fn>;
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
    getProjectStrict = vi.fn().mockReturnValue(of(REGULAR_PROJECT));
    setRouteLensKind = vi.fn();
    setFoundation = vi.fn();
    setProject = vi.fn();
    // parseUrl is called by RedirectCommand construction; return a distinct fake
    // UrlTree so assertions can verify the correct path was requested.
    parseUrl = vi.fn().mockImplementation((path: string) => ({ path }) as unknown as UrlTree);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProjectStrict } },
        { provide: ProjectContextService, useValue: { setRouteLensKind, setFoundation, setProject } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('allows navigation immediately when no ?project= param is present', async () => {
    const result = await runGuard(makeRoute(null));

    expect(result).toBe(true);
    expect(getProjectStrict).not.toHaveBeenCalled();
  });

  it('sets the project context and allows navigation when the slug resolves (project lens)', async () => {
    const result = await runGuard(makeRoute('my-project', 'project'));

    expect(getProjectStrict).toHaveBeenCalledWith('my-project');
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
    getProjectStrict.mockReturnValue(of(FOUNDATION_PROJECT));

    const result = await runGuard(makeRoute('my-foundation', 'foundation'));

    expect(getProjectStrict).toHaveBeenCalledWith('my-foundation');
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
    getProjectStrict.mockReturnValue(of(FOUNDATION_PROJECT));

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

  it.each([400, 401, 403, 404])('activates the not-found view in-place for HTTP %s (GH-2441 regression)', async (status) => {
    getProjectStrict.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));

    const result = await runGuard(makeRoute('s2c2f', 'project'));

    expect(getProjectStrict).toHaveBeenCalledWith('s2c2f');
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

  it('allows the intended page after one silent retry succeeds', async () => {
    vi.useFakeTimers();
    const lookup = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValueOnce(of(REGULAR_PROJECT));
    getProjectStrict.mockReturnValue(defer(lookup));
    const result = runGuard(makeRoute('my-project', 'project'));

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(setProject).not.toHaveBeenCalled();
    expect(parseUrl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_DELAY_MS);

    expect(await result).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ uid: REGULAR_PROJECT.uid }));
    expect(parseUrl).not.toHaveBeenCalled();
  });

  it.each([0, 408, 429, 500, 503])('shows the retry view in-place after HTTP %s persists through one retry', async (status) => {
    vi.useFakeTimers();
    const lookup = vi.fn(() => throwError(() => new HttpErrorResponse({ status })));
    getProjectStrict.mockReturnValue(defer(lookup));
    const result = runGuard(makeRoute('my-project', 'project'));
    await vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_DELAY_MS);

    const cmd = (await result) as RedirectCommand;
    expect(cmd).toBeInstanceOf(RedirectCommand);
    expect(cmd.navigationBehaviorOptions?.skipLocationChange).toBe(true);
    expect(parseUrl).toHaveBeenCalledWith('/unavailable');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(setProject).not.toHaveBeenCalled();
    expect(setFoundation).not.toHaveBeenCalled();
  });

  it('keeps the not-found classification for non-HTTP errors', async () => {
    getProjectStrict.mockReturnValue(throwError(() => new Error('unexpected error')));

    const result = await runGuard(makeRoute('bad-slug', 'project'));
    expect(result).toBeInstanceOf(RedirectCommand);
    expect(parseUrl).toHaveBeenCalledWith('/not-found');
    expect((result as RedirectCommand).navigationBehaviorOptions?.skipLocationChange).toBe(true);

    expect(setProject).not.toHaveBeenCalled();
    expect(setFoundation).not.toHaveBeenCalled();
  });
});
