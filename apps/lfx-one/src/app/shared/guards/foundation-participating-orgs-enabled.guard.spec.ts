// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment } from '@angular/router';
import { FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { foundationParticipatingOrgsEnabledGuard } from './foundation-participating-orgs-enabled.guard';

describe('foundationParticipatingOrgsEnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let router: { createUrlTree: ReturnType<typeof vi.fn> };

  const route: Route = { path: 'foundation/participating-orgs' };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<typeof foundationParticipatingOrgsEnabledGuard> =>
    TestBed.runInInjectionContext(() => foundationParticipatingOrgsEnabledGuard(route, segments));

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    waitForReady = vi.fn().mockResolvedValue(true);
    router = { createUrlTree: vi.fn().mockImplementation((commands: string[]) => ({ redirected: commands.join('/') })) };

    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady } },
        { provide: Router, useValue: router },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows on the server without evaluating the flag', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    expect(await runGuard()).toBe(true);
    expect(getFlagOverride).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows when the override turns the flag on, without waiting for the provider', async () => {
    getFlagOverride.mockReturnValue(true);
    providerReady.set(false);

    expect(await runGuard()).toBe(true);
    expect(waitForReady).not.toHaveBeenCalled();
  });

  it('redirects to the foundation overview when the override turns the flag off', async () => {
    getFlagOverride.mockReturnValue(false);

    expect(await runGuard()).toEqual({ redirected: '/foundation/overview' });
    expect(waitForReady).not.toHaveBeenCalled();
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    expect(await runGuard()).toBe(true);
    expect(waitForReady).not.toHaveBeenCalled();
  });

  it('redirects when the provider is ready and the flag is off', async () => {
    expect(await runGuard()).toEqual({ redirected: '/foundation/overview' });
  });

  it('waits for the provider, then evaluates the flag', async () => {
    providerReady.set(false);
    getBooleanFlag.mockReturnValue(signal(true));

    expect(await runGuard()).toBe(true);
    expect(waitForReady).toHaveBeenCalledWith({ guard: 'foundationParticipatingOrgsEnabledGuard', flag: FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG });
  });

  it('fails closed when the provider never becomes ready', async () => {
    providerReady.set(false);
    waitForReady.mockResolvedValue(false);

    expect(await runGuard()).toEqual({ redirected: '/foundation/overview' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
