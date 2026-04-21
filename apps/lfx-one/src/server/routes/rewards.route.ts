// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Router } from 'express';

import { RewardsController } from '../controllers/rewards.controller';

const router = Router();
const rewardsController = new RewardsController();

router.get('/summary', (req, res, next) => rewardsController.getSummary(req, res, next));
router.post('/promotions/:promotionId/redeem', (req, res, next) => rewardsController.redeemPromotion(req, res, next));

export default router;
