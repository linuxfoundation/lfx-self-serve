// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterController } from '../controllers/newsletter.controller';
import { requireExecutiveDirector } from '../middleware/require-executive-director.middleware';

const router = Router();
const newsletterController = new NewsletterController();

// All newsletter endpoints are Executive Director-only.
router.use(requireExecutiveDirector);

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

// AI generation stays in lfx-v2-ui
router.post('/generate', (req, res, next) => newsletterController.generate(req, res, next));

export default router;
