// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicShareKitController } from '../controllers/public-share-kit.controller';

const router = Router();
const publicShareKitController = new PublicShareKitController();

// GET /public/api/events/:eventSlug/share-kit - an event's public share kit (posts, blurb, graphics, CFP)
router.get('/:eventSlug/share-kit', (req, res, next) => publicShareKitController.getShareKit(req, res, next));

export default router;
