// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';

import { PastMeetingController } from '../controllers/past-meeting.controller';

const router = express.Router();
const pastMeetingController = new PastMeetingController();

// Past meeting routes
router.get('/', (req, res, next) => pastMeetingController.getPastMeetings(req, res, next));

// GET /past-meetings/count - get past meetings count
router.get('/count', (req, res, next) => pastMeetingController.getPastMeetingsCount(req, res, next));

// Get past meeting participants by UID
router.get('/:uid/participants', (req, res, next) => pastMeetingController.getPastMeetingParticipants(req, res, next));

// Get past meeting recording by UID
router.get('/:uid/recording', (req, res, next) => pastMeetingController.getPastMeetingRecording(req, res, next));

// Get past meeting transcript metadata by UID
router.get('/:uid/transcript', (req, res, next) => pastMeetingController.getPastMeetingTranscript(req, res, next));

// Get past meeting transcript content (WebVTT) by UID
router.get('/:uid/transcript/content', (req, res, next) => pastMeetingController.getPastMeetingTranscriptContent(req, res, next));

// Get past meeting summary by UID
router.get('/:uid/summary', (req, res, next) => pastMeetingController.getPastMeetingSummary(req, res, next));

// Update past meeting summary
router.put('/:uid/summary/:summaryUid', (req, res, next) => pastMeetingController.updatePastMeetingSummary(req, res, next));

// Past meeting attachment routes
router.get('/:uid/attachments', (req, res, next) => pastMeetingController.getPastMeetingAttachments(req, res, next));

router.post('/:uid/attachments', (req, res, next) => pastMeetingController.createPastMeetingAttachment(req, res, next));

router.post('/:uid/attachments/upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res, next) =>
  pastMeetingController.uploadPastMeetingAttachment(req, res, next)
);

router.post('/:uid/attachments/presign', (req, res, next) => pastMeetingController.presignPastMeetingAttachment(req, res, next));

router.get('/:uid/attachments/:attachmentId', (req, res, next) => pastMeetingController.getPastMeetingAttachment(req, res, next));

router.get('/:uid/attachments/:attachmentId/download', (req, res, next) => pastMeetingController.getPastMeetingAttachmentDownloadUrl(req, res, next));

router.delete('/:uid/attachments/:attachmentId', (req, res, next) => pastMeetingController.deletePastMeetingAttachment(req, res, next));

// Get a single past meeting by UID (must be after all /:uid/* routes)
router.get('/:uid', (req, res, next) => pastMeetingController.getPastMeetingById(req, res, next));

export default router;
