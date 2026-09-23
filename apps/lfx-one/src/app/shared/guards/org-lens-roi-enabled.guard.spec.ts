// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { orgLensRoiEnabledGuard } from './org-lens-roi-enabled.guard';

// The fallback of a disabled / undecidable ROI flag must stay in the organization the address names
// (spec 050): this CanMatch runs before `orgPathParamGuard` adopts the segment, so an absolute
// `/org/overview` would silently land on the cookie organization.
describe('orgLensRoiEnabledGuard — fallback address', () => {
  const UID = '0014100000MgaAAAAA';
  const route: Route = { path: 'roi' };
  const segments: UrlSegment[] = [];

  let getFlagOverride: Mock;
  let providerReady: WritableSignal<boolean>;
  let getBooleanFlag: Mock;
  let waitForReady: Mock;
  let router: Router;

  const fallbackFor = async (targetUrl: string): Promise<string | true> => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({ extractedUrl: router.parseUrl(targetUrl) } as never);
    const result = await TestBed.runInInjectionContext(() => orgLensRoiEnabledGuard(route, segments));
    return result === true ? true : router.serializeUrl(result as UrlTree);
  };

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    waitForReady = vi.fn().mockResolvedValue(false);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: FeatureFlagService, useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady } },
      ],
    });
    router = TestBed.inject(Router);
  });

  it('keeps the addressed organization when the flag is off', async () => {
    expect(await fallbackFor('/org/acme-inc/roi')).toBe('/org/acme-inc/overview');
    expect(await fallbackFor(`/org/${UID}/roi/project-1?tab=x`)).toBe(`/org/${UID}/overview`);
  });

  it('uses the legacy page address for a bare page address', async () => {
    expect(await fallbackFor('/org/roi')).toBe('/org/overview');
  });

  it('applies the same fallback to a pinned-off override and to a provider that never becomes ready', async () => {
    getFlagOverride.mockReturnValue(false);
    expect(await fallbackFor('/org/acme-inc/roi')).toBe('/org/acme-inc/overview');

    getFlagOverride.mockReturnValue(undefined);
    providerReady.set(false);
    expect(await fallbackFor('/org/acme-inc/roi')).toBe('/org/acme-inc/overview');
  });

  it('lets the route match when the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));
    expect(await fallbackFor('/org/acme-inc/roi')).toBe(true);
  });
});
