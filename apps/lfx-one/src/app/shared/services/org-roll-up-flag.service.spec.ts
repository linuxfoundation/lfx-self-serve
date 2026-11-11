// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FEATURE_FLAG_READY_TIMEOUT_MS, ORG_LENS_ROLLUP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureFlagService } from './feature-flag.service';
import { OrgRollUpFlagService } from './org-roll-up-flag.service';

describe('OrgRollUpFlagService', () => {
  let initialized: WritableSignal<boolean>;
  let providerReady: WritableSignal<boolean>;
  let flagValue: WritableSignal<boolean>;
  let override: boolean | undefined;
  let getBooleanFlag: ReturnType<typeof vi.fn>;

  const setup = (platformId: 'browser' | 'server' = 'browser'): OrgRollUpFlagService => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        {
          provide: FeatureFlagService,
          useValue: { initialized, providerReady, getBooleanFlag, getFlagOverride: () => override },
        },
      ],
    });
    return TestBed.inject(OrgRollUpFlagService);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    initialized = signal(false);
    providerReady = signal(false);
    flagValue = signal(false);
    override = undefined;
    getBooleanFlag = vi.fn(() => flagValue);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('reads the org-lens-rollup-enabled flag, defaulting to off', () => {
    setup();
    expect(getBooleanFlag).toHaveBeenCalledWith(ORG_LENS_ROLLUP_ENABLED_FLAG, false);
  });

  // LaunchDarkly reports READY for the anonymous bootstrap context before the signed-in user is identified.
  it('stays unsettled through the anonymous window, even with the provider ready', () => {
    const service = setup();
    providerReady.set(true);
    flagValue.set(true);

    expect(service.unsettled()).toBe(true);
    expect(service.enabled()).toBe(false);
  });

  it('settles once the signed-in user is identified and the provider is ready', () => {
    const service = setup();
    initialized.set(true);
    providerReady.set(true);

    expect(service.unsettled()).toBe(false);
    expect(service.enabled()).toBe(false);

    flagValue.set(true);
    expect(service.enabled()).toBe(true);
  });

  it('fails closed: settles as off once the readiness budget runs out', () => {
    const service = setup();
    flagValue.set(true);

    vi.advanceTimersByTime(FEATURE_FLAG_READY_TIMEOUT_MS - 1);
    expect(service.unsettled()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(service.unsettled()).toBe(false);
    expect(service.enabled()).toBe(false);

    // An answer that arrives after the budget still counts.
    initialized.set(true);
    providerReady.set(true);
    expect(service.enabled()).toBe(true);
  });

  it('treats a locally pinned value as settled', () => {
    override = true;
    flagValue.set(true);
    const service = setup();

    expect(service.unsettled()).toBe(false);
    expect(service.enabled()).toBe(true);
  });

  // SSR never settles: the server admits a restored roll-up and lets the browser decide.
  it('never settles on the server and starts no timer there', () => {
    const service = setup('server');

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(FEATURE_FLAG_READY_TIMEOUT_MS);
    expect(service.unsettled()).toBe(true);
    expect(service.enabled()).toBe(false);
  });
});
