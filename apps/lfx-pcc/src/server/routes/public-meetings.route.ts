// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicMeetingController } from '../controllers/public-meeting.controller';

const router = Router();
const publicMeetingController = new PublicMeetingController();

// GET /public/api/meetings/:id - get a single meeting (public access, no authentication required)
router.get('/:id', (req, res, next) => publicMeetingController.getMeetingById(req, res, next));

export default router;
