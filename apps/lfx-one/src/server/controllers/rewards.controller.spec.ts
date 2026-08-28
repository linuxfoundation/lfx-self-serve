// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSummary, getUsernameFromAuth, logger } = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn() },
}));

vi.mock('../services/rewards.service', () => ({
  RewardsService: class {
    public getSummary = getSummary;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));

import type { NextFunction, Request, Response } from 'express';

import { RewardsController } from './rewards.controller';

describe('RewardsController.getSummary', () => {
  const req = {} as Request;
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the explicit authentication rejection before service resolution', async () => {
    getUsernameFromAuth.mockResolvedValue(null);

    await new RewardsController().getSummary(req, res, next);

    expect(getSummary).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }));
  });

  it('logs only subject mode, availability, and source counts', async () => {
    getUsernameFromAuth.mockResolvedValue('target-user');
    getSummary.mockResolvedValue({
      availability: { profile: 'available', promotions: 'unavailable' },
      readOnly: true,
      points: 360,
      nextRewardPoints: 500,
      pointsToNextReward: 140,
      progressPercentage: 72,
      programStartDate: null,
      programExpiryDate: null,
      groupedPromotions: {},
      availableIncentives: [],
      coupons: [],
    });

    await new RewardsController().getSummary(req, res, next);

    expect(logger.success).toHaveBeenCalledWith(
      req,
      'get_rewards_summary',
      0,
      expect.objectContaining({
        subject_mode: 'impersonated',
        profile_availability: 'available',
        promotions_availability: 'unavailable',
        incentives_count: 0,
        coupons_count: 0,
      })
    );
    const context = logger.success.mock.calls[0]?.[3];
    expect(context).not.toHaveProperty('points');
    expect(context).not.toHaveProperty('username');
  });
});
