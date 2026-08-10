// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';

import { isServerFeatureEnabled, ServerFeatureFlag } from './server-feature-flag.helper';

const FLAG = ServerFeatureFlag.CampaignServiceJobs;

afterEach(() => {
  delete process.env[FLAG];
});

describe('isServerFeatureEnabled', () => {
  it('is OFF when the variable is unset', () => {
    expect(isServerFeatureEnabled(FLAG)).toBe(false);
  });

  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on'])('is ON for the affirmative value %j', (raw) => {
    process.env[FLAG] = raw;
    expect(isServerFeatureEnabled(FLAG)).toBe(true);
  });

  // Default-deny is the whole safety property. `flase` is invisible in a values.yaml diff, and
  // if an unrecognised value defaulted to ON it would route production traffic at a service the
  // operator believed was still dark. A typo must fail towards the path already known to work.
  it.each(['', 'false', '0', 'no', 'off', 'flase', 'enabled'])('is OFF for the non-affirmative value %j', (raw) => {
    process.env[FLAG] = raw;
    expect(isServerFeatureEnabled(FLAG)).toBe(false);
  });

  // Read per call, not captured at module load: a flag frozen at import time cannot be rolled
  // back without a restart, which is the point of putting it in an env var at all.
  it('reflects a change made after the module was imported', () => {
    expect(isServerFeatureEnabled(FLAG)).toBe(false);
    process.env[FLAG] = 'true';
    expect(isServerFeatureEnabled(FLAG)).toBe(true);
  });
});
