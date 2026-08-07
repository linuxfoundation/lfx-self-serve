// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    const baseKey = lockManager.hashQuery('SELECT 1', [], { expectInvalidIdentifier: 'LAST_TOUCH_CONVERSIONS' });

    expect(lockManager.hashQuery('SELECT 1', [], { expectInvalidIdentifier: 'LAST_TOUCH_CONVERSIONS' })).toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { expectInvalidIdentifier: 'CONV' })).not.toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { expectMissingObject: true })).not.toBe(baseKey);
    expect(lockManager.hashQuery('SELECT 1', [], { timeout: 1_000 })).not.toBe(baseKey);
  });
});
