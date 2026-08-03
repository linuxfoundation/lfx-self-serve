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

// GET /public/api/projects/:slug/lens-redirect/:resource
// 302-redirects to the lens-prefixed resource page for email deep links (votes, meetings, …).
// The lens is derived from the project's own attributes (computeIsFoundation), not the
// recipient's active lens, so a foundation project lands on /foundation/<resource> and a
// non-foundation on /project/<resource>. `:resource` is allowlisted in the controller so it
// cannot become an open redirect. Anonymous access — no user session; M2M-authenticated upstream.
router.get('/:slug/lens-redirect/:resource', (req, res, next) => projectController.getLensRedirect(req, res, next));

export default router;
