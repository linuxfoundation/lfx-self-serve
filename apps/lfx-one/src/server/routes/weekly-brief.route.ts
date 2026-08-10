// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { WeeklyBriefController } from '../controllers/weekly-brief.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();

const weeklyBriefController = new WeeklyBriefController();

// GET /committees/:committeeId/weekly-briefs/current - get the current WG weekly brief
router.get('/:committeeId/weekly-briefs/current', (req, res, next) => weeklyBriefController.getCurrentBrief(req, res, next));

// POST /committees/:committeeId/weekly-briefs/generate - generate (or regenerate) the current brief
router.post('/:committeeId/weekly-briefs/generate', (req, res, next) => weeklyBriefController.generateBrief(req, res, next));

// PUT /committees/:committeeId/weekly-briefs/current - save edits to the current brief
router.put('/:committeeId/weekly-briefs/current', (req, res, next) => weeklyBriefController.saveBrief(req, res, next));

// POST /committees/:committeeId/weekly-briefs/share - share the current brief to the committee mailing list
router.post('/:committeeId/weekly-briefs/share', (req, res, next) => weeklyBriefController.shareBrief(req, res, next));

// POST /committees/:committeeId/weekly-briefs/:briefUid/rating - rate (or re-rate) the current brief
// Blocked during impersonation: unlike generate/save/share (which proxy through untouched and are
// therefore attributed to whoever actually authenticated), rateBrief resolves the caller's identity
// via getEffectiveUsername for the Valkey write itself — during impersonation that writes into the
// TARGET user's rating key, not the impersonator's, the same class of wrong-account write
// blockDuringImpersonation already guards for profile/enrollment mutations.
router.post('/:committeeId/weekly-briefs/:briefUid/rating', blockDuringImpersonation, (req, res, next) => weeklyBriefController.rateBrief(req, res, next));

// DELETE /committees/:committeeId/weekly-briefs/:briefUid/rating - clear the caller's rating
router.delete('/:committeeId/weekly-briefs/:briefUid/rating', blockDuringImpersonation, (req, res, next) =>
  weeklyBriefController.clearBriefRating(req, res, next)
);

export default router;
