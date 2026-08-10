// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { WeeklyBriefController } from '../controllers/weekly-brief.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();

const weeklyBriefController = new WeeklyBriefController();

// GET /committees/:committeeId/weekly-briefs/current - get the current WG weekly brief
router.get('/:committeeId/weekly-briefs/current', (req, res, next) => weeklyBriefController.getCurrentBrief(req, res, next));

// GET /committees/:committeeId/weekly-briefs/action-items - AI-extracted action items for the current brief
router.get('/:committeeId/weekly-briefs/action-items', (req, res, next) => weeklyBriefController.getActionItems(req, res, next));

// POST /committees/:committeeId/weekly-briefs/generate - generate (or regenerate) the current brief
router.post('/:committeeId/weekly-briefs/generate', (req, res, next) => weeklyBriefController.generateBrief(req, res, next));

// PUT /committees/:committeeId/weekly-briefs/current - save edits to the current brief
router.put('/:committeeId/weekly-briefs/current', (req, res, next) => weeklyBriefController.saveBrief(req, res, next));

// POST /committees/:committeeId/weekly-briefs/share - share the current brief to the committee mailing list
// Not blocked during impersonation: proxies through untouched and is attributed to whoever
// actually authenticated (the send carries a resolved ed_reply_email reply-to for the real
// caller), the same reasoning generate/save use.
router.post('/:committeeId/weekly-briefs/share', (req, res, next) => weeklyBriefController.shareBrief(req, res, next));

// POST /committees/:committeeId/weekly-briefs/share-slack - share the current brief to the committee's Slack channel
// Blocked during impersonation, unlike the mailing-list share above: a Slack incoming-webhook
// POST carries no caller identity in its payload at all (no reply-to equivalent), so an
// impersonation-triggered send would be a fully unattributed broadcast to a third-party,
// externally-visible channel with no way to correct or retract it after the fact — a real
// externally-visible side effect, not an in-app write that can be fixed later.
router.post('/:committeeId/weekly-briefs/share-slack', blockDuringImpersonation, (req, res, next) => weeklyBriefController.shareToSlack(req, res, next));

// POST /committees/:committeeId/weekly-briefs/:briefUid/rating - rate (or re-rate) the current brief
// Blocked during impersonation: rateBrief resolves the caller's identity via getEffectiveUsername
// for the Valkey write itself — during impersonation that writes into the TARGET user's rating
// key, not the impersonator's, the same class of wrong-account write blockDuringImpersonation
// already guards for profile/enrollment mutations.
router.post('/:committeeId/weekly-briefs/:briefUid/rating', blockDuringImpersonation, (req, res, next) => weeklyBriefController.rateBrief(req, res, next));

// DELETE /committees/:committeeId/weekly-briefs/:briefUid/rating - clear the caller's rating
router.delete('/:committeeId/weekly-briefs/:briefUid/rating', blockDuringImpersonation, (req, res, next) =>
  weeklyBriefController.clearBriefRating(req, res, next)
);

export default router;
