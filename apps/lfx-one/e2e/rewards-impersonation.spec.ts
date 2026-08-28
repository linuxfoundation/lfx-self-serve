// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import type { RewardsSummaryResponse } from '@lfx-one/shared/interfaces';

import { mockRewardsSummary, mockTrainingShell, openRewards, rewardPromotion, rewardsSummary } from './helpers/rewards-impersonation.helper';

test.describe('Rewards impersonation contract', () => {
  test.beforeEach(async ({ page }) => {
    await mockTrainingShell(page);
  });

  test('renders target points, subscriber incentive, and points-gated coupon from one summary', async ({ page }) => {
    await mockRewardsSummary(page, rewardsSummary({ readOnly: true }));

    await openRewards(page);

    await expect(page.getByTestId('rewards-points')).toHaveText('360');
    await expect(page.getByTestId('available-incentive-card')).toContainText('Subscriber incentive');
    await expect(page.getByTestId('my-coupon-card')).toContainText('Tux 500-point coupon');
    await expect(page.getByTestId('rewards-read-only-notice')).toBeVisible();
  });

  test('distinguishes explicit zero points from unavailable profile data', async ({ page }) => {
    await mockRewardsSummary(page, rewardsSummary({ points: 0, pointsToNextReward: 500, progressPercentage: 0 }));
    await openRewards(page);
    await expect(page.getByTestId('rewards-points')).toHaveText('0');
    await expect(page.getByTestId('rewards-profile-unavailable')).not.toBeAttached();
  });

  test('renders profile unavailable while preserving independent promotions', async ({ page }) => {
    await mockRewardsSummary(
      page,
      rewardsSummary({
        availability: { profile: 'unavailable', promotions: 'available' },
        points: null,
        nextRewardPoints: null,
        pointsToNextReward: null,
        progressPercentage: null,
        programStartDate: null,
        programExpiryDate: null,
      })
    );

    await openRewards(page);

    await expect(page.getByTestId('rewards-profile-unavailable')).toBeVisible();
    await expect(page.getByTestId('available-incentive-card')).toContainText('Subscriber incentive');
    await expect(page.getByTestId('my-coupon-card')).toContainText('Points unavailable');
    await expect(page.getByTestId('coupon-points-shortfall')).not.toBeAttached();
  });

  test('renders promotions unavailable instead of a valid empty state', async ({ page }) => {
    await mockRewardsSummary(
      page,
      rewardsSummary({
        availability: { profile: 'available', promotions: 'unavailable' },
        groupedPromotions: {
          Event: { earned: [], redeemable: [] },
          Training: { earned: [], redeemable: [] },
          Certification: { earned: [], redeemable: [] },
        },
        availableIncentives: [],
        coupons: [],
      })
    );

    await openRewards(page);

    await expect(page.getByTestId('available-incentives-unavailable')).toBeVisible();
    await expect(page.getByTestId('my-coupons-unavailable')).toBeVisible();
    await expect(page.getByText('No available incentives right now.')).not.toBeAttached();
  });

  test('keeps claim and redeem visible but disabled while allowing existing-code copy', async ({ page }) => {
    const existingCoupon = rewardPromotion({
      id: 'existing',
      uid: 'existing',
      title: 'Existing coupon',
      coupon: 'EXISTING-CODE',
    });
    const summary = rewardsSummary({
      readOnly: true,
      availableIncentives: [rewardPromotion(), existingCoupon],
      coupons: [
        rewardPromotion({
          id: 'tux-500',
          uid: 'tux-500',
          title: 'Tux coupon',
          redeemPoints: 500,
        }),
      ],
    });
    await mockRewardsSummary(page, summary);

    await openRewards(page);

    await expect(page.getByTestId('available-incentive-claim-button').locator('button')).toBeDisabled();
    await expect(page.getByTestId('coupon-redeem-button').locator('button')).toBeDisabled();
    await expect(page.getByTestId('available-incentive-copy-button')).toBeEnabled();
    await expect(page.getByText('Rewards are read-only while impersonating.')).toBeVisible();
  });

  test('preserves direct-user Claim and Redeem actions', async ({ page }) => {
    await mockRewardsSummary(page, rewardsSummary({ points: 500, nextRewardPoints: 1_000, pointsToNextReward: 500, progressPercentage: 50 }));

    await openRewards(page);

    await expect(page.getByTestId('available-incentive-claim-button').locator('button')).toBeEnabled();
    await expect(page.getByTestId('coupon-redeem-button').locator('button')).toBeEnabled();
  });
});

test('live BFF returns the configured target rewards while impersonating', async ({ page }) => {
  const targetUser = process.env.TEST_IMPERSONATION_TARGET_USERNAME;
  const expectedPoints = process.env.TEST_IMPERSONATION_TARGET_EXPECTED_POINTS;
  const expectedPromotion = process.env.TEST_IMPERSONATION_TARGET_EXPECTED_PROMOTION;
  test.skip(!targetUser || !expectedPoints || !expectedPromotion, 'live impersonation target variables are not configured');

  const start = await page.request.post('/api/impersonate', { data: { targetUser } });
  expect(start.ok()).toBe(true);

  try {
    const baselineResponse = await page.request.get('/api/rewards/summary');
    expect(baselineResponse.ok()).toBe(true);
    const baseline = (await baselineResponse.json()) as RewardsSummaryResponse;

    await openRewards(page);
    await expect(page.getByTestId('rewards-points')).toHaveText(expectedPoints!);
    await expect(page.getByTestId('rewards-tab')).toContainText(expectedPromotion!);
    await expect(page.getByTestId('rewards-read-only-notice')).toBeVisible();

    const overriddenResponse = await page.request.get('/api/rewards/summary?username=actor-user&salesforceId=actor-sfid');
    expect(await overriddenResponse.json()).toEqual(baseline);

    const actionablePromotion = [...baseline.availableIncentives, ...baseline.coupons].find(
      (promotion) => promotion.id && promotion.eligible && !promotion.redeemed && !promotion.coupon
    );
    if (!actionablePromotion) throw new Error('Configured impersonation target has no actionable reward promotion');

    const blocked = await page.request.post(`/api/rewards/promotions/${encodeURIComponent(actionablePromotion.id)}/redeem`, { data: {} });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).code).toBe('IMPERSONATION_READ_ONLY');

    const afterBlockedResponse = await page.request.get('/api/rewards/summary');
    expect(await afterBlockedResponse.json()).toEqual(baseline);
  } finally {
    await page.request.post('/api/impersonate/stop', { data: {} });
  }
});
