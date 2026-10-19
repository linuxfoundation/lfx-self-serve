// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type GuardResult, Route, Router, UrlSegment } from '@angular/router';
import { PROJECT_LENS_PARTICIPATING_ORGS_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { projectParticipatingOrgsEnabledGuard } from './project-participating-orgs-enabled.guard';

describe('projectParticipatingOrgsEnabledGuard', () => {
  let getFlagOverride: Mock;
  let providerReady: WritableSignal<boolean>;
  let getBooleanFlag: Mock;
  let waitForReady: Mock;
  let router: { url: string; parseUrl: Mock; createUrlTree: Mock; getCurrentNavigation: Mock };

  const route: Route = { path: 'project/participating-orgs', data: { lens: 'project' } };
  const segments: UrlSegment[] = [];
  const deniedTree = { denied: '/project/overview', opts: { queryParams: { project: 'synthetic-project' } } };

  // The guard is async, so its MaybeAsync result is always a promise here.
  const runGuard = (): Promise<GuardResult> =>
    TestBed.runInInjectionContext(() => projectParticipatingOrgsEnabledGuard(route, segments)) as Promise<GuardResult>;

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    // The real service resolves false once its timeout elapses without READY.
    waitForReady = vi.fn(async () => providerReady());

    router = {
      url: '/',
      parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts })),
      getCurrentNavigation: vi.fn().mockReturnValue({ extractedUrl: { queryParams: { project: 'synthetic-project' } } }),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady },
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
    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('denies to the project overview when the local override says the flag is off, without waiting for READY', async () => {
    getFlagOverride.mockReturnValue(false);
    providerReady.set(false);

    const result = await runGuard();

    expect(result).toEqual(deniedTree);
    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getBooleanFlag).toHaveBeenCalledWith(PROJECT_LENS_PARTICIPATING_ORGS_FLAG, false);
  });

  it('denies to the project overview, keeping ?project=, once the provider is ready and the flag is off', async () => {
    const result = await runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: 'synthetic-project' } });
    expect(result).toEqual(deniedTree);
  });

  it('fails closed to the project overview when the provider never becomes ready', async () => {
    providerReady.set(false);

    const result = await runGuard();

    expect(waitForReady).toHaveBeenCalledWith({ guard: 'projectParticipatingOrgsEnabledGuard', flag: PROJECT_LENS_PARTICIPATING_ORGS_FLAG });
    expect(result).toEqual(deniedTree);
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
