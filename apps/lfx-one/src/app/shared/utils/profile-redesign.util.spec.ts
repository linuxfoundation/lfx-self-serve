// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FeatureFlagService } from '@services/feature-flag.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { injectProfileRedesignEnabled, PROFILE_REDESIGN_KEY } from './profile-redesign.util';

describe('injectProfileRedesignEnabled', () => {
  const flag = signal(true);
  const hydrated = signal(false);
  const read = () => TestBed.runInInjectionContext(() => injectProfileRedesignEnabled(hydrated));

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FeatureFlagService, useValue: { getBooleanFlag: () => flag } }] });
    flag.set(true);
    hydrated.set(false);
  });

  it("follows the server's answer when the render made one, even before hydration", () => {
    TestBed.inject(TransferState).set(PROFILE_REDESIGN_KEY, true);
    expect(read()()).toBe(true);
  });

  it('otherwise waits for hydration before reading the browser flag, so the first render matches the server', () => {
    const enabled = read();
    expect(enabled()).toBe(false);

    hydrated.set(true);
    expect(enabled()).toBe(true);

    flag.set(false);
    expect(enabled()).toBe(false);
  });
});
