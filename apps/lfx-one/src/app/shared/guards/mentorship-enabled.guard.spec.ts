// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment } from '@angular/router';
import { MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mentorshipEnabledGuard } from './mentorship-enabled.guard';

describe('mentorshipEnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let router: {
    parseUrl: ReturnType<typeof vi.fn>;
  };

  const route: Route = { path: 'mentorship', data: { lens: 'me' } };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<typeof mentorshipEnabledGuard> => TestBed.runInInjectionContext(() => mentorshipEnabledGuard(route, segments));

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    waitForReady = vi.fn().mockImplementation(
      (_context: unknown, timeoutMs = 5000) =>
        new Promise((resolve) => {
          if (providerReady()) {
            resolve(true);
            return;
          }
          setTimeout(() => resolve(false), timeoutMs);
        })
    );

    router = {
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirected: url })),
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

  it('redirects to / when the local override says the flag is off, without waiting for READY', async () => {
    getFlagOverride.mockReturnValue(false);
    providerReady.set(false);

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/');
    expect(result).toEqual({ redirected: '/' });
    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects to / once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/');
    expect(result).toEqual({ redirected: '/' });
  });

  it('fails closed to / when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    providerReady.set(false);

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    vi.useRealTimers();

    expect(waitForReady).toHaveBeenCalledWith({ guard: 'mentorshipEnabledGuard', flag: MENTORSHIP_ENABLED_FLAG });
    expect(router.parseUrl).toHaveBeenCalledWith('/');
    expect(result).toEqual({ redirected: '/' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
