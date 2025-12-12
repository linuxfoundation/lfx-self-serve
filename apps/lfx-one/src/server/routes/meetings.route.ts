// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MeetingController } from '../controllers/meeting.controller';

const router = Router();

const meetingController = new MeetingController();

// GET /meetings - get all meetings
router.get('/', (req, res, next) => meetingController.getMeetings(req, res, next));

// GET /meetings/count - get meetings count
router.get('/count', (req, res, next) => meetingController.getMeetingsCount(req, res, next));

// GET /meetings/:uid - get a single meeting
router.get('/:uid', (req, res, next) => meetingController.getMeetingById(req, res, next));

// POST /meetings - create a new meeting
router.post('/', (req, res, next) => meetingController.createMeeting(req, res, next));

// PUT /meetings/:uid - update a meeting
router.put('/:uid', (req, res, next) => meetingController.updateMeeting(req, res, next));

// DELETE /meetings/:uid - delete a meeting
router.delete('/:uid', (req, res, next) => meetingController.deleteMeeting(req, res, next));

// DELETE /meetings/:uid/occurrences/:occurrenceId - cancel a meeting occurrence
router.delete('/:uid/occurrences/:occurrenceId', (req, res, next) => meetingController.cancelOccurrence(req, res, next));

// Registrant routes
router.get('/:uid/registrants', (req, res, next) => meetingController.getMeetingRegistrants(req, res, next));

// POST /meetings/:uid/registrants - add registrants (handles single or multiple)
router.post('/:uid/registrants', (req, res, next) => meetingController.addMeetingRegistrants(req, res, next));

// PUT /meetings/:uid/registrants - update registrants (handles single or multiple)
router.put('/:uid/registrants', (req, res, next) => meetingController.updateMeetingRegistrants(req, res, next));

// DELETE /meetings/:uid/registrants - delete registrants (handles single or multiple)
router.delete('/:uid/registrants', (req, res, next) => meetingController.deleteMeetingRegistrants(req, res, next));

// POST /meetings/:uid/registrants/:registrantId/resend - resend invitation to specific registrant
router.post('/:uid/registrants/:registrantId/resend', (req, res, next) => meetingController.resendMeetingInvitation(req, res, next));

// RSVP routes
router.post('/:uid/rsvp', (req, res, next) => meetingController.createMeetingRsvp(req, res, next));
router.get('/:uid/rsvp', (req, res, next) => meetingController.getMeetingRsvps(req, res, next));
router.get('/:uid/rsvp/me', (req, res, next) => meetingController.getMeetingRsvpByUsername(req, res, next));

// Meeting attachment routes
router.post('/:uid/attachments', (req, res, next) => meetingController.createMeetingAttachment(req, res, next));

router.get('/:uid/attachments', (req, res, next) => meetingController.getMeetingAttachments(req, res, next));

router.get('/:uid/attachments/:attachmentId/metadata', (req, res, next) => meetingController.getMeetingAttachmentMetadata(req, res, next));

router.get('/:uid/attachments/:attachmentId', (req, res, next) => meetingController.getMeetingAttachment(req, res, next));

router.delete('/:uid/attachments/:attachmentId', (req, res, next) => meetingController.deleteMeetingAttachment(req, res, next));

// AI agenda generation endpoint
router.post('/generate-agenda', (req, res, next) => meetingController.generateAgenda(req, res, next));

export default router;
