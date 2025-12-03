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

// Certified employees endpoint
router.get('/certified-employees', (req, res, next) => analyticsController.getCertifiedEmployees(req, res, next));

// Membership tier endpoint
router.get('/membership-tier', (req, res, next) => analyticsController.getMembershipTier(req, res, next));

// Organization maintainers endpoint
router.get('/organization-maintainers', (req, res, next) => analyticsController.getOrganizationMaintainers(req, res, next));

// Organization contributors endpoint
router.get('/organization-contributors', (req, res, next) => analyticsController.getOrganizationContributors(req, res, next));

// Training enrollments endpoint
router.get('/training-enrollments', (req, res, next) => analyticsController.getTrainingEnrollments(req, res, next));

// Event attendance monthly endpoint
router.get('/event-attendance-monthly', (req, res, next) => analyticsController.getEventAttendanceMonthly(req, res, next));

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

// Company bus factor endpoint
router.get('/company-bus-factor', (req, res, next) => analyticsController.getCompanyBusFactor(req, res, next));

// Health metrics daily endpoint
router.get('/health-metrics-daily', (req, res, next) => analyticsController.getHealthMetricsDaily(req, res, next));

// Unique contributors daily endpoint
router.get('/unique-contributors-daily', (req, res, next) => analyticsController.getUniqueContributorsDaily(req, res, next));

// Health events monthly endpoint
router.get('/health-events-monthly', (req, res, next) => analyticsController.getHealthEventsMonthly(req, res, next));

// Code commits daily endpoint
router.get('/code-commits-daily', (req, res, next) => analyticsController.getCodeCommitsDaily(req, res, next));

export default router;
