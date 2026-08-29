// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mktgOsAgentsEnabledGuard } from './mktg-os-agents-enabled.guard';

describe('mktgOsAgentsEnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let queryParams: Record<string, string | undefined>;
  let router: { url: string; parseUrl: ReturnType<typeof vi.fn>; createUrlTree: ReturnType<typeof vi.fn> };

  const projectRoute: Route = { path: 'project/mktg-os-agents', data: { lens: 'project' } };
  const foundationRoute: Route = { path: 'foundation/mktg-os-agents', data: { lens: 'foundation' } };
  const segments: UrlSegment[] = [];

  const runGuard = (route: Route = projectRoute): ReturnType<typeof mktgOsAgentsEnabledGuard> =>
    TestBed.runInInjectionContext(() => mktgOsAgentsEnabledGuard(route, segments));

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    queryParams = {};

    router = {
      url: '/project/mktg-os-agents',
      parseUrl: vi.fn().mockImplementation(() => ({ queryParams })),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag },
        },
        { provide: Router, useValue: router },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows on the server without evaluating the flag (SSR fast path)', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getFlagOverride).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows when the local override says the flag is on, without waiting for READY', async () => {
    getFlagOverride.mockReturnValue(true);
    providerReady.set(false);

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('redirects to project overview when the local override says the flag is off, without waiting for READY', async () => {
    getFlagOverride.mockReturnValue(false);
    providerReady.set(false);

    const result = await runGuard();

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: {} } });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('preserves the project query on an override deny', async () => {
    getFlagOverride.mockReturnValue(false);
    queryParams = { project: 'my-project' };

    const result = await runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: 'my-project' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'my-project' } } });
  });

  it('redirects a foundation deep link to foundation overview when the override is off', async () => {
    getFlagOverride.mockReturnValue(false);

    const result = await runGuard(foundationRoute);

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: {} } });
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects to project overview once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: {} } });
  });

  it('redirects a foundation deep link to foundation overview when the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard(foundationRoute);

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: {} } });
  });

  it('preserves the project query when the flag is off after READY', async () => {
    getBooleanFlag.mockReturnValue(signal(false));
    queryParams = { project: 'my-project' };

    const result = await runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: 'my-project' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: 'my-project' } } });
  });

  it('fails closed to the lens overview when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    providerReady.set(false);

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    vi.useRealTimers();

    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: {} } });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
