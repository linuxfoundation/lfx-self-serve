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
// Projects that are not publicly discoverable (`public` false or Formation - Confidential) are answered exactly like an unknown identifier (lfx-self-serve-ops#437).
router.get('/:id/calendar.ics', (req, res, next) => projectController.getProjectCalendar(req, res, next));

// GET /public/api/projects/:id/meetings
// Returns public meetings for a project (by UID or slug) as JSON, for the public calendar page.
// Optional `committee` query param scopes the feed to a single committee within the project.
// Public access — no authentication required; M2M token used for upstream calls.
// Projects that are not publicly discoverable (`public` false or Formation - Confidential) are answered exactly like an unknown identifier (lfx-self-serve-ops#437).
// Slug metadata failures use the same non-cacheable 404 as unknown slugs; UID failures return errors, not empty feeds.
router.get('/:id/meetings', (req, res, next) => projectController.getProjectMeetings(req, res, next));

// GET /public/api/projects/:identifier/summary
// Returns { name, slug, logo_url, is_foundation } so the login-free vote page can show the project's branding.
// Public access — no authentication required; M2M token used for upstream calls. No user data in the response.
// Projects that are not publicly discoverable (`public` false or Formation - Confidential) are answered exactly like an unknown identifier (lfx-self-serve-ops#437).
router.get('/:identifier/summary', (req, res, next) => projectController.getPublicProjectSummary(req, res, next));

// GET /public/api/projects/:slug/lens-redirect/:resource
// 302-redirects to the lens-prefixed resource page for email deep links (votes, meetings, …).
// The lens is derived from the project's own attributes (computeIsFoundation), not the
// recipient's active lens, so a foundation project lands on /foundation/<resource> and a
// non-foundation on /project/<resource>. `:resource` is allowlisted in the controller so it
// cannot become an open redirect. Anonymous access — no user session; M2M-authenticated upstream.
// Projects that are not publicly discoverable (`public` false or Formation - Confidential) are answered exactly like an unknown identifier (lfx-self-serve-ops#437).
router.get('/:slug/lens-redirect/:resource', (req, res, next) => projectController.getLensRedirect(req, res, next));

// GET /public/api/projects/:identifier/groups
// Returns public group summaries for a project (by UID or slug).
// Public access — no authentication required; M2M token used for upstream calls.
// Projects that are not publicly discoverable (`public` false or Formation - Confidential) are answered exactly like an unknown identifier (lfx-self-serve-ops#437).
// Slug metadata failures use the same non-cacheable 404 as unknown slugs; UID metadata failures propagate.
router.get('/:identifier/groups', (req, res, next) => publicGroupsController.getPublicGroupsByProject(req, res, next));

export default router;
