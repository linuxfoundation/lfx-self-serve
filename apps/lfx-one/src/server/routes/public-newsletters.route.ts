// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicNewsletterController } from '../controllers/public-newsletter.controller';

const router = Router();
const publicNewsletterController = new PublicNewsletterController();

// GET /public/api/newsletters/:projectSlug/:newsletterUid/preview - subject of a sent issue, for link previews
router.get('/:projectSlug/:newsletterUid/preview', (req, res, next) => publicNewsletterController.getSharePreview(req, res, next));

export default router;
