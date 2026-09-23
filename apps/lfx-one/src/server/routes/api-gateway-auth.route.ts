// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { API_GATEWAY_AUTH } from '@lfx-one/shared/constants';
import { Router } from 'express';

import { ApiGatewayAuthController } from '../controllers/api-gateway-auth.controller';
import { authRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();
const controller = new ApiGatewayAuthController();

router.get(API_GATEWAY_AUTH.START_PATH, authRateLimiter, (req, res, next) => controller.start(req, res, next));
router.get(API_GATEWAY_AUTH.CALLBACK_PATH, authRateLimiter, (req, res, next) => controller.callback(req, res, next));

export default router;
