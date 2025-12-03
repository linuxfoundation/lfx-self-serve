// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicMeetingController } from '../controllers/public-meeting.controller';

const router = Router();
const publicMeetingController = new PublicMeetingController();

// POST /public/api/meetings/register - register for a public, non-restricted meeting (public access, no authentication required)
router.post('/register', (req, res, next) => publicMeetingController.registerForPublicMeeting(req, res, next));

// GET /public/api/meetings/:id - get a single meeting (public access, no authentication required)
router.get('/:id', (req, res, next) => publicMeetingController.getMeetingById(req, res, next));

// GET /public/api/meetings/:id/join-url - get the join URL for a meeting (public access, no authentication required)
router.post('/:id/join-url', (req, res, next) => publicMeetingController.postMeetingJoinUrl(req, res, next));

export default router;
