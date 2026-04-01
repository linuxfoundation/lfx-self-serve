// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CommitteeController } from '../controllers/committee.controller';

const router = Router();
const committeeController = new CommitteeController();

// GET /public/api/committees/:id/calendar.ics
// Returns the iCalendar (.ics) feed for a committee's meetings.
// Public access — no authentication required so external calendar clients
// (Google Calendar, Outlook, Apple Calendar) can subscribe by URL.
router.get('/:id/calendar.ics', (req, res, next) => committeeController.getCommitteeCalendar(req, res, next));

export default router;
