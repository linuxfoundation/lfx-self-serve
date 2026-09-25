// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { AnalyticsController } from '../controllers/analytics.controller';
import { requireDashboardAccess } from '../middleware/require-dashboard-access.middleware';
import { requireMarketingAuditor, requireMarketingAuditorOrLfStaff, requireNorthStarAccess } from '../middleware/require-marketing-access.middleware';
import { requireOrgAnalyticsAccess } from '../middleware/require-org-analytics-access.middleware';

const router = Router();

const analyticsController = new AnalyticsController();

// User analytics routes
router.get('/active-weeks-streak', (req, res, next) => analyticsController.getActiveWeeksStreak(req, res, next));
router.get('/pull-requests-merged', (req, res, next) => analyticsController.getPullRequestsMerged(req, res, next));
router.get('/code-commits', (req, res, next) => analyticsController.getCodeCommits(req, res, next));

// Org-scoped rows (Board Member dashboard, org drawers, org overview): each reads another organization's
// Snowflake rows by the caller-supplied `accountId`, so `requireOrgAnalyticsAccess` authorizes that
// account before the handler runs — the id filters the data, it never authorizes it (ADR-0038).

// Certified employees endpoint
router.get('/certified-employees', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getCertifiedEmployees(req, res, next));

// Membership tier endpoint
router.get('/membership-tier', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getMembershipTier(req, res, next));

// Organization maintainers endpoint
router.get('/organization-maintainers', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrganizationMaintainers(req, res, next));

// Organization contributors endpoint
router.get('/organization-contributors', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrganizationContributors(req, res, next));

// Training enrollments endpoint
router.get('/training-enrollments', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getTrainingEnrollments(req, res, next));

// Event attendance monthly endpoint
router.get('/event-attendance-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getEventAttendanceMonthly(req, res, next));

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

// Foundation active contributors monthly-distinct endpoint (active contributors drill-down)
router.get('/foundation-active-contributors-monthly-distinct', (req, res, next) =>
  analyticsController.getFoundationActiveContributorsMonthlyDistinct(req, res, next)
);

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

// Foundation projects detail grouped endpoint (Foundation Projects page, sub-foundations included)
router.get('/foundation-projects-detail-grouped', (req, res, next) => analyticsController.getFoundationProjectsDetailGrouped(req, res, next));

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
router.get('/org-contributors-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrgContributorsMonthly(req, res, next));

// Org active contributors project distribution endpoint (org involvement drawer)
router.get('/org-contributors-project-distribution', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.getOrgContributorsProjectDistribution(req, res, next)
);

// Org maintainers monthly trend endpoint (org maintainers drawer)
router.get('/org-maintainers-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrgMaintainersMonthly(req, res, next));

// Org maintainers distribution endpoint (org maintainers drawer)
router.get('/org-maintainers-distribution', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrgMaintainersDistribution(req, res, next));

// Org maintainers key members endpoint (org maintainers drawer)
router.get('/org-maintainers-key-members', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrgMaintainersKeyMembers(req, res, next));

// Org event attendees monthly endpoint (org event attendees drawer)
router.get('/org-event-attendees-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrgEventAttendeesMonthly(req, res, next));

// Org event speakers monthly endpoint (org event speakers drawer)
router.get('/org-event-speakers-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.getOrgEventSpeakersMonthly(req, res, next));

// Org training enrollments endpoints (org training enrollments drawer)
router.get('/org-training-enrollments-monthly', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.getOrgTrainingEnrollmentsMonthly(req, res, next)
);
router.get('/org-training-enrollments-distribution', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.getOrgTrainingEnrollmentsDistribution(req, res, next)
);

// Org certified employees endpoints (org certified employees drawer)
router.get('/org-certified-employees-monthly', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.getOrgCertifiedEmployeesMonthly(req, res, next)
);
router.get('/org-certified-employees-distribution', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.getOrgCertifiedEmployeesDistribution(req, res, next)
);

// Organization involvement endpoints (cross-foundation, accountId only — org overview page)
router.get('/org-foundation-coverage', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.orgFoundationCoverage(req, res, next));
router.get('/org-involvement-contributors-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.orgContributorsMonthly(req, res, next));
router.get('/org-involvement-maintainers-monthly', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.orgMaintainersMonthly(req, res, next));
router.get('/org-involvement-event-attendance-monthly', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.orgEventAttendanceMonthly(req, res, next)
);
router.get('/org-involvement-certified-employees-monthly', requireOrgAnalyticsAccess, (req, res, next) =>
  analyticsController.orgCertifiedEmployeesMonthly(req, res, next)
);
router.get('/org-involvement-training-enrollments', requireOrgAnalyticsAccess, (req, res, next) => analyticsController.orgTrainingEnrollments(req, res, next));

// Marketing-ops gated (LFXV2-2235): returns web activity summary metrics. Shared with LF Staff
// Marketing Overview dashboard. See note above on `requireMarketingAuditorOrLfStaff`.
router.get('/web-activities-summary', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getWebActivitiesSummary(req, res, next));

// Marketing-ops gated (LFXV2-2235): returns email click-through-rate metrics. Shared with LF
// Staff Marketing Overview dashboard. See note above on `requireMarketingAuditorOrLfStaff`.
router.get('/email-ctr', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getEmailCtr(req, res, next));

// Marketing-ops gated (LFXV2-2235): returns paid social reach metrics. Shared with LF Staff
// Marketing Overview dashboard. See note above on `requireMarketingAuditorOrLfStaff`.
router.get('/social-reach', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getSocialReach(req, res, next));

// Marketing-ops gated (LFXV2-2235): returns keyword performance metrics (marketing dashboard).
// Part of the full Marketing Impact tab set admitted to marketing_auditor grantees, not just
// ED — LF Staff without that grant get the Social-Listening-only view and never reach this route.
// See note above on `requireMarketingAuditor`.
router.get('/keyword-performance', requireMarketingAuditor, (req, res, next) => analyticsController.getKeywordPerformance(req, res, next));

// Marketing-ops gated (LFXV2-2235): returns social media metrics (marketing dashboard). See
// note above on `requireMarketingAuditor`.
router.get('/social-media', requireMarketingAuditor, (req, res, next) => analyticsController.getSocialMedia(req, res, next));
router.get('/social-media/monthly', requireMarketingAuditor, (req, res, next) => analyticsController.getSocialMediaMonthly(req, res, next));

// North Star metrics endpoints (executive director dashboard). These return confidential foundation
// revenue/retention KPIs straight from Snowflake with the BFF's own credentials, so the BFF is the
// only authorization point. They render in Marketing Overview alongside `event-growth`/`brand-reach`
// (and the ED + LF Staff health-metrics flywheel card), so they share that audience's gate: LF Staff,
// EDs scoped to the requested foundation, and marketing_auditor grantees. The handlers aggregate every
// foundation for `tlf`, so `requireNorthStarAccess` refuses a project-scoped grant on `tlf` and
// requires the ROOT grant for that umbrella view.
router.get('/member-retention', requireNorthStarAccess, (req, res, next) => analyticsController.getMemberRetention(req, res, next));
router.get('/member-acquisition', requireNorthStarAccess, (req, res, next) => analyticsController.getMemberAcquisition(req, res, next));
router.get('/engaged-community', requireNorthStarAccess, (req, res, next) => analyticsController.getEngagedCommunity(req, res, next));
router.get('/flywheel-conversion', requireNorthStarAccess, (req, res, next) => analyticsController.getFlywheelConversion(req, res, next));

// Health metrics page endpoints (ED + LF Staff) — the health-metrics route is gated client-side by
// dashboardAccessGuard; requireDashboardAccess enforces the same policy server-side so the
// foundationSlug query param can't be used to pull another foundation's data (see PR #2600 review).
router.get('/participating-orgs-summary', requireDashboardAccess, (req, res, next) => analyticsController.getParticipatingOrgsSummary(req, res, next));
router.get('/nps-summary', requireDashboardAccess, (req, res, next) => analyticsController.getNpsSummary(req, res, next));
router.get('/membership-churn-per-tier-summary', requireDashboardAccess, (req, res, next) =>
  analyticsController.getMembershipChurnPerTierSummary(req, res, next)
);
router.get('/events-summary', requireDashboardAccess, (req, res, next) => analyticsController.getEventsSummary(req, res, next));
router.get('/outstanding-balance-summary', requireDashboardAccess, (req, res, next) => analyticsController.getOutstandingBalanceSummary(req, res, next));
router.get('/training-certification-summary', requireDashboardAccess, (req, res, next) => analyticsController.getTrainingCertificationSummary(req, res, next));
router.get('/code-contribution-summary', requireDashboardAccess, (req, res, next) => analyticsController.getCodeContributionSummary(req, res, next));
router.get('/board-meeting-participation-summary', requireDashboardAccess, (req, res, next) =>
  analyticsController.getBoardMeetingParticipationSummary(req, res, next)
);

// Health Metrics Overview "Foundation Revenue" rail endpoint (LFXV2-3365)
router.get('/health-overview-revenue', requireDashboardAccess, (req, res, next) => analyticsController.getHealthOverviewRevenue(req, res, next));

// Health Metrics Overview KPI tile-strip endpoint (LFXV2-3365)
router.get('/health-overview-kpis', requireDashboardAccess, (req, res, next) => analyticsController.getHealthOverviewKpis(req, res, next));

// Health Metrics Overview "Foundation" rail endpoint (LFXV2-3365)
router.get('/foundation-profile-summary', requireDashboardAccess, (req, res, next) => analyticsController.getFoundationProfileSummary(req, res, next));

// Health Metrics Engagement "Group attendance" section (#2802)
router.get('/engagement-group-attendance', requireDashboardAccess, (req, res, next) => analyticsController.getEngagementGroupAttendance(req, res, next));

// Health Metrics Engagement "Meeting participation" section (#2802)
router.get('/engagement-meeting-participation', requireDashboardAccess, (req, res, next) =>
  analyticsController.getEngagementMeetingParticipation(req, res, next)
);

// Health Metrics Engagement "Organization participation" section (#2802)
router.get('/engagement-org-participation', requireDashboardAccess, (req, res, next) => analyticsController.getEngagementOrgParticipation(req, res, next));

// Health Metrics Engagement "Non-member participation" section (#2802)
router.get('/engagement-non-member-participation', requireDashboardAccess, (req, res, next) =>
  analyticsController.getEngagementNonMemberParticipation(req, res, next)
);

// Health Metrics Engagement "Representatives" section (#2802)
router.get('/engagement-representatives', requireDashboardAccess, (req, res, next) => analyticsController.getEngagementRepresentatives(req, res, next));

// Health Metrics Events "Registration forecast" section (#2964)
router.get('/events-registration-forecast', requireDashboardAccess, (req, res, next) => analyticsController.getEventsRegistrationForecast(req, res, next));
router.get('/events-registration-forecast-curve', requireDashboardAccess, (req, res, next) =>
  analyticsController.getEventsRegistrationForecastCurve(req, res, next)
);

// Health Metrics Events "Past events" section (#2965)
router.get('/events-past', requireDashboardAccess, (req, res, next) => analyticsController.getEventsPast(req, res, next));

// ED dashboard marketing endpoints — backed by ANALYTICS.PLATINUM_LFX_ONE.* Snowflake views
// Marketing-ops gated (LFXV2-2235): returns event growth trends and metrics.
// Authorization is enforced server-side with ED/FGA detection. Shared with LF Staff Marketing
// Overview dashboard; `requireMarketingAuditorOrLfStaff` falls back to ED-only while its server
// flag is off.
router.get('/event-growth', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getEventGrowth(req, res, next));
// Marketing-ops gated (LFXV2-2235): returns per-event sponsorship and registration figures.
// The marketing-impact page hides these from unauthorized users client-side only, so
// authorization is enforced here with server-verified ED/FGA detection rather than trusting
// the UI guard. `requireMarketingAuditor` falls back to ED-only while its server flag is off.
router.get('/events-overview-summary', requireMarketingAuditor, (req, res, next) => analyticsController.getEventsOverviewSummary(req, res, next));
// Marketing-ops gated (LFXV2-2235): returns per-event registration, attendance and
// sponsorship goal figures. See note above on `requireMarketingAuditor`.
router.get('/event-roster', requireMarketingAuditor, (req, res, next) => analyticsController.getEventRoster(req, res, next));
// Marketing-ops gated (LFXV2-2235): returns one event's registration and sponsorship figures
// against goal, plus the per-tier sponsorship breakdown and CFP status. See note above on
// `requireMarketingAuditor`.
router.get('/event-detail', requireMarketingAuditor, (req, res, next) => analyticsController.getEventDetail(req, res, next));
// Marketing-ops gated (LFXV2-2235): returns brand reach and engagement metrics across
// social channels. Shared with LF Staff Marketing Overview dashboard. See note above on
// `requireMarketingAuditorOrLfStaff`.
router.get('/brand-reach', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getBrandReach(req, res, next));
// Social listening view backs both unrestricted (ED/marketing_auditor) and LF Staff-only
// views, so it needs authorization that admits LF Staff.
router.get('/brand-health', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getBrandHealth(req, res, next));
// Marketing-ops gated (LFXV2-2235): returns revenue impact and attribution by channel.
// Shared with LF Staff Marketing Overview dashboard. See note above on
// `requireMarketingAuditorOrLfStaff`.
router.get('/revenue-impact', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getRevenueImpact(req, res, next));
// Marketing-ops gated (LFXV2-2235): returns marketing attribution and performance by
// campaign and channel. Shared with LF Staff Marketing Overview dashboard. See note above on
// `requireMarketingAuditorOrLfStaff`.
router.get('/marketing-attribution', requireMarketingAuditorOrLfStaff, (req, res, next) => analyticsController.getMarketingAttribution(req, res, next));

// Multi-foundation summary endpoint (multi-foundation dashboard)
router.get('/multi-foundation-summary', (req, res, next) => analyticsController.getMultiFoundationSummary(req, res, next));

// Org Lens — bootstrap account context (display attrs + cdev mapping + tier). Takes a batch of
// account ids, so the handler filters it to the readable ones (`filterReadableAccountIds`) rather
// than failing the whole bootstrap enrichment on one id.
router.get('/org-lens-account-context', (req, res, next) => analyticsController.getOrgLensAccountContext(req, res, next));

export default router;
