// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SnowflakeQueryOptions } from '@lfx-one/shared/interfaces';

vi.mock('../services/logger.service', () => ({
  logger: {
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

import { LockManager } from './lock-manager';

describe('LockManager.hashQuery', () => {
  let lockManager: LockManager | undefined;

  afterEach(() => {
    lockManager?.shutdown();
    lockManager = undefined;
  });

  it('includes execution and expected-error options in the deduplication key', () => {
    lockManager = new LockManager();
    const baseOptions: SnowflakeQueryOptions = {
      timeout: 1_000,
      fetchAsString: ['Number'],
      expectMissingObject: true,
      expectInvalidIdentifier: 'LAST_TOUCH_CONVERSIONS',
    };
    const baseKey = lockManager.hashQuery('SELECT 1', [], baseOptions);

    expect(lockManager.hashQuery('SELECT 1', [], { ...baseOptions })).toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { ...baseOptions, timeout: 2_000 })).not.toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { ...baseOptions, fetchAsString: ['Date'] })).not.toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { ...baseOptions, expectMissingObject: false })).not.toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { ...baseOptions, expectInvalidIdentifier: 'CONV' })).not.toBe(baseKey);
  });
});
