// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterController } from '../controllers/newsletter.controller';

// `mergeParams: true` so the controller sees `:projectUid` even though the
// sub-router is mounted under `/api/projects/:projectUid/newsletters` in
// server.ts.
const router = Router({ mergeParams: true });
const newsletterController = new NewsletterController();

// Authorization is enforced by the downstream lfx-v2-newsletter-service via
// Heimdall + OpenFGA (gates by `project:{project_uid}` from the path) and by
// the corresponding frontend route guards. We don't gate on persona here —
// newsletters are accessible to Executive Directors AND project writers.

// AI body generation. Doesn't proxy to the Go newsletter-service so there's
// no downstream FGA check; relies on the global auth middleware + /api rate
// limit. Mounted before the catch-alls so it doesn't collide with any
// `/projects/:projectUid/newsletters/:newsletterUid` pattern.
router.post('/generate', (req, res, next) => newsletterController.generate(req, res, next));

// Recipient resolution + test send. Static segments under
// `/projects/:projectUid/newsletters/...` so Express's router doesn't try to
// parse them as `:newsletterUid`.
router.post('/recipient-count', (req, res, next) => newsletterController.getRecipientCount(req, res, next));
router.post('/recipients', (req, res, next) => newsletterController.getRecipients(req, res, next));
router.post('/test-send', (req, res, next) => newsletterController.testSend(req, res, next));

// Newsletter list + create.
router.get('/', (req, res, next) => newsletterController.listNewsletters(req, res, next));
router.post('/', (req, res, next) => newsletterController.createNewsletter(req, res, next));

// Opt-out (unsubscribe) list and individual opt-out deletion. Static segments
// registered before the `/:newsletterUid` catch-alls so Express doesn't parse
// them as newsletter UIDs.
router.get('/opt-outs', (req, res, next) => newsletterController.listOptOuts(req, res, next));
router.delete('/opt-outs/:optOutId', (req, res, next) => newsletterController.deleteOptOut(req, res, next));

// Per-newsletter CRUD + send + analytics.
router.get('/:newsletterUid', (req, res, next) => newsletterController.getNewsletter(req, res, next));
router.put('/:newsletterUid', (req, res, next) => newsletterController.updateNewsletter(req, res, next));
router.delete('/:newsletterUid', (req, res, next) => newsletterController.deleteNewsletter(req, res, next));
router.post('/:newsletterUid/send', (req, res, next) => newsletterController.sendNewsletter(req, res, next));
router.get('/:newsletterUid/analytics', (req, res, next) => newsletterController.getAnalytics(req, res, next));

export default router;
