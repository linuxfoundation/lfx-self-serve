// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterReaderController } from '../controllers/newsletter-reader.controller';
import { NewsletterController } from '../controllers/newsletter.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

// User-scoped (non-project) newsletter routes, mounted at /api/newsletters in
// server.ts — distinct from the project-scoped manager router mounted at
// /api/projects/:projectUid/newsletters. Authorization is enforced upstream:
// the my-newsletters fan-out hits committee-scoped newsletter-service routes
// that Heimdall gates on `committee:{committee_uid}#member` per request, so
// the feed tracks live committee membership.
const router = Router();
const newsletterController = new NewsletterController();
const newsletterReaderController = new NewsletterReaderController();

router.get('/my-newsletters', (req, res, next) => newsletterController.getMyNewsletters(req, res, next));

// Permalink reader + member benefit (#3469). The reader decides access in-app (manager, group
// member, eligible Linux Foundation member employee, or denied); join re-checks eligibility and
// adds the caller's work email to the newsletter group, so it is a write blocked while
// impersonating.
router.get('/:projectUid/:newsletterUid/reader', (req, res, next) => newsletterReaderController.getReaderAccess(req, res, next));
router.post('/:projectUid/:newsletterUid/join', blockDuringImpersonation, (req, res, next) => newsletterReaderController.joinNewsletterGroup(req, res, next));

export default router;
