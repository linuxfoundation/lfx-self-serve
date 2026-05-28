// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterController } from '../controllers/newsletter.controller';

const router = Router();
const newsletterController = new NewsletterController();

// Authorization is enforced by the downstream lfx-v2-newsletter-service (FGA
// via the forwarded user bearer token) and by the corresponding frontend
// route guards. Don't gate on persona here — newsletters are accessible to
// Executive Directors AND writers/owners of the foundation or project.

// List newsletters (drafts + sent) and per-newsletter analytics
router.get('/', (req, res, next) => newsletterController.listNewsletters(req, res, next));
router.get('/:id/analytics', (req, res, next) => newsletterController.getAnalytics(req, res, next));

// Draft CRUD — proxies to lfx-v2-newsletter-service
router.get('/drafts', (req, res, next) => newsletterController.listDrafts(req, res, next));
router.post('/drafts', (req, res, next) => newsletterController.createDraft(req, res, next));
router.get('/drafts/:id', (req, res, next) => newsletterController.getDraft(req, res, next));
router.put('/drafts/:id', (req, res, next) => newsletterController.updateDraft(req, res, next));
router.delete('/drafts/:id', (req, res, next) => newsletterController.deleteDraft(req, res, next));
router.post('/drafts/:id/send', (req, res, next) => newsletterController.sendDraft(req, res, next));

// Preview, test-send, and ad-hoc send — proxy to lfx-v2-newsletter-service
router.post('/recipient-count', (req, res, next) => newsletterController.getRecipientCount(req, res, next));
router.post('/recipients', (req, res, next) => newsletterController.getRecipients(req, res, next));
router.post('/test-send', (req, res, next) => newsletterController.testSend(req, res, next));
router.post('/send', (req, res, next) => newsletterController.send(req, res, next));

// AI generation. Doesn't proxy to the Go newsletter-service, so there's no
// downstream FGA check to lean on. Protection layers are the global auth
// middleware (must be a logged-in user) + the /api rate limit. Writers
// compose newsletters in the UI and need this too. A tighter writer/owner
// check tied to a project contextUid is a follow-up.
router.post('/generate', (req, res, next) => newsletterController.generate(req, res, next));

export default router;
