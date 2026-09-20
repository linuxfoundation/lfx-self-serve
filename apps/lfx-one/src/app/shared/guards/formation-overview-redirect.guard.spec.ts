// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, UrlTree } from '@angular/router';
import { FEATURE_FLAG_REDIRECT_READY_TIMEOUT_MS, FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formationOverviewRedirectGuard } from './formation-overview-redirect.guard';

describe('formationOverviewRedirectGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let createUrlTree: ReturnType<typeof vi.fn>;
  let selectedProject: ReturnType<typeof signal<ProjectContext | null>>;

  const contextProject: ProjectContext = { uid: 'uid-ctx', name: 'Context Project', slug: 'ctx-project', parent_uid: '', logoUrl: '' };

  const snapshot = (queryParams: Record<string, string>): ActivatedRouteSnapshot =>
    ({ queryParams, queryParamMap: convertToParamMap(queryParams) }) as unknown as ActivatedRouteSnapshot;

  const runGuard = (queryParams: Record<string, string> = {}): ReturnType<typeof formationOverviewRedirectGuard> =>
    TestBed.runInInjectionContext(() => formationOverviewRedirectGuard(snapshot(queryParams), {} as never)) as ReturnType<
      typeof formationOverviewRedirectGuard
    >;

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    waitForReady = vi.fn().mockResolvedValue(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(true));
    getProject = vi.fn().mockReturnValue(of({ stage: 'Formation - Engaged' }));
    createUrlTree = vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ redirect: commands[0], opts }) as unknown as UrlTree);
    selectedProject = signal<ProjectContext | null>(null);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), waitForReady, getBooleanFlag },
        },
        { provide: ProjectService, useValue: { getProject } },
        { provide: ProjectContextService, useValue: { selectedProject } },
        { provide: Router, useValue: { createUrlTree } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows on the server without fetching the project or evaluating the flag (SSR fast path)', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const result = await runGuard({ project: 'my-project' });

    expect(result).toBe(true);
    expect(getProject).not.toHaveBeenCalled();
    expect(getFlagOverride).not.toHaveBeenCalled();
  });

  it('allows when no project slug is on the route or in the project context', async () => {
    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProject).not.toHaveBeenCalled();
  });

  it('redirects a formation project to the checklist with the slug carried on the URL', async () => {
    const result = await runGuard({ project: 'my-project' });

    expect(getProject).toHaveBeenCalledWith('my-project', false);
    expect(result).toEqual({ redirect: '/project/formation', opts: { queryParams: { project: 'my-project' } } });
  });

  it('carries the other query params through the redirect so a denial notice still surfaces', async () => {
    const result = await runGuard({ project: 'my-project', _notice: 'meetings' });

    expect(result).toEqual({ redirect: '/project/formation', opts: { queryParams: { project: 'my-project', _notice: 'meetings' } } });
  });

  it('falls back to the selected project slug when the route carries no ?project=', async () => {
    selectedProject.set(contextProject);

    const result = await runGuard();

    expect(getProject).toHaveBeenCalledWith('ctx-project', false);
    expect(result).toEqual({ redirect: '/project/formation', opts: { queryParams: { project: 'ctx-project' } } });
  });

  it('allows a non-formation project without consulting the flag provider', async () => {
    getProject.mockReturnValue(of({ stage: 'Active' }));

    const result = await runGuard({ project: 'my-project' });

    expect(result).toBe(true);
    expect(getFlagOverride).not.toHaveBeenCalled();
    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows a disengaged formation project', async () => {
    getProject.mockReturnValue(of({ stage: 'Formation - Disengaged' }));

    const result = await runGuard({ project: 'my-project' });

    expect(result).toBe(true);
  });

  it('allows when the project cannot be resolved so the not-found handling downstream wins', async () => {
    getProject.mockReturnValue(of(null));

    const result = await runGuard({ project: 'missing-project' });

    expect(result).toBe(true);
    expect(getFlagOverride).not.toHaveBeenCalled();
  });

  it('allows when the local override pins the flag off', async () => {
    getFlagOverride.mockReturnValue(false);

    const result = await runGuard({ project: 'my-project' });

    expect(result).toBe(true);
    expect(waitForReady).not.toHaveBeenCalled();
  });

  it('fails open to the dashboard when the provider never becomes ready', async () => {
    providerReady.set(false);
    waitForReady.mockResolvedValue(false);

    const result = await runGuard({ project: 'my-project' });

    expect(waitForReady).toHaveBeenCalledWith(
      { guard: 'formationOverviewRedirectGuard', flag: FORMATION_ENABLED_FLAG },
      FEATURE_FLAG_REDIRECT_READY_TIMEOUT_MS
    );
    expect(result).toBe(true);
  });

  it('allows when the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard({ project: 'my-project' });

    expect(result).toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });
});
