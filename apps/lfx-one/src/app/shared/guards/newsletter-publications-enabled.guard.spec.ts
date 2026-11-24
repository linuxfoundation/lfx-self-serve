// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, UrlSegment } from '@angular/router';
import { NEWSLETTER_ENHANCED_EDITOR_DEFAULT, NEWSLETTER_ENHANCED_EDITOR_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newsletterPublicationsEnabledGuard } from './newsletter-publications-enabled.guard';

describe('newsletterPublicationsEnabledGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;

  const route: Route = { path: 'publications/new' };
  const segments: UrlSegment[] = [];

  const runGuard = (): ReturnType<typeof newsletterPublicationsEnabledGuard> =>
    TestBed.runInInjectionContext(() => newsletterPublicationsEnabledGuard(route, segments));

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    waitForReady = vi.fn().mockImplementation(() => Promise.resolve(providerReady()));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady },
        },
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

  it.each([true, false])('lets a local override of %s decide without waiting for the provider', async (override) => {
    getFlagOverride.mockReturnValue(override);
    providerReady.set(false);

    expect(await runGuard()).toBe(override);
    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it.each([true, false])('returns the flag value %s once the provider is ready', async (value) => {
    getBooleanFlag.mockReturnValue(signal(value));

    expect(await runGuard()).toBe(value);
    expect(getBooleanFlag).toHaveBeenCalledWith(NEWSLETTER_ENHANCED_EDITOR_FLAG, NEWSLETTER_ENHANCED_EDITOR_DEFAULT);
  });

  it('fails closed when the provider never becomes ready', async () => {
    providerReady.set(false);

    expect(await runGuard()).toBe(false);
    expect(waitForReady).toHaveBeenCalledWith({ guard: 'newsletterPublicationsEnabledGuard', flag: NEWSLETTER_ENHANCED_EDITOR_FLAG });
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
