// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterController } from '../controllers/newsletter.controller';

// User-scoped (non-project) newsletter routes, mounted at /api/newsletters in
// server.ts — distinct from the project-scoped manager router mounted at
// /api/projects/:projectUid/newsletters. Authorization is enforced upstream:
// the my-newsletters fan-out hits committee-scoped newsletter-service routes
// that Heimdall gates on `committee:{committee_uid}#member` per request, so
// the feed tracks live committee membership.
const router = Router();
const newsletterController = new NewsletterController();

router.get('/my-newsletters', (req, res, next) => newsletterController.getMyNewsletters(req, res, next));

export default router;
