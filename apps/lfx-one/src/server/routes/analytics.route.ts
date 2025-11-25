// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { AnalyticsController } from '../controllers/analytics.controller';

const router = Router();

const analyticsController = new AnalyticsController();

// User analytics routes
router.get('/active-weeks-streak', (req, res, next) => analyticsController.getActiveWeeksStreak(req, res, next));
router.get('/pull-requests-merged', (req, res, next) => analyticsController.getPullRequestsMerged(req, res, next));
router.get('/code-commits', (req, res, next) => analyticsController.getCodeCommits(req, res, next));
router.get('/my-projects', (req, res, next) => analyticsController.getMyProjects(req, res, next));

// Consolidated analytics endpoints for optimized API performance
router.get('/organization-contributions-overview', (req, res, next) => analyticsController.getOrganizationContributionsOverview(req, res, next));
router.get('/board-member-dashboard', (req, res, next) => analyticsController.getBoardMemberDashboard(req, res, next));
router.get('/organization-events-overview', (req, res, next) => analyticsController.getOrganizationEventsOverview(req, res, next));

// Projects list endpoint
router.get('/projects', (req, res, next) => analyticsController.getProjects(req, res, next));

// Project issues resolution endpoint
router.get('/project-issues-resolution', (req, res, next) => analyticsController.getProjectIssuesResolution(req, res, next));

// Project pull requests weekly endpoint
router.get('/project-pull-requests-weekly', (req, res, next) => analyticsController.getProjectPullRequestsWeekly(req, res, next));

// Contributors mentored endpoint
router.get('/contributors-mentored', (req, res, next) => analyticsController.getContributorsMentored(req, res, next));

// Unique contributors weekly endpoint
router.get('/unique-contributors-weekly', (req, res, next) => analyticsController.getUniqueContributorsWeekly(req, res, next));

// Foundation total projects endpoint
router.get('/foundation-total-projects', (req, res, next) => analyticsController.getFoundationTotalProjects(req, res, next));

// Foundation total members endpoint
router.get('/foundation-total-members', (req, res, next) => analyticsController.getFoundationTotalMembers(req, res, next));

// Foundation software value endpoint
router.get('/foundation-software-value', (req, res, next) => analyticsController.getFoundationSoftwareValue(req, res, next));

// Foundation maintainers endpoint
router.get('/foundation-maintainers', (req, res, next) => analyticsController.getFoundationMaintainers(req, res, next));

// Foundation health score distribution endpoint
router.get('/foundation-health-score-distribution', (req, res, next) => analyticsController.getFoundationHealthScoreDistribution(req, res, next));

export default router;
