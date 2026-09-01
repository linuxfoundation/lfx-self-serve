// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formationEnabledGuard } from './formation-enabled.guard';

describe('formationEnabledGuard', () => {
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let router: { parseUrl: ReturnType<typeof vi.fn> };

  const route: Route = { path: 'propose' };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<typeof formationEnabledGuard> => TestBed.runInInjectionContext(() => formationEnabledGuard(route, segments));

  beforeEach(() => {
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    router = { parseUrl: vi.fn().mockImplementation((url: string) => ({ denied: url }) as unknown as UrlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { providerReady: providerReady.asReadonly(), getBooleanFlag } },
        { provide: Router, useValue: router },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows on the server without evaluating the flag (SSR fast path)', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects to root once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/');
    expect(result).toEqual({ denied: '/' });
  });

  it('fails closed to root when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    providerReady.set(false);

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    vi.useRealTimers();

    expect(result).toEqual({ denied: '/' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
