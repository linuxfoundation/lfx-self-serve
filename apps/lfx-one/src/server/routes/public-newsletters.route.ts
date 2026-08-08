// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicNewsletterController } from '../controllers/public-newsletter.controller';

const router = Router();
const publicNewsletterController = new PublicNewsletterController();

// GET /public/api/newsletters/:projectUid/:newsletterUid - get the "View Online" projection of a sent newsletter (public access, no authentication required)
router.get('/:projectUid/:newsletterUid', (req, res, next) => publicNewsletterController.getPublicView(req, res, next));

export default router;
