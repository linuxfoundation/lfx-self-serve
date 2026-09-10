// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { ProjectService } from '@shared/services/project.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formationProjectEnabledGuard } from './formation-project-enabled.guard';

describe('formationProjectEnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let getCurrentNavigation: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let router: {
    url: string;
    parseUrl: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    getCurrentNavigation: ReturnType<typeof vi.fn>;
  };

  const parseQueryParams = (url: string): Record<string, string> => {
    const query = url.split('?')[1];
    return query ? Object.fromEntries(new URLSearchParams(query)) : {};
  };

  const setNavigationProject = (project: string): void => {
    getCurrentNavigation.mockReturnValue({ extractedUrl: { queryParams: { project } } });
  };

  const runGuard = (): ReturnType<typeof formationProjectEnabledGuard> =>
    TestBed.runInInjectionContext(() => formationProjectEnabledGuard({} as never, [] as never)) as ReturnType<typeof formationProjectEnabledGuard>;

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(true));
    getCurrentNavigation = vi.fn().mockReturnValue(null);
    getProject = vi.fn().mockReturnValue(of({ stage: 'Formation - Exploratory' }));

    router = {
      url: '/project/formation',
      parseUrl: vi.fn().mockImplementation((url: string) => ({ queryParams: parseQueryParams(url) })),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
      getCurrentNavigation,
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag },
        },
        { provide: ProjectService, useValue: { getProject } },
        { provide: Router, useValue: router },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows on the server without evaluating the flag or fetching the project (SSR fast path)', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getFlagOverride).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
  });

  it('allows when the flag is on and the project is in a Formation stage', async () => {
    setNavigationProject('my-project');

    const result = await runGuard();

    expect(getProject).toHaveBeenCalledWith('my-project', false);
    expect(result).toBe(true);
  });

  it('redirects to project overview when the local override says the flag is off, without fetching the project', async () => {
    getFlagOverride.mockReturnValue(false);
    setNavigationProject('my-project');

    const result = await runGuard();

    expect(getProject).not.toHaveBeenCalled();
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'my-project' } } });
  });

  it('redirects to project overview once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));
    setNavigationProject('my-project');

    const result = await runGuard();

    expect(getProject).not.toHaveBeenCalled();
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'my-project' } } });
  });

  it('fails closed to project overview when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    providerReady.set(false);
    setNavigationProject('my-project');

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    vi.useRealTimers();

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'my-project' } } });
    expect(getProject).not.toHaveBeenCalled();
  });

  it('redirects to project overview (no query param) when the flag is on but no project slug can be resolved', async () => {
    const result = await runGuard();

    expect(getProject).not.toHaveBeenCalled();
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: {} } });
  });

  it('redirects to project overview when the project is not in a Formation stage', async () => {
    getProject.mockReturnValue(of({ stage: 'Active' }));
    setNavigationProject('my-project');

    const result = await runGuard();

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'my-project' } } });
  });

  it('falls back to router.url when no navigation is in flight', async () => {
    router.url = '/project/formation?project=my-project';

    const result = await runGuard();

    expect(getProject).toHaveBeenCalledWith('my-project', false);
    expect(result).toBe(true);
  });
});
