// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicMeetingController } from '../controllers/public-meeting.controller';

const router = Router();
const publicMeetingController = new PublicMeetingController();

// POST /public/api/meetings/register - register for a public, non-restricted meeting. The router is
// mounted with optional auth, but this handler requires a session: it registers the caller as
// themselves, and upstream reads their identity off their own token.
router.post('/register', (req, res, next) => publicMeetingController.registerForPublicMeeting(req, res, next));

// GET /public/api/meetings/past/:id - get a past meeting with tiered access (public access, no authentication required)
router.get('/past/:id', (req, res, next) => publicMeetingController.getPublicPastMeetingById(req, res, next));

// GET /public/api/meetings/past/:id/{recording,transcript,transcript/content,summary} - the past meeting's
// artifacts (E4-04). A signed-in caller reads with their own token (upstream decides); a caller with no
// session gets only a public artifact of a public, unrestricted meeting, else 401
router.get('/past/:id/recording', (req, res, next) => publicMeetingController.getPublicPastMeetingRecording(req, res, next));
router.get('/past/:id/transcript', (req, res, next) => publicMeetingController.getPublicPastMeetingTranscript(req, res, next));
router.get('/past/:id/transcript/content', (req, res, next) => publicMeetingController.getPublicPastMeetingTranscriptContent(req, res, next));
router.get('/past/:id/summary', (req, res, next) => publicMeetingController.getPublicPastMeetingSummary(req, res, next));

// GET /public/api/meetings/past/:id/participants - the public roster (E4-04): requires a session and
// artifact access, and carries only the public roster fields (no email, job title or committee standing)
router.get('/past/:id/participants', (req, res, next) => publicMeetingController.getPublicPastMeetingParticipants(req, res, next));

// GET /public/api/meetings/:id/occurrences - get the series timeline (past + future occurrences) for a meeting (public access, no authentication required)
router.get('/:id/occurrences', (req, res, next) => publicMeetingController.getMeetingOccurrences(req, res, next));

// GET /public/api/meetings/:id/attachments - the meeting's materials, behind the same gates as GET /:id
// (public and unrestricted, or invited / organizer, or the meeting password)
router.get('/:id/attachments', (req, res, next) => publicMeetingController.getMeetingAttachments(req, res, next));

// GET /public/api/meetings/:id/attachments/:attachmentId/download - a presigned download URL for one
// of those files, behind the same gates
router.get('/:id/attachments/:attachmentId/download', (req, res, next) => publicMeetingController.getMeetingAttachmentDownloadUrl(req, res, next));

// GET /public/api/meetings/:id - get a single meeting (public access, no authentication required)
router.get('/:id', (req, res, next) => publicMeetingController.getMeetingById(req, res, next));

// GET /public/api/meetings/:id/join-url - get the join URL for a meeting (public access, no authentication required)
router.post('/:id/join-url', (req, res, next) => publicMeetingController.postMeetingJoinUrl(req, res, next));

export default router;
