// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orgLensClaM3EnabledGuard } from './org-lens-cla-m3-enabled.guard';

describe('orgLensClaM3EnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let router: {
    parseUrl: ReturnType<typeof vi.fn>;
  };

  const route: Route = { path: 'easycla', data: { lens: 'org' } };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<typeof orgLensClaM3EnabledGuard> => TestBed.runInInjectionContext(() => orgLensClaM3EnabledGuard(route, segments));

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));

    router = {
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirected: url })),
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

  it('redirects to /org/overview when the local override says the flag is off, without waiting for READY', async () => {
    getFlagOverride.mockReturnValue(false);
    providerReady.set(false);

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/org/overview');
    expect(result).toEqual({ redirected: '/org/overview' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects to /org/overview once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/org/overview');
    expect(result).toEqual({ redirected: '/org/overview' });
  });

  it('fails closed to /org/overview when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    providerReady.set(false);

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    vi.useRealTimers();

    expect(router.parseUrl).toHaveBeenCalledWith('/org/overview');
    expect(result).toEqual({ redirected: '/org/overview' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
