// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';

import { PastMeetingController } from '../controllers/past-meeting.controller';

const router = express.Router();
const pastMeetingController = new PastMeetingController();

// Past meeting routes
router.get('/', (req, res, next) => pastMeetingController.getPastMeetings(req, res, next));

// Get past meeting participants by UID
router.get('/:uid/participants', (req, res, next) => pastMeetingController.getPastMeetingParticipants(req, res, next));

// Get past meeting recording by UID
router.get('/:uid/recording', (req, res, next) => pastMeetingController.getPastMeetingRecording(req, res, next));

// Get past meeting summary by UID
router.get('/:uid/summary', (req, res, next) => pastMeetingController.getPastMeetingSummary(req, res, next));

// Update past meeting summary
router.put('/:uid/summary/:summaryUid', (req, res, next) => pastMeetingController.updatePastMeetingSummary(req, res, next));

// Get past meeting attachments
router.get('/:uid/attachments', (req, res, next) => pastMeetingController.getPastMeetingAttachments(req, res, next));

export default router;
