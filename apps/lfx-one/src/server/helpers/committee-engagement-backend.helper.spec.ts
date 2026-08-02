// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isEngagementMockBackend } from './committee-engagement-backend.helper';

const ENV_KEY = 'ENGAGEMENT_BACKEND';
const NODE_ENV_KEY = 'NODE_ENV';
const originalValue = process.env[ENV_KEY];
const originalNodeEnv = process.env[NODE_ENV_KEY];

function restore(key: string, original: string | undefined): void {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

describe('isEngagementMockBackend', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    delete process.env[NODE_ENV_KEY];
  });

  afterEach(() => {
    restore(ENV_KEY, originalValue);
    restore(NODE_ENV_KEY, originalNodeEnv);
  });

  it('is false (live) when the env var is unset', () => {
    expect(isEngagementMockBackend()).toBe(false);
  });

  it('is true when set to exactly "mock" and NODE_ENV is not production', () => {
    process.env[ENV_KEY] = 'mock';
    expect(isEngagementMockBackend()).toBe(true);
  });

  it('is false (live) when set to "mock" but NODE_ENV is production — the hard block', () => {
    process.env[ENV_KEY] = 'mock';
    process.env[NODE_ENV_KEY] = 'production';
    expect(isEngagementMockBackend()).toBe(false);
  });

  it('is false (live) for any other value, including near-misses of "mock" and explicit "live"', () => {
    process.env[ENV_KEY] = 'Mock';
    expect(isEngagementMockBackend()).toBe(false);
    process.env[ENV_KEY] = 'live';
    expect(isEngagementMockBackend()).toBe(false);
    process.env[ENV_KEY] = '';
    expect(isEngagementMockBackend()).toBe(false);
  });
});
