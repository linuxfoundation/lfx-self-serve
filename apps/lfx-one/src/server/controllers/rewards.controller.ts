// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { RewardsService } from '../services/rewards.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class RewardsController {
  private readonly rewardsService = new RewardsService();

  /**
   * GET /api/rewards/summary
   * Returns reward points, incentives, and coupon data for the authenticated user
   */
  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_rewards_summary');

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_rewards_summary',
        });
      }

      const summary = await this.rewardsService.getSummary(req);

      logger.success(req, 'get_rewards_summary', startTime, {
        points: summary.points,
        incentives_count: summary.availableIncentives.length,
        coupons_count: summary.coupons.length,
      });

      res.json(summary);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rewards/promotions/:promotionId/redeem
   * Generates a coupon code for a points-based promotion
   */
  public async redeemPromotion(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'redeem_promotion');

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        throw new AuthenticationError('User authentication required', {
          operation: 'redeem_promotion',
        });
      }

      const promotionId = req.params['promotionId']?.trim();

      if (!promotionId) {
        throw ServiceValidationError.forField('promotionId', 'Promotion ID is required', {
          operation: 'redeem_promotion',
          service: 'rewards_controller',
          path: req.path,
        });
      }

      const result = await this.rewardsService.redeemPromotion(req, promotionId);

      logger.success(req, 'redeem_promotion', startTime, {
        promotion_id: promotionId,
        has_coupon: Boolean(result.CouponCode),
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
