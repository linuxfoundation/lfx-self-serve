// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';

import { PastMeetingController } from '../controllers/past-meeting.controller';

const router = express.Router();
const pastMeetingController = new PastMeetingController();

// Past meeting routes
router.get('/', (req, res, next) => pastMeetingController.getPastMeetings(req, res, next));

// Get past meeting by UID
router.get('/:uid', (req, res, next) => pastMeetingController.getPastMeetingById(req, res, next));

// Get past meeting participants by UID
router.get('/:uid/participants', (req, res, next) => pastMeetingController.getPastMeetingParticipants(req, res, next));

export default router;
