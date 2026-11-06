// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicNewsletterGuestController } from '../controllers/public-newsletter-guest.controller';
import { PublicNewsletterController } from '../controllers/public-newsletter.controller';
import { newsletterGuestRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();
const publicNewsletterController = new PublicNewsletterController();
const publicNewsletterGuestController = new PublicNewsletterGuestController();

// Signed-out member-benefit reading (#5235). Declared before the `/:projectSlug/:newsletterUid/*`
// routes so `invites` and `guest` are never read as a project slug.
// POST /public/api/newsletters/invites/inspect - what an invite link's landing modal shows
router.post('/invites/inspect', newsletterGuestRateLimiter, (req, res, next) => publicNewsletterGuestController.inspectInvite(req, res, next));
// POST /public/api/newsletters/invites/accept - invitee's Continue: join the list, read the latest issue
router.post('/invites/accept', newsletterGuestRateLimiter, (req, res, next) => publicNewsletterGuestController.acceptInvite(req, res, next));
// GET /public/api/newsletters/guest/latest - the guest session's latest issue
router.get('/guest/latest', (req, res, next) => publicNewsletterGuestController.getLatestIssue(req, res, next));
// GET /public/api/newsletters/guest/:projectSlug/:newsletterUid - a shared issue for the guest session
router.get('/guest/:projectSlug/:newsletterUid', (req, res, next) => publicNewsletterGuestController.getSharedIssue(req, res, next));

// GET /public/api/newsletters/:projectSlug/:newsletterUid/preview - subject of a sent issue, for link previews
router.get('/:projectSlug/:newsletterUid/preview', (req, res, next) => publicNewsletterController.getSharePreview(req, res, next));
// POST /public/api/newsletters/:projectSlug/:newsletterUid/guest-access - shared-link reader's Continue with a work email
router.post('/:projectSlug/:newsletterUid/guest-access', newsletterGuestRateLimiter, (req, res, next) =>
  publicNewsletterGuestController.requestSharedAccess(req, res, next)
);

export default router;
