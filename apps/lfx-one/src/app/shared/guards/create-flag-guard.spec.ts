// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CanMatchFn, Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlagGuard } from './create-flag-guard';

describe('createFlagGuard', () => {
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let router: { parseUrl: ReturnType<typeof vi.fn> };
  let guard: CanMatchFn;

  const route: Route = { path: 'some-flagged-route' };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<CanMatchFn> => TestBed.runInInjectionContext(() => guard(route, segments));

  beforeEach(() => {
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    router = { parseUrl: vi.fn().mockImplementation((url: string) => ({ denied: url }) as unknown as UrlTree) };
    guard = createFlagGuard('some-flag', '/fallback');

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
    expect(getBooleanFlag).toHaveBeenCalledWith('some-flag', false);
  });

  it('redirects to the configured fallback once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/fallback');
    expect(result).toEqual({ denied: '/fallback' });
  });

  it('defaults the fallback to root when none is given', async () => {
    guard = createFlagGuard('some-flag');
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/');
    expect(result).toEqual({ denied: '/' });
  });

  it('fails closed to the fallback when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    try {
      providerReady.set(false);

      const pending = runGuard();
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;

      expect(result).toEqual({ denied: '/fallback' });
      expect(getBooleanFlag).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
