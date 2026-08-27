// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch, isImpersonating, logger, resolveRewardsSubject } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  isImpersonating: vi.fn(),
  logger: { debug: vi.fn(), warning: vi.fn() },
  resolveRewardsSubject: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  REWARD_CATEGORIES: ['Event', 'Training', 'Certification'],
  REWARD_STEP_SIZE: 500,
}));
vi.mock('../helpers/api-gateway.helper', () => ({
  getUserServiceBaseUrl: vi.fn(() => 'https://gateway.example.test/user-service/v1'),
}));
vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../utils/auth-helper', () => ({
  isImpersonating,
  usernameMatches: (expected: string, actual: string) => expected.replace(/^.*\|/, '') === actual.replace(/^.*\|/, ''),
}));
vi.mock('../utils/rewards-subject', () => ({ resolveRewardsSubject }));
vi.mock('./logger.service', () => ({ logger }));

import type { RewardPromotionsPage, RewardUserProfileRaw, RewardsSubject } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { RewardsService } from './rewards.service';

const req = { apiGatewayToken: 'staff-token' } as Request;
const selfSubject: RewardsSubject = { mode: 'self', readOnly: false };
const targetSubject: RewardsSubject = {
  mode: 'impersonated',
  username: 'target-user',
  salesforceId: '003-target',
  readOnly: true,
};
const profile: RewardUserProfileRaw = {
  Username: 'target-user',
  TuxRewards: 360.9,
  TuxProgramStartDate: '2026-01-01T00:00:00.000Z',
};
const promotionPage: RewardPromotionsPage = {
  Data: [
    {
      PromotionID: 'subscriber',
      Category: 'Training',
      Description: 'Subscriber incentive',
      Discount: 40,
      DiscountType: 'percentage',
      RequiredRewards: 0,
      Eligible: true,
      Products: [{ ID: 'training' }],
    },
    {
      PromotionID: 'tux-500',
      Category: 'Certification',
      Description: 'Tux coupon',
      RequiredRewards: 500,
      Eligible: true,
      Products: [{ ID: 'certification' }],
    },
  ],
  Metadata: { Offset: 0, PageSize: 500, TotalSize: 2 },
};

describe('RewardsService', () => {
  let service: RewardsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RewardsService();
    resolveRewardsSubject.mockResolvedValue(selfSubject);
    isImpersonating.mockReturnValue(false);
  });

  it('preserves self-scoped reads and existing reward calculations', async () => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => (url.endsWith('/me') ? profile : promotionPage));

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'available' },
      readOnly: false,
      points: 360,
      nextRewardPoints: 500,
      pointsToNextReward: 140,
      progressPercentage: 72,
      availableIncentives: [{ id: 'subscriber', eligible: true }],
      coupons: [{ id: 'tux-500', redeemPoints: 500 }],
    });
    expect(gatewayFetch.mock.calls.map((call) => call[1])).toEqual([
      'https://gateway.example.test/user-service/v1/me',
      'https://gateway.example.test/user-service/v1/me/promotions?offset=0&pageSize=500',
    ]);
    expect(gatewayFetch.mock.calls.every((call) => call[2]?.redactResponseBody === true)).toBe(true);
  });

  it('uses one resolved target for profile and every promotion page without a me fallback', async () => {
    resolveRewardsSubject.mockResolvedValue(targetSubject);
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => (url.endsWith('/users/003-target') ? profile : promotionPage));

    const summary = await service.getSummary(req);

    expect(summary.readOnly).toBe(true);
    expect(summary.points).toBe(360);
    expect(gatewayFetch.mock.calls.map((call) => call[1])).toEqual([
      'https://gateway.example.test/user-service/v1/users/003-target',
      'https://gateway.example.test/user-service/v1/users/003-target/promotions?offset=0&pageSize=500',
    ]);
    expect(gatewayFetch.mock.calls.some((call) => String(call[1]).includes('/me'))).toBe(false);
  });

  it.each([undefined, '360', Number.NaN, Number.POSITIVE_INFINITY, -1])('marks malformed profile points unavailable for %s', async (points) => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => (url.endsWith('/me') ? { ...profile, TuxRewards: points } : promotionPage));

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'unavailable', promotions: 'available' },
      points: null,
      nextRewardPoints: null,
      pointsToNextReward: null,
      progressPercentage: null,
      programStartDate: null,
      programExpiryDate: null,
      availableIncentives: [{ id: 'subscriber' }],
    });
  });

  it('keeps an explicit numeric zero available', async () => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => (url.endsWith('/me') ? { ...profile, TuxRewards: 0 } : promotionPage));

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'available' },
      points: 0,
      nextRewardPoints: 500,
      pointsToNextReward: 500,
      progressPercentage: 0,
    });
  });

  it('keeps an explicit complete empty promotion page available', async () => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) =>
      url.endsWith('/me') ? profile : { Data: [], Metadata: { Offset: 0, PageSize: 500, TotalSize: 0 } }
    );

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'available' },
      availableIncentives: [],
      coupons: [],
    });
  });

  it('fails the complete target summary when the profile username echo is mismatched', async () => {
    resolveRewardsSubject.mockResolvedValue(targetSubject);
    gatewayFetch.mockImplementation(async (_req: Request, url: string) =>
      url.endsWith('/users/003-target') ? { ...profile, Username: 'actor-user' } : promotionPage
    );

    await expect(service.getSummary(req)).rejects.toMatchObject({
      code: 'REWARDS_SUBJECT_MISMATCH',
    });
  });

  it('propagates a missing API Gateway token instead of reporting both sources unavailable', async () => {
    gatewayFetch.mockRejectedValue(
      Object.assign(new Error('gateway unavailable'), {
        code: 'API_GATEWAY_UNAVAILABLE',
        statusCode: 503,
      })
    );

    await expect(service.getSummary(req)).rejects.toMatchObject({
      code: 'API_GATEWAY_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it.each([401, 403])('propagates upstream authorization status %s instead of returning a degraded summary', async (statusCode) => {
    gatewayFetch.mockRejectedValue(
      Object.assign(new Error('upstream authorization failed'), {
        code: 'USER_PROFILE_FETCH_FAILED',
        statusCode,
      })
    );

    await expect(service.getSummary(req)).rejects.toMatchObject({
      code: 'USER_PROFILE_FETCH_FAILED',
      statusCode,
    });
  });

  it('marks malformed promotion entries unavailable instead of reporting an authoritative empty list', async () => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) =>
      url.endsWith('/me') ? profile : { Data: [{}], Metadata: { Offset: 0, PageSize: 500, TotalSize: 1 } }
    );

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'unavailable' },
      availableIncentives: [],
      coupons: [],
    });
  });

  it.each([
    ['a null promotion ID', { ...promotionPage.Data![0], PromotionID: null }],
    ['a null category', { ...promotionPage.Data![0], Category: null }],
    ['a numeric description', { ...promotionPage.Data![0], Description: 42 }],
    ['a null product', { ...promotionPage.Data![0], Products: [null] }],
    ['a null content type', { ...promotionPage.Data![0], TIContentTypes: [null] }],
    ['negative required rewards', { ...promotionPage.Data![0], RequiredRewards: -1 }],
    ['string eligibility', { ...promotionPage.Data![0], Eligible: 'false' }],
    ['string redemption state', { ...promotionPage.Data![0], Redeemed: 'false' }],
    ['a numeric coupon', { ...promotionPage.Data![0], Coupon: 123 }],
    ['non-array content types', { ...promotionPage.Data![0], Products: undefined, TIContentTypes: 'Training' }],
    ['a numeric discount type', { ...promotionPage.Data![0], DiscountType: 123 }],
    ['a string discount', { ...promotionPage.Data![0], Discount: '40' }],
    ['a numeric expiry', { ...promotionPage.Data![0], ExpiresAT: 123 }],
    ['a string relative expiry', { ...promotionPage.Data![0], RelativeExpiryInterval: '30' }],
    ['a numeric eligibility comment', { ...promotionPage.Data![0], EligiblityComment: 123 }],
    ['a numeric promotion logo', { ...promotionPage.Data![0], LogoURL: 123 }],
    ['a numeric product logo', { ...promotionPage.Data![0], Products: [{ ID: 'training', LogoURL: 123 }] }],
  ])('marks promotions unavailable when a promotion contains %s', async (_caseName, malformedPromotion) => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) =>
      url.endsWith('/me') ? profile : { Data: [malformedPromotion], Metadata: { Offset: 0, PageSize: 500, TotalSize: 1 } }
    );

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'unavailable' },
      availableIncentives: [],
      coupons: [],
    });
  });

  it.each([
    ['description', { ...promotionPage.Data![0], Description: null }],
    ['discount', { ...promotionPage.Data![0], Discount: null }],
    ['discount type', { ...promotionPage.Data![0], DiscountType: null }],
    ['required rewards', { ...promotionPage.Data![0], RequiredRewards: null }],
    ['relative expiry', { ...promotionPage.Data![0], RelativeExpiryInterval: null }],
    ['absolute expiry', { ...promotionPage.Data![0], ExpiresAT: null }],
    ['coupon', { ...promotionPage.Data![0], Coupon: null }],
    ['eligibility', { ...promotionPage.Data![0], Eligible: null }],
    ['redemption state', { ...promotionPage.Data![0], Redeemed: null }],
    ['eligibility comment', { ...promotionPage.Data![0], EligiblityComment: null }],
    ['promotion logo', { ...promotionPage.Data![0], LogoURL: null }],
    ['products', { ...promotionPage.Data![0], Products: null }],
    ['content types', { ...promotionPage.Data![0], TIContentTypes: null }],
    ['product fields', { ...promotionPage.Data![0], Products: [{ ID: null, Name: null, LogoURL: null }] }],
  ])('keeps promotions available when optional %s is null', async (_caseName, promotion) => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) =>
      url.endsWith('/me') ? profile : { Data: [promotion], Metadata: { Offset: 0, PageSize: 500, TotalSize: 1 } }
    );

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'available' },
    });
  });

  it('retrieves every promotion page before marking the source available', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      PromotionID: `promotion-${index}`,
      Category: 'Training',
      Description: `Promotion ${index}`,
      RequiredRewards: 0,
      Eligible: true,
      Products: [{ ID: 'training' }],
    }));
    const finalPromotion = { ...firstPage[0], PromotionID: 'promotion-500', Description: 'Promotion 500' };
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => {
      if (url.endsWith('/me')) return profile;
      if (url.includes('offset=0')) return { Data: firstPage, Metadata: { Offset: 0, PageSize: 500, TotalSize: 501 } };
      return { Data: [finalPromotion], Metadata: { Offset: 500, PageSize: 500, TotalSize: 501 } };
    });

    const summary = await service.getSummary(req);

    expect(summary.availability.promotions).toBe('available');
    expect(summary.availableIncentives).toHaveLength(501);
    expect(gatewayFetch.mock.calls.map((call) => call[1])).toContain('https://gateway.example.test/user-service/v1/me/promotions?offset=500&pageSize=500');
  });

  it.each([
    ['missing Data', { Metadata: { Offset: 0, PageSize: 500, TotalSize: 1 } }],
    ['missing Metadata', { Data: promotionPage.Data }],
    ['a malformed item', { Data: [null], Metadata: { Offset: 0, PageSize: 500, TotalSize: 1 } }],
    ['a short incomplete page', { Data: [promotionPage.Data![0]], Metadata: { Offset: 0, PageSize: 500, TotalSize: 2 } }],
  ])('invalidates the complete promotion source for %s', async (_caseName, malformedPage) => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => (url.endsWith('/me') ? profile : malformedPage));

    await expect(service.getSummary(req)).resolves.toMatchObject({
      availability: { profile: 'available', promotions: 'unavailable' },
      points: 360,
      availableIncentives: [],
      coupons: [],
    });
  });

  it('blocks coupon generation inside the service during impersonation', async () => {
    isImpersonating.mockReturnValue(true);

    await expect(service.redeemPromotion(req, 'subscriber')).rejects.toMatchObject({
      code: 'IMPERSONATION_READ_ONLY',
      statusCode: 403,
    });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('redacts coupon-generation upstream response bodies for direct users', async () => {
    gatewayFetch.mockResolvedValue({ PromotionID: 'subscriber', CouponCode: 'coupon-code' });

    await expect(service.redeemPromotion(req, 'subscriber')).resolves.toEqual({
      PromotionID: 'subscriber',
      CouponCode: 'coupon-code',
    });
    expect(gatewayFetch).toHaveBeenCalledWith(
      req,
      'https://gateway.example.test/user-service/v1/me/promotions/subscriber/generateCoupon',
      expect.objectContaining({ method: 'POST', redactResponseBody: true })
    );
  });
});
