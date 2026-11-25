// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInTargetCostRefusal } from './campaign-linkedin-target-cost.utils';

const config = (bidding: unknown) => ({ budgetUsd: 100, bidding });

describe('linkedInTargetCostRefusal', () => {
  it.each([
    ['no bidding, on a deployment without target cost', { budgetUsd: 100 }, false],
    ['automatic bidding with no target, on a deployment without target cost', config({ strategy: 'automatic' }), false],
    ['a bidding that is not an object (campaign-service refuses it itself)', config(null), true],
    ['a target with automatic bidding', config({ strategy: 'automatic', targetAmount: 17.88 }), true],
    ['a target with the strategy omitted', config({ targetAmount: 10 }), true],
    ['the smallest target', config({ targetAmount: 0.01 }), true],
    ['the largest target', config({ targetAmount: 1_000_000 }), true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInTargetCostRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['a null target', config({ targetAmount: null }), true, 'must be a number'],
    ['a target that is text', config({ targetAmount: '17.88' }), true, 'must be a number'],
    ['a target that is a boolean', config({ targetAmount: true }), true, 'must be a number'],
    ['a null target, before the flag', config({ targetAmount: null }), false, 'must be a number'],
    ['a target without the flag', config({ strategy: 'automatic', targetAmount: 17.88 }), false, 'cannot set a LinkedIn target cost'],
    ['an out-of-range target without the flag, named as the flag', config({ targetAmount: -1 }), false, 'cannot set a LinkedIn target cost'],
    ['a target with manual bidding', config({ strategy: 'manual', bidAmount: 5, targetAmount: 17.88 }), true, 'only accepted with automatic bidding'],
    ['a zero target', config({ targetAmount: 0 }), true, 'greater than zero'],
    ['a negative target', config({ targetAmount: -5 }), true, 'greater than zero'],
    ['a target over the ceiling', config({ targetAmount: 1_000_000.01 }), true, 'at most 1,000,000'],
    ['a target that rounds to zero cents', config({ targetAmount: 0.004 }), true, 'smallest target cost is 0.01'],
    ['a target with a third decimal', config({ targetAmount: 17.885 }), true, 'whole number of cents'],
  ])('refuses %s', (_name, raw, enabled, message) => {
    const refusal = linkedInTargetCostRefusal(raw, enabled);
    expect(refusal?.field).toBe('linkedInConfig.bidding.targetAmount');
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(linkedInTargetCostRefusal(config({ targetAmount: 'SECRET_AMOUNT' }), true)?.message).not.toContain('SECRET_AMOUNT');
    expect(linkedInTargetCostRefusal(config({ targetAmount: 12.345 }), true)?.message).not.toContain('12.345');
  });
});
