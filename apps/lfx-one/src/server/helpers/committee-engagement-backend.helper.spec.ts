// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isEngagementMockBackend } from './committee-engagement-backend.helper';

const ENV_KEY = 'ENGAGEMENT_BACKEND';
const originalValue = process.env[ENV_KEY];

describe('isEngagementMockBackend', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalValue === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalValue;
  });

  it('is true when the env var is unset', () => {
    expect(isEngagementMockBackend()).toBe(true);
  });

  it('is false when set to exactly "live"', () => {
    process.env[ENV_KEY] = 'live';
    expect(isEngagementMockBackend()).toBe(false);
  });

  it('is true for any other value, including near-misses of "live"', () => {
    process.env[ENV_KEY] = 'Live';
    expect(isEngagementMockBackend()).toBe(true);
    process.env[ENV_KEY] = 'mock';
    expect(isEngagementMockBackend()).toBe(true);
    process.env[ENV_KEY] = '';
    expect(isEngagementMockBackend()).toBe(true);
  });
});
