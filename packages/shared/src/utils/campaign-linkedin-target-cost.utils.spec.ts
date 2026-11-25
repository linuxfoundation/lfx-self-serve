// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { LinkedInObjectiveDraft } from '../interfaces/campaign.interface';
import {
  linkedInBiddingWithTargetCost,
  linkedInObjectiveDraftWithTargetCost,
  linkedInTargetCostCreateRefusal,
  linkedInTargetCostInputError,
  linkedInTargetCostOffered,
  linkedInTargetCostRefusal,
} from './campaign-linkedin-target-cost.utils';

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

describe('linkedInTargetCostOffered', () => {
  it.each([
    ['on, with bidding offered and untouched (automatic)', true, true, undefined, true],
    ['on, with automatic chosen', true, true, 'automatic', true],
    ['on, with manual chosen', true, true, 'manual', false],
    ['on, without the Bidding control', true, false, 'automatic', false],
    ['off', false, true, 'automatic', false],
    ['not read yet', null, true, 'automatic', false],
  ] as const)('%s', (_name, enabled, biddingAvailable, strategy, expected) => {
    expect(linkedInTargetCostOffered({ enabled, biddingAvailable, strategy })).toBe(expected);
  });
});

describe('the Implement tab target cost', () => {
  const objective = (targetCost?: string): LinkedInObjectiveDraft => ({
    objective: null,
    conversions: [],
    conversionsOwner: null,
    ...(targetCost === undefined ? {} : { targetCost }),
  });
  const automatic = { bidding: { strategy: 'automatic' as const } };

  it.each([
    ['nothing typed', undefined, true, null],
    ['a blank', '  ', true, null],
    ['an amount', '17.88', true, null],
    ['a whole amount with a trailing point', '20.', true, null],
    ['a refused amount while hidden', '0', false, null],
    ['zero', '0', true, 'greater than zero'],
    ['a negative amount', '-5', true, 'greater than zero'],
    ['a third decimal', '17.885', true, 'whole number of cents'],
    ['over the ceiling', '1000000.01', true, 'at most 1,000,000'],
    ['text', 'ten', true, 'must be a number'],
    ['an exponent, never read as an amount', '1e3', true, 'must be a number'],
    ['hex, never read as an amount', '0x10', true, 'must be a number'],
  ])('%s: the field says %j', (_name, typed, offered, message) => {
    const error = linkedInTargetCostInputError(typed, offered);
    if (message === null) expect(error).toBeNull();
    else expect(error).toContain(message);
    const refusal = linkedInTargetCostCreateRefusal(objective(typed), offered);
    expect(refusal).toBe(error === null ? null : `LinkedIn Ads: ${error}`);
  });

  it.each([
    ['an amount', objective(), '17.8', objective('17.8')],
    ['an edit', objective('17'), '17.88', objective('17.88')],
    ['a cleared field, removing it', objective('17.88'), '', objective()],
    ['a blank, removing it', objective('17.88'), '  ', objective()],
  ])('keeps %s in the draft', (_name, draft, typed, expected) => {
    expect(linkedInObjectiveDraftWithTargetCost({ ...draft, objective: 'traffic' }, typed)).toEqual({ ...expected, objective: 'traffic' });
  });

  it.each([
    ['an amount beside automatic bidding', automatic, '17.88', true, { bidding: { strategy: 'automatic', targetAmount: 17.88 } }],
    ['nothing typed', automatic, undefined, true, automatic],
    ['a blank', automatic, ' ', true, automatic],
    ['an amount kept while hidden', automatic, '17.88', false, automatic],
    [
      'an amount beside manual bidding',
      { bidding: { strategy: 'manual' as const, bidAmount: 4 } },
      '17.88',
      true,
      { bidding: { strategy: 'manual', bidAmount: 4 } },
    ],
    ['an amount with no bidding sent', {}, '17.88', true, {}],
    ['text, which Create holds', automatic, 'ten', true, automatic],
  ])('sends %s as %j', (_name, field, typed, offered, expected) => {
    expect(linkedInBiddingWithTargetCost(field, objective(typed), offered)).toEqual(expected);
  });
});
