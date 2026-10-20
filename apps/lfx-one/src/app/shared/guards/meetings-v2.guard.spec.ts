// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, UrlSegment } from '@angular/router';
import { MEETING_V2_ENABLED_DEFAULT, MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meetingsV2Guard } from './meetings-v2.guard';

describe('meetingsV2Guard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;

  const route: Route = { path: 'create' };
  const segments: UrlSegment[] = [];
  const runGuard = (): ReturnType<typeof meetingsV2Guard> => TestBed.runInInjectionContext(() => meetingsV2Guard(route, segments));

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));
    waitForReady = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('matches the composer route when the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));

    expect(await runGuard()).toBe(true);
    expect(getBooleanFlag).toHaveBeenCalledWith(MEETING_V2_ENABLED_FLAG, MEETING_V2_ENABLED_DEFAULT);
  });

  it('falls through to the wizard route when the flag is off', async () => {
    expect(await runGuard()).toBe(false);
  });

  it('matches on the server without evaluating the flag, so SSR paints the list and the browser decides', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    expect(await runGuard()).toBe(true);
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('lets a local override decide before the provider is consulted', async () => {
    providerReady.set(false);
    getFlagOverride.mockReturnValue(true);

    expect(await runGuard()).toBe(true);
    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('waits for the provider, then reads the flag', async () => {
    providerReady.set(false);
    getBooleanFlag.mockReturnValue(signal(true));

    expect(await runGuard()).toBe(true);
    expect(waitForReady).toHaveBeenCalledWith({ guard: 'meetingsV2Guard', flag: MEETING_V2_ENABLED_FLAG });
  });

  it('uses the code default when the provider never becomes ready', async () => {
    providerReady.set(false);
    waitForReady.mockResolvedValue(false);

    expect(await runGuard()).toBe(MEETING_V2_ENABLED_DEFAULT);
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
