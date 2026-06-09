// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { WeeklyBriefController } from '../controllers/weekly-brief.controller';

const router = Router();

const weeklyBriefController = new WeeklyBriefController();

// GET /committees/:committeeId/weekly-briefs/current - get the current WG weekly brief
router.get('/:committeeId/weekly-briefs/current', (req, res, next) => weeklyBriefController.getCurrentBrief(req, res, next));

// POST /committees/:committeeId/weekly-briefs/generate - generate (or regenerate) the current brief
router.post('/:committeeId/weekly-briefs/generate', (req, res, next) => weeklyBriefController.generateBrief(req, res, next));

// PUT /committees/:committeeId/weekly-briefs/current - save edits to the current brief
router.put('/:committeeId/weekly-briefs/current', (req, res, next) => weeklyBriefController.saveBrief(req, res, next));

export default router;
