// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicGroupsController } from '../controllers/public-groups.controller';
import { ProjectController } from '../controllers/project.controller';

const router = Router();
const projectController = new ProjectController();
const publicGroupsController = new PublicGroupsController();

// GET /public/api/projects/:id/calendar.ics
// Returns the iCalendar (.ics) feed for a project's (or foundation's) meetings.
// Public access — no authentication required so external calendar clients
// (Google Calendar, Outlook, Apple Calendar) can subscribe by URL.
router.get('/:id/calendar.ics', (req, res, next) => projectController.getProjectCalendar(req, res, next));

// GET /public/api/projects/:id/meetings
// Returns public meetings for a project (by UID or slug) as JSON, for the public calendar page.
// Optional `committee` query param scopes the feed to a single committee within the project.
// Public access — no authentication required; M2M token used for upstream calls.
router.get('/:id/meetings', (req, res, next) => projectController.getProjectMeetings(req, res, next));

// GET /public/api/projects/:slug/lens-redirect/:resource
// 302-redirects to the lens-prefixed resource page for email deep links (votes, meetings, …).
// The lens is derived from the project's own attributes (computeIsFoundation), not the
// recipient's active lens, so a foundation project lands on /foundation/<resource> and a
// non-foundation on /project/<resource>. `:resource` is allowlisted in the controller so it
// cannot become an open redirect. Anonymous access — no user session; M2M-authenticated upstream.
router.get('/:slug/lens-redirect/:resource', (req, res, next) => projectController.getLensRedirect(req, res, next));

// GET /public/api/projects/:identifier/groups
// Returns public group summaries for a project (by UID or slug).
// Public access — no authentication required; M2M token used for upstream calls.
router.get('/:identifier/groups', (req, res, next) => publicGroupsController.getPublicGroupsByProject(req, res, next));

export default router;
