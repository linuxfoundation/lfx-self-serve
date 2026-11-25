// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicShareKitController } from '../controllers/public-share-kit.controller';
import { shareKitMemberRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();
const publicShareKitController = new PublicShareKitController();

// GET /public/api/events/:eventSlug/share-kit - an event's public share kit (posts, blurb, graphics, CFP), plus the
// visitor's member offer. Signed-in reads run a membership lookup, so they're metered per user.
router.get('/:eventSlug/share-kit', shareKitMemberRateLimiter, (req, res, next) => publicShareKitController.getShareKit(req, res, next));

export default router;
