// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RewardPromotion } from '../interfaces/rewards.interface';
import { decorateCoupons, isCouponRedeemable } from './rewards.utils';

const pointsCoupon: RewardPromotion = {
  id: 'tux-500',
  uid: 'tux-500',
  category: 'Training',
  title: 'Tux coupon',
  discountLabel: '50% OFF',
  redeemPoints: 500,
  eligible: true,
  redeemed: false,
  coupon: '',
  expiresAt: '',
  relativeExpiryInterval: 0,
  eligibilityComment: '',
  logo: '',
};

describe('isCouponRedeemable', () => {
  it.each([
    ['sufficient points', pointsCoupon, 500, true],
    ['insufficient points', pointsCoupon, 499, false],
    ['unavailable required points', pointsCoupon, null, false],
    ['a zero-point coupon with unavailable points', { ...pointsCoupon, redeemPoints: 0 }, null, true],
    ['a missing ID', { ...pointsCoupon, id: '' }, 500, false],
    ['an ineligible coupon', { ...pointsCoupon, eligible: false }, 500, false],
    ['a redeemed coupon', { ...pointsCoupon, redeemed: true }, 500, false],
    ['an issued coupon', { ...pointsCoupon, coupon: 'EXISTING-CODE' }, 500, false],
  ])('returns the expected result for %s', (_caseName, coupon, rewardPoints, expected) => {
    expect(isCouponRedeemable(coupon, rewardPoints)).toBe(expected);
  });
});

describe('decorateCoupons with unavailable reward points', () => {
  it('suppresses point shortfall and point-derived status when points are unavailable', () => {
    const [decorated] = decorateCoupons([pointsCoupon], null, null);

    expect(decorated).toMatchObject({
      pointsShortfall: null,
      statusLabel: 'Points unavailable',
      description: 'Reward points are unavailable, so this coupon status cannot be determined.',
    });
  });

  it('preserves explicit zero as a real points balance', () => {
    const [decorated] = decorateCoupons([pointsCoupon], 0, null);

    expect(decorated).toMatchObject({
      pointsShortfall: 500,
      statusLabel: 'Locked',
      description: '500 points required to unlock this coupon.',
    });
  });

  it('keeps an existing coupon available when points are unavailable', () => {
    const [decorated] = decorateCoupons([{ ...pointsCoupon, coupon: 'EXISTING-CODE' }], null, null);

    expect(decorated).toMatchObject({
      hasCouponCode: true,
      pointsShortfall: null,
      statusLabel: 'Available',
      coupon: 'EXISTING-CODE',
    });
  });

  it('preserves an issued coupon eligibility restriction in its description', () => {
    const [decorated] = decorateCoupons([{ ...pointsCoupon, coupon: 'EXISTING-CODE', eligibilityComment: 'Only valid for selected courses.' }], 500, null);

    expect(decorated.description).toBe('Only valid for selected courses.');
  });
});
