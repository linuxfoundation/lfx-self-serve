// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgLensNavigationService } from '@shared/services/org-lens-navigation.service';

import { orgLensClaM3EnabledGuard } from './org-lens-cla-m3-enabled.guard';

describe('orgLensClaM3EnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let router: {
    createUrlTree: ReturnType<typeof vi.fn>;
    parseUrl: ReturnType<typeof vi.fn>;
    getCurrentNavigation: ReturnType<typeof vi.fn>;
  };
  /** The URL being recognized — the legacy EasyCLA address unless a case says otherwise. */
  let targetUrl: string;

  const route: Route = { path: 'easycla', data: { lens: 'org' } };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<typeof orgLensClaM3EnabledGuard> => TestBed.runInInjectionContext(() => orgLensClaM3EnabledGuard(route, segments));

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

    targetUrl = '/org/easycla';
    router = {
      createUrlTree: vi.fn().mockImplementation((commands: string[]) => ({ redirected: commands.join('/') })),
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirected: url })),
      getCurrentNavigation: vi.fn().mockImplementation(() => ({
        extractedUrl: {
          root: {
            children: {
              primary: {
                segments: targetUrl
                  .split('/')
                  .filter(Boolean)
                  .map((path) => ({ path })),
              },
            },
          },
        },
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady },
        },
        { provide: Router, useValue: router },
        // Spec 050: on the legacy address the fallback carries the *selected* organization; this suite
        // pins the redirect rules, so the address builder is stubbed to the org-aware form.
        { provide: OrgLensNavigationService, useValue: { orgLensLink: (page: string) => ['/org', 'acme-inc', page] } },
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

  it('redirects to the selected organization overview when the local override says the flag is off, without waiting for READY', async () => {
    getFlagOverride.mockReturnValue(false);
    providerReady.set(false);

    const result = await runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/org', 'acme-inc', 'overview']);
    expect(result).toEqual({ redirected: '/org/acme-inc/overview' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('allows once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects to the selected organization overview once the provider is ready and the flag is off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/org', 'acme-inc', 'overview']);
    expect(result).toEqual({ redirected: '/org/acme-inc/overview' });
  });

  it('fails closed to the selected organization overview when the provider never becomes ready', async () => {
    vi.useFakeTimers();
    providerReady.set(false);

    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    vi.useRealTimers();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/org', 'acme-inc', 'overview']);
    expect(result).toEqual({ redirected: '/org/acme-inc/overview' });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  // Spec 050 phase 2 (lfx-self-serve#2743): under `/org/{segment}/easycla` the address names the
  // organization, and this CanMatch runs before the path guard adopts it — the URL, not the
  // selection, is what the fallback must keep, or a shared link would bounce to the cookie's org.
  it('keeps the addressed organization when the flag is off on an org-addressed EasyCLA page', async () => {
    targetUrl = '/org/other-org/easycla/cla-group-1';
    getFlagOverride.mockReturnValue(false);

    const result = await runGuard();

    expect(router.parseUrl).toHaveBeenCalledWith('/org/other-org/overview');
    expect(router.createUrlTree).not.toHaveBeenCalled();
    expect(result).toEqual({ redirected: '/org/other-org/overview' });
  });
});
