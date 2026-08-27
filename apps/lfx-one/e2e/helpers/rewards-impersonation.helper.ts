// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Page } from '@playwright/test';
import type { RewardPromotion, RewardsSummaryResponse } from '@lfx-one/shared/interfaces';

export const REWARDS_URL = '/me/training';

export function rewardPromotion(overrides: Partial<RewardPromotion> = {}): RewardPromotion {
  return {
    id: 'subscriber',
    uid: 'subscriber',
    category: 'Training',
    title: 'Subscriber incentive',
    discountLabel: '40% OFF',
    redeemPoints: 0,
    eligible: true,
    redeemed: false,
    coupon: '',
    expiresAt: '',
    relativeExpiryInterval: 0,
    eligibilityComment: 'Active subscriber benefit',
    logo: '',
    ...overrides,
  };
}

export function rewardsSummary(overrides: Partial<RewardsSummaryResponse> = {}): RewardsSummaryResponse {
  const incentive = rewardPromotion();
  const coupon = rewardPromotion({
    id: 'tux-500',
    uid: 'tux-500',
    category: 'Certification',
    title: 'Tux 500-point coupon',
    discountLabel: '50% OFF',
    redeemPoints: 500,
    eligibilityComment: '',
  });

  return {
    availability: { profile: 'available', promotions: 'available' },
    readOnly: false,
    points: 360,
    nextRewardPoints: 500,
    pointsToNextReward: 140,
    progressPercentage: 72,
    programStartDate: '2026-01-01T00:00:00.000Z',
    programExpiryDate: '2027-01-01T00:00:00.000Z',
    groupedPromotions: {
      Event: { earned: [], redeemable: [] },
      Training: { earned: [incentive], redeemable: [] },
      Certification: { earned: [], redeemable: [coupon] },
    },
    availableIncentives: [incentive],
    coupons: [coupon],
    ...overrides,
  };
}

export async function mockTrainingShell(page: Page): Promise<void> {
  await page.route('**/api/training/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

export async function mockRewardsSummary(page: Page, summary: RewardsSummaryResponse): Promise<void> {
  await page.route('**/api/rewards/summary**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) });
  });
}

export async function openRewards(page: Page): Promise<void> {
  await page.goto(REWARDS_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Rewards', exact: true }).click();
}
