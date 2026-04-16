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

// Foundation active contributors monthly endpoint (active contributors drill-down)
router.get('/foundation-active-contributors-monthly', (req, res, next) => analyticsController.getFoundationActiveContributorsMonthly(req, res, next));

// Foundation contributors distribution endpoint (active contributors drill-down)
router.get('/foundation-contributors-distribution', (req, res, next) => analyticsController.getFoundationContributorsDistribution(req, res, next));

// Foundation software value endpoint
router.get('/foundation-software-value', (req, res, next) => analyticsController.getFoundationSoftwareValue(req, res, next));

// Foundation value concentration endpoint
router.get('/foundation-value-concentration', (req, res, next) => analyticsController.getFoundationValueConcentration(req, res, next));

// Foundation maintainers endpoint
router.get('/foundation-maintainers', (req, res, next) => analyticsController.getFoundationMaintainers(req, res, next));

// Foundation maintainers monthly endpoint (maintainers drill-down trend chart)
router.get('/foundation-maintainers-monthly', (req, res, next) => analyticsController.getFoundationMaintainersMonthly(req, res, next));

// Foundation maintainers distribution endpoint (maintainers drill-down bar chart)
router.get('/foundation-maintainers-distribution', (req, res, next) => analyticsController.getFoundationMaintainersDistribution(req, res, next));

// Foundation events quarterly endpoint (events drill-down trend chart)
router.get('/foundation-events-quarterly', (req, res, next) => analyticsController.getFoundationEventsQuarterly(req, res, next));

// Foundation events attendance distribution endpoint (events drill-down bar chart)
router.get('/foundation-events-attendance-distribution', (req, res, next) => analyticsController.getFoundationEventsAttendanceDistribution(req, res, next));

// Foundation projects detail endpoint (total projects drill-down table)
router.get('/foundation-projects-detail', (req, res, next) => analyticsController.getFoundationProjectsDetail(req, res, next));

// Foundation projects lifecycle distribution endpoint (total projects drill-down secondary chart)
router.get('/foundation-projects-lifecycle-distribution', (req, res, next) => analyticsController.getFoundationProjectsLifecycleDistribution(req, res, next));

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

// Org active contributors monthly trend endpoint (org involvement drawer)
router.get('/org-contributors-monthly', (req, res, next) => analyticsController.getOrgContributorsMonthly(req, res, next));

// Org active contributors project distribution endpoint (org involvement drawer)
router.get('/org-contributors-project-distribution', (req, res, next) => analyticsController.getOrgContributorsProjectDistribution(req, res, next));

// Org maintainers monthly trend endpoint (org maintainers drawer)
router.get('/org-maintainers-monthly', (req, res, next) => analyticsController.getOrgMaintainersMonthly(req, res, next));

// Org maintainers distribution endpoint (org maintainers drawer)
router.get('/org-maintainers-distribution', (req, res, next) => analyticsController.getOrgMaintainersDistribution(req, res, next));

// Org maintainers key members endpoint (org maintainers drawer)
router.get('/org-maintainers-key-members', (req, res, next) => analyticsController.getOrgMaintainersKeyMembers(req, res, next));

// Org event attendees monthly endpoint (org event attendees drawer)
router.get('/org-event-attendees-monthly', (req, res, next) => analyticsController.getOrgEventAttendeesMonthly(req, res, next));

// Org event speakers monthly endpoint (org event speakers drawer)
router.get('/org-event-speakers-monthly', (req, res, next) => analyticsController.getOrgEventSpeakersMonthly(req, res, next));

// Org training enrollments endpoints (org training enrollments drawer)
router.get('/org-training-enrollments-monthly', (req, res, next) => analyticsController.getOrgTrainingEnrollmentsMonthly(req, res, next));
router.get('/org-training-enrollments-distribution', (req, res, next) => analyticsController.getOrgTrainingEnrollmentsDistribution(req, res, next));

// Org certified employees endpoints (org certified employees drawer)
router.get('/org-certified-employees-monthly', (req, res, next) => analyticsController.getOrgCertifiedEmployeesMonthly(req, res, next));
router.get('/org-certified-employees-distribution', (req, res, next) => analyticsController.getOrgCertifiedEmployeesDistribution(req, res, next));

// Web activities summary endpoint (marketing dashboard)
router.get('/web-activities-summary', (req, res, next) => analyticsController.getWebActivitiesSummary(req, res, next));

// Email CTR endpoint (marketing dashboard)
router.get('/email-ctr', (req, res, next) => analyticsController.getEmailCtr(req, res, next));

// Social reach endpoint (marketing dashboard)
router.get('/social-reach', (req, res, next) => analyticsController.getSocialReach(req, res, next));

// Social media endpoint (marketing dashboard)
router.get('/social-media', (req, res, next) => analyticsController.getSocialMedia(req, res, next));

// North Star metrics endpoints (executive director dashboard)
router.get('/member-retention', (req, res, next) => analyticsController.getMemberRetention(req, res, next));
router.get('/member-acquisition', (req, res, next) => analyticsController.getMemberAcquisition(req, res, next));
router.get('/engaged-community', (req, res, next) => analyticsController.getEngagedCommunity(req, res, next));
router.get('/flywheel-conversion', (req, res, next) => analyticsController.getFlywheelConversion(req, res, next));

// Participating organizations summary endpoint (health metrics page)
router.get('/participating-orgs-summary', (req, res, next) => analyticsController.getParticipatingOrgsSummary(req, res, next));

// NPS summary endpoint (health metrics page)
router.get('/nps-summary', (req, res, next) => analyticsController.getNpsSummary(req, res, next));

// Membership churn per tier summary endpoint (health metrics page)
router.get('/membership-churn-per-tier-summary', (req, res, next) => analyticsController.getMembershipChurnPerTierSummary(req, res, next));

// Events summary endpoint (health metrics page)
router.get('/events-summary', (req, res, next) => analyticsController.getEventsSummary(req, res, next));

// Outstanding balance summary endpoint (health metrics page)
router.get('/outstanding-balance-summary', (req, res, next) => analyticsController.getOutstandingBalanceSummary(req, res, next));

// Training & Certification summary endpoint (health metrics page)
router.get('/training-certification-summary', (req, res, next) => analyticsController.getTrainingCertificationSummary(req, res, next));

// Code Contribution summary endpoint (health metrics page)
router.get('/code-contribution-summary', (req, res, next) => analyticsController.getCodeContributionSummary(req, res, next));

// ED dashboard marketing endpoints — backed by ANALYTICS.PLATINUM_LFX_ONE.* Snowflake views
router.get('/event-growth', (req, res, next) => analyticsController.getEventGrowth(req, res, next));
router.get('/brand-reach', (req, res, next) => analyticsController.getBrandReach(req, res, next));
router.get('/brand-health', (req, res, next) => analyticsController.getBrandHealth(req, res, next));
router.get('/revenue-impact', (req, res, next) => analyticsController.getRevenueImpact(req, res, next));

// Multi-foundation summary endpoint (multi-foundation dashboard)
router.get('/multi-foundation-summary', (req, res, next) => analyticsController.getMultiFoundationSummary(req, res, next));

export default router;
