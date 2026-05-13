// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ProjectController } from '../controllers/project.controller';

const router = Router();
const projectController = new ProjectController();

// GET /public/api/projects/:id/calendar.ics
// Returns the iCalendar (.ics) feed for a project's (or foundation's) meetings.
// Public access — no authentication required so external calendar clients
// (Google Calendar, Outlook, Apple Calendar) can subscribe by URL.
router.get('/:id/calendar.ics', (req, res, next) => projectController.getProjectCalendar(req, res, next));

export default router;
