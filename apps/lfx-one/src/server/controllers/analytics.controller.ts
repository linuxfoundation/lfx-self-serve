// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SALESFORCE_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { assertHealthMetricsRange, getStringQueryParam, getValidatedClassification, getValidatedPeriod, parseEntityType } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgInvolvementService } from '../services/org-involvement.service';
import { OrganizationService } from '../services/organization.service';
import { ProjectService } from '../services/project.service';
import { UserService } from '../services/user.service';
import { getEffectiveEmail } from '../utils/auth-helper';

/** Allowed pattern for foundationSlug: lowercase alphanumeric and hyphens only */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Maximum allowed length for foundationSlug query parameter */
const NAME_MAX_LENGTH = 200;

/**
 * Controller for handling analytics HTTP requests
 * Routes requests to appropriate domain services
 */
export class AnalyticsController {
  private readonly userService: UserService;
  private readonly organizationService: OrganizationService;
  private readonly orgInvolvementService: OrgInvolvementService;
  private readonly projectService: ProjectService;

  public constructor() {
    this.userService = new UserService();
    this.organizationService = new OrganizationService();
    this.orgInvolvementService = new OrgInvolvementService();
    this.projectService = new ProjectService();
  }

  /**
   * GET /api/analytics/active-weeks-streak
   * Get active weeks streak data for the authenticated user
   */
  public async getActiveWeeksStreak(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_active_weeks_streak');

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_active_weeks_streak',
        });
      }

      const response = await this.userService.getActiveWeeksStreak(userEmail);

      logger.success(req, 'get_active_weeks_streak', startTime, {
        total_weeks: response.totalWeeks,
        current_streak: response.currentStreak,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/pull-requests-merged
   * Get pull requests merged activity data for the authenticated user
   */
  public async getPullRequestsMerged(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_pull_requests_merged');

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_pull_requests_merged',
        });
      }

      const response = await this.userService.getPullRequestsMerged(userEmail);

      logger.success(req, 'get_pull_requests_merged', startTime, {
        total_days: response.totalDays,
        total_pull_requests: response.totalPullRequests,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/code-commits
   * Get code commits activity data for the authenticated user
   */
  public async getCodeCommits(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_code_commits');

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_code_commits',
        });
      }

      const response = await this.userService.getCodeCommits(userEmail);

      logger.success(req, 'get_code_commits', startTime, {
        total_days: response.totalDays,
        total_commits: response.totalCommits,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/certified-employees
   * Get certified employees data for an organization with monthly trend data
   * Query params: accountId (required) - Organization account ID, foundationSlug (required) - Foundation slug
   */
  public async getCertifiedEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_certified_employees');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_certified_employees',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_certified_employees',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_certified_employees',
        });
      }

      const response = await this.organizationService.getCertifiedEmployees(accountId, foundationSlug);

      logger.success(req, 'get_certified_employees', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        total_certifications: response.certifications,
        total_certified_employees: response.certifiedEmployees,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/membership-tier
   * Get membership tier data for an organization
   * Query params: accountId (required) - Organization account ID, projectSlug (required) - Foundation project slug
   */
  public async getMembershipTier(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_membership_tier');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const projectSlug = getStringQueryParam(req, 'projectSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_membership_tier',
        });
      }

      if (!projectSlug) {
        throw ServiceValidationError.forField('projectSlug', 'projectSlug query parameter is required', {
          operation: 'get_membership_tier',
        });
      }

      if (!SLUG_PATTERN.test(projectSlug)) {
        throw ServiceValidationError.forField('projectSlug', 'Invalid projectSlug format', {
          operation: 'get_membership_tier',
        });
      }

      const response = await this.organizationService.getMembershipTier(accountId, projectSlug);

      logger.success(req, 'get_membership_tier', startTime, {
        account_id: accountId,
        project_slug: projectSlug,
        membership_tier: response.membershipTier,
        membership_status: response.membershipStatus,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-maintainers
   * Get maintainers data for an organization with monthly trend data
   * Query params: accountId (required) - Organization account ID, foundationSlug (required) - Foundation slug
   */
  public async getOrganizationMaintainers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_organization_maintainers');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_organization_maintainers',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_organization_maintainers',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_organization_maintainers',
        });
      }

      const response = await this.organizationService.getOrganizationMaintainers(accountId, foundationSlug);

      logger.success(req, 'get_organization_maintainers', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        maintainers: response.maintainers,
        projects: response.projects,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-contributors
   * Get contributors data for an organization with monthly trend data
   * Query params: accountId (required) - Organization account ID, foundationSlug (required) - Foundation slug
   */
  public async getOrganizationContributors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_organization_contributors');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_organization_contributors',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_organization_contributors',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_organization_contributors',
        });
      }

      const response = await this.organizationService.getOrganizationContributors(accountId, foundationSlug);

      logger.success(req, 'get_organization_contributors', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        total_active_contributors: response.contributors,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/training-enrollments
   * Get training enrollments data for an organization
   * Query params: accountId (required) - Organization account ID, projectSlug (required) - Foundation project slug
   */
  public async getTrainingEnrollments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_training_enrollments');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const projectSlug = getStringQueryParam(req, 'projectSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_training_enrollments',
        });
      }

      if (!projectSlug) {
        throw ServiceValidationError.forField('projectSlug', 'projectSlug query parameter is required', {
          operation: 'get_training_enrollments',
        });
      }

      if (!SLUG_PATTERN.test(projectSlug)) {
        throw ServiceValidationError.forField('projectSlug', 'Invalid projectSlug format', {
          operation: 'get_training_enrollments',
        });
      }

      const response = await this.organizationService.getTrainingEnrollments(accountId, projectSlug);

      logger.success(req, 'get_training_enrollments', startTime, {
        account_id: accountId,
        project_slug: projectSlug,
        total_enrollments: response.totalEnrollments,
        daily_data_points: response.dailyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/event-attendance-monthly
   * Get event attendance monthly data for an organization with cumulative trends
   * Query params: accountId (required) - Organization account ID, foundationSlug (required) - Foundation slug
   */
  public async getEventAttendanceMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_event_attendance_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_event_attendance_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_event_attendance_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_event_attendance_monthly',
        });
      }

      const response = await this.organizationService.getEventAttendanceMonthly(accountId, foundationSlug);

      logger.success(req, 'get_event_attendance_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        total_attended: response.totalAttended,
        total_speakers: response.totalSpeakers,
        monthly_data_points: response.monthlyLabels.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/project-issues-resolution
   * Get project issues resolution data (opened vs closed issues) from Snowflake
   * Query params: slug (required), entityType (required)
   *   */
  public async getProjectIssuesResolution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_project_issues_resolution');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_project_issues_resolution');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_project_issues_resolution',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_project_issues_resolution',
        });
      }

      const response = await this.projectService.getProjectIssuesResolution(slug, entityType);

      logger.success(req, 'get_project_issues_resolution', startTime, {
        slug,
        entity_type: entityType,
        total_days: response.totalDays,
        total_opened: response.totalOpenedIssues,
        total_closed: response.totalClosedIssues,
        resolution_rate: response.resolutionRatePct,
        median_days_to_close: response.medianDaysToClose,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/project-pull-requests-weekly
   * Get project pull requests weekly data (merge velocity) from Snowflake
   * Query params: slug (required), entityType (required)
   *   */
  public async getProjectPullRequestsWeekly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_project_pull_requests_weekly');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_project_pull_requests_weekly');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_project_pull_requests_weekly',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_project_pull_requests_weekly',
        });
      }

      const response = await this.projectService.getProjectPullRequestsWeekly(slug, entityType);

      logger.success(req, 'get_project_pull_requests_weekly', startTime, {
        slug,
        entity_type: entityType,
        total_weeks: response.totalWeeks,
        total_merged_prs: response.totalMergedPRs,
        avg_merge_time: response.avgMergeTime,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/contributors-mentored
   * Get contributors mentored weekly data from Snowflake
   * Query params: slug (required) - Foundation slug for filtering
   */
  public async getContributorsMentored(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_contributors_mentored');

    try {
      const slug = getStringQueryParam(req, 'slug');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_contributors_mentored',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_contributors_mentored',
        });
      }

      const response = await this.projectService.getContributorsMentored(slug);

      logger.success(req, 'get_contributors_mentored', startTime, {
        slug,
        total_mentored: response.totalMentored,
        avg_weekly_new: response.avgWeeklyNew,
        total_weeks: response.totalWeeks,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/unique-contributors-weekly
   * Get unique contributors weekly data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getUniqueContributorsWeekly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_unique_contributors_weekly');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_unique_contributors_weekly');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_unique_contributors_weekly',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_unique_contributors_weekly',
        });
      }

      const response = await this.projectService.getUniqueContributorsWeekly(slug, entityType);

      logger.success(req, 'get_unique_contributors_weekly', startTime, {
        slug,
        entity_type: entityType,
        total_weeks: response.totalWeeks,
        total_unique: response.totalUniqueContributors,
        avg_unique: response.avgUniqueContributors,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-total-projects
   * Get total projects count for a foundation from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationTotalProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_total_projects');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_total_projects',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_total_projects',
        });
      }

      const response = await this.projectService.getFoundationTotalProjects(foundationSlug);

      logger.success(req, 'get_foundation_total_projects', startTime, {
        foundation_slug: foundationSlug,
        total_projects: response.totalProjects,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-projects-detail
   * Get per-project detail rows for the total projects drill-down drawer
   * Query params: foundationSlug (required)
   */
  public async getFoundationProjectsDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_projects_detail');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_projects_detail',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_projects_detail',
        });
      }

      const response = await this.projectService.getFoundationProjectsDetail(foundationSlug);

      logger.success(req, 'get_foundation_projects_detail', startTime, {
        foundation_slug: foundationSlug,
        total_count: response.totalCount,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-projects-lifecycle-distribution
   * Get lifecycle stage distribution for the total projects drill-down drawer
   * Query params: foundationSlug (required)
   */
  public async getFoundationProjectsLifecycleDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_projects_lifecycle_distribution');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_projects_lifecycle_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_projects_lifecycle_distribution',
        });
      }

      const response = await this.projectService.getFoundationProjectsLifecycleDistribution(foundationSlug);

      logger.success(req, 'get_foundation_projects_lifecycle_distribution', startTime, {
        foundation_slug: foundationSlug,
        stage_count: response.distribution.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-total-members
   * Get total members count for a foundation from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationTotalMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_total_members');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_total_members',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_total_members',
        });
      }

      const response = await this.projectService.getFoundationTotalMembers(foundationSlug);

      logger.success(req, 'get_foundation_total_members', startTime, {
        foundation_slug: foundationSlug,
        total_members: response.totalMembers,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-active-contributors-monthly
   * Get monthly average active contributors for a foundation (last 12 months)
   * Query params: foundationSlug (required)
   */
  public async getFoundationActiveContributorsMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_active_contributors_monthly');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_active_contributors_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_active_contributors_monthly',
        });
      }

      const response = await this.projectService.getFoundationActiveContributorsMonthly(foundationSlug);

      logger.success(req, 'get_foundation_active_contributors_monthly', startTime, {
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-contributors-distribution
   * Get contributor distribution by percentile band for a foundation
   * Query params: foundationSlug (required)
   */
  public async getFoundationContributorsDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_contributors_distribution');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_contributors_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_contributors_distribution',
        });
      }

      const response = await this.projectService.getFoundationContributorsDistribution(foundationSlug);

      logger.success(req, 'get_foundation_contributors_distribution', startTime, {
        foundation_slug: foundationSlug,
        band_count: response.distribution.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-software-value
   * Get foundation software value and top projects from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationSoftwareValue(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_software_value');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_software_value',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_software_value',
        });
      }

      const response = await this.projectService.getFoundationSoftwareValue(foundationSlug);

      logger.success(req, 'get_foundation_software_value', startTime, {
        foundation_slug: foundationSlug,
        total_value_millions: response.totalValue,
        top_projects_count: response.topProjects.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-value-concentration
   * Get foundation value concentration data from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationValueConcentration(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_value_concentration');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_value_concentration',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_value_concentration',
        });
      }

      const response = await this.projectService.getFoundationValueConcentration(foundationSlug);

      logger.success(req, 'get_foundation_value_concentration', startTime, {
        foundation_slug: foundationSlug,
        total_value_millions: response.totalValue,
        total_projects: response.totalProjectsCount,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-maintainers
   * Get foundation maintainers data from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationMaintainers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_maintainers');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_maintainers',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_maintainers',
        });
      }

      const response = await this.projectService.getFoundationMaintainers(foundationSlug);

      logger.success(req, 'get_foundation_maintainers', startTime, {
        foundation_slug: foundationSlug,
        current_maintainers: response.currentMaintainers,
        as_of_date: response.asOfDate,
        trend_data_points: response.trendData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-maintainers-monthly
   * Get monthly maintainer counts for a foundation (last 12 months, all repos)
   * Query params: foundationSlug (required)
   */
  public async getFoundationMaintainersMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_maintainers_monthly');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_maintainers_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_maintainers_monthly',
        });
      }

      const response = await this.projectService.getFoundationMaintainersMonthly(foundationSlug);

      logger.success(req, 'get_foundation_maintainers_monthly', startTime, {
        foundation_slug: foundationSlug,
        month_count: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-maintainers-distribution
   * Get maintainer contribution distribution by percentile band for a foundation
   * Query params: foundationSlug (required)
   */
  public async getFoundationMaintainersDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_maintainers_distribution');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_maintainers_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_maintainers_distribution',
        });
      }

      const response = await this.projectService.getFoundationMaintainersDistribution(foundationSlug);

      logger.success(req, 'get_foundation_maintainers_distribution', startTime, {
        foundation_slug: foundationSlug,
        band_count: response.distribution.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-events-quarterly
   * Get quarterly event counts for a foundation (last 8 quarters)
   * Query params: foundationSlug (required)
   */
  public async getFoundationEventsQuarterly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_events_quarterly');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_events_quarterly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_events_quarterly',
        });
      }

      const response = await this.projectService.getFoundationEventsQuarterly(foundationSlug);

      logger.success(req, 'get_foundation_events_quarterly', startTime, {
        foundation_slug: foundationSlug,
        quarter_count: response.quarterlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-events-attendance-distribution
   * Get event distribution by attendance size bucket for a foundation
   * Query params: foundationSlug (required)
   */
  public async getFoundationEventsAttendanceDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_events_attendance_distribution');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_events_attendance_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_events_attendance_distribution',
        });
      }

      const response = await this.projectService.getFoundationEventsAttendanceDistribution(foundationSlug);

      logger.success(req, 'get_foundation_events_attendance_distribution', startTime, {
        foundation_slug: foundationSlug,
        bucket_count: response.distribution.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-health-score-distribution
   * Get foundation health score distribution from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationHealthScoreDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_foundation_health_score_distribution');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_health_score_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_foundation_health_score_distribution',
        });
      }

      const response = await this.projectService.getFoundationHealthScoreDistribution(foundationSlug);

      const totalProjects = Object.values(response).reduce((sum, count) => sum + count, 0);

      logger.success(req, 'get_foundation_health_score_distribution', startTime, {
        foundation_slug: foundationSlug,
        total_projects: totalProjects,
        excellent: response.excellent,
        healthy: response.healthy,
        stable: response.stable,
        unsteady: response.unsteady,
        critical: response.critical,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/company-bus-factor
   * Get company bus factor data for a foundation
   * Query params: foundationSlug (required)
   */
  public async getCompanyBusFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_company_bus_factor');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_company_bus_factor',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_company_bus_factor',
        });
      }

      const response = await this.organizationService.getCompanyBusFactor(foundationSlug);

      logger.success(req, 'get_company_bus_factor', startTime, {
        foundation_slug: foundationSlug,
        top_companies_count: response.topCompaniesCount,
        top_companies_percentage: response.topCompaniesPercentage,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/health-metrics-daily
   * Get health metrics daily data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getHealthMetricsDaily(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_health_metrics_daily');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_health_metrics_daily');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_health_metrics_daily',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_health_metrics_daily',
        });
      }

      const response = await this.projectService.getHealthMetricsDaily(slug, entityType);

      logger.success(req, 'get_health_metrics_daily', startTime, {
        slug,
        entity_type: entityType,
        total_days: response.totalDays,
        current_avg_health_score: response.currentAvgHealthScore,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/unique-contributors-daily
   * Get unique contributors daily data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getUniqueContributorsDaily(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_unique_contributors_daily');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_unique_contributors_daily');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_unique_contributors_daily',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_unique_contributors_daily',
        });
      }

      const response = await this.projectService.getUniqueContributorsDaily(slug, entityType);

      logger.success(req, 'get_unique_contributors_daily', startTime, {
        slug,
        entity_type: entityType,
        total_days: response.totalDays,
        avg_contributors: response.avgContributors,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/health-events-monthly
   * Get health events monthly data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getHealthEventsMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_health_events_monthly');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_health_events_monthly');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_health_events_monthly',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_health_events_monthly',
        });
      }

      const response = await this.projectService.getHealthEventsMonthly(slug, entityType);

      logger.success(req, 'get_health_events_monthly', startTime, {
        slug,
        entity_type: entityType,
        total_months: response.totalMonths,
        total_events: response.totalEvents,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/code-commits-daily
   * Get code commits daily data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getCodeCommitsDaily(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_code_commits_daily');

    try {
      const slug = getStringQueryParam(req, 'slug');
      const entityType = parseEntityType(req, 'get_code_commits_daily');

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_code_commits_daily',
        });
      }

      if (!SLUG_PATTERN.test(slug)) {
        throw ServiceValidationError.forField('slug', 'Invalid slug format', {
          operation: 'get_code_commits_daily',
        });
      }

      const response = await this.projectService.getCodeCommitsDaily(slug, entityType);

      logger.success(req, 'get_code_commits_daily', startTime, {
        slug,
        entity_type: entityType,
        total_days: response.totalDays,
        total_commits: response.totalCommits,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-contributors-monthly
   * Get monthly unique contributor trend for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgContributorsMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_contributors_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_contributors_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_contributors_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_contributors_monthly',
        });
      }

      const response = await this.organizationService.getOrgContributorsMonthly(accountId, foundationSlug);

      logger.success(req, 'get_org_contributors_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
        total_contributors: response.totalContributors,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-contributors-project-distribution
   * Get top 5 project contributor distribution for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgContributorsProjectDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_contributors_project_distribution');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_contributors_project_distribution',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_contributors_project_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_contributors_project_distribution',
        });
      }

      const response = await this.organizationService.getOrgContributorsProjectDistribution(accountId, foundationSlug);

      logger.success(req, 'get_org_contributors_project_distribution', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        project_count: response.projects.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-maintainers-monthly
   * Get monthly active maintainer trend for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgMaintainersMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_maintainers_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_maintainers_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_maintainers_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_maintainers_monthly',
        });
      }

      const response = await this.organizationService.getOrgMaintainersMonthly(accountId, foundationSlug);

      logger.success(req, 'get_org_maintainers_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
        total_maintainers: response.totalMaintainers,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-maintainers-distribution
   * Get top 5 project maintainer distribution for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgMaintainersDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_maintainers_distribution');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_maintainers_distribution',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_maintainers_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_maintainers_distribution',
        });
      }

      const response = await this.organizationService.getOrgMaintainersDistribution(accountId, foundationSlug);

      logger.success(req, 'get_org_maintainers_distribution', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        project_count: response.projects.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-maintainers-key-members
   * Get key maintainer members for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgMaintainersKeyMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_maintainers_key_members');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_maintainers_key_members',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_maintainers_key_members',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_maintainers_key_members',
        });
      }

      const response = await this.organizationService.getOrgMaintainersKeyMembers(accountId, foundationSlug);

      logger.success(req, 'get_org_maintainers_key_members', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        member_count: response.members.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-event-attendees-monthly
   * Get monthly per-event-attendee counts for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgEventAttendeesMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_event_attendees_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_event_attendees_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_event_attendees_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_event_attendees_monthly',
        });
      }

      const response = await this.organizationService.getOrgEventAttendeesMonthly(accountId, foundationSlug);

      logger.success(req, 'get_org_event_attendees_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
        total_attendees: response.totalAttendees,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-event-speakers-monthly
   * Get monthly per-event-speaker counts for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgEventSpeakersMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_event_speakers_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_event_speakers_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_event_speakers_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_event_speakers_monthly',
        });
      }

      const response = await this.organizationService.getOrgEventSpeakersMonthly(accountId, foundationSlug);

      logger.success(req, 'get_org_event_speakers_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
        total_speakers: response.totalSpeakers,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-training-enrollments-monthly
   * Get monthly training enrollment counts for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgTrainingEnrollmentsMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_training_enrollments_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_training_enrollments_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_training_enrollments_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_training_enrollments_monthly',
        });
      }

      const response = await this.organizationService.getOrgTrainingEnrollmentsMonthly(accountId, foundationSlug);

      logger.success(req, 'get_org_training_enrollments_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
        total_enrollments: response.totalEnrollments,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-training-enrollments-distribution
   * Get training enrollment distribution by project bucket for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgTrainingEnrollmentsDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_training_enrollments_distribution');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_training_enrollments_distribution',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_training_enrollments_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_training_enrollments_distribution',
        });
      }

      const response = await this.organizationService.getOrgTrainingEnrollmentsDistribution(accountId, foundationSlug);

      logger.success(req, 'get_org_training_enrollments_distribution', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        project_count: response.projects.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-certified-employees-monthly
   * Get monthly cumulative certified employee counts for an organization within a foundation
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgCertifiedEmployeesMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_certified_employees_monthly');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_certified_employees_monthly',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_certified_employees_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_certified_employees_monthly',
        });
      }

      const response = await this.organizationService.getOrgCertifiedEmployeesMonthly(accountId, foundationSlug);

      logger.success(req, 'get_org_certified_employees_monthly', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        monthly_data_points: response.monthlyData.length,
        total_certified_employees: response.totalCertifiedEmployees,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-certified-employees-distribution
   * Get certified employees distribution by certification program for an organization
   * Query params: accountId (required), foundationSlug (required)
   */
  public async getOrgCertifiedEmployeesDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_certified_employees_distribution');

    try {
      const accountId = getStringQueryParam(req, 'accountId');
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_org_certified_employees_distribution',
        });
      }

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_org_certified_employees_distribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_org_certified_employees_distribution',
        });
      }

      const response = await this.organizationService.getOrgCertifiedEmployeesDistribution(accountId, foundationSlug);

      logger.success(req, 'get_org_certified_employees_distribution', startTime, {
        account_id: accountId,
        foundation_slug: foundationSlug,
        program_count: response.programs.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  // Organization Involvement Endpoints (cross-foundation, accountId only)

  /**
   * GET /api/analytics/org-foundation-coverage
   * Get foundation coverage for an organization across all LF foundations
   * Query params: accountId (required)
   */
  public async orgFoundationCoverage(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_foundation_coverage');

    try {
      const accountId = this.parseAccountIdParam(req, 'get_org_foundation_coverage');

      const response = await this.orgInvolvementService.getFoundationCoverage(accountId);

      logger.success(req, 'get_org_foundation_coverage', startTime, {
        account_id: accountId,
        foundation_count: response.foundationCount,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-involvement-contributors-monthly
   * Get cross-foundation active contributors monthly for an organization
   * Query params: accountId (required)
   */
  public async orgContributorsMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_involvement_contributors_monthly');

    try {
      const accountId = this.parseAccountIdParam(req, 'get_org_involvement_contributors_monthly');

      const response = await this.orgInvolvementService.getContributorsMonthly(accountId);

      logger.success(req, 'get_org_involvement_contributors_monthly', startTime, {
        account_id: accountId,
        total_active_contributors: response.totalActiveContributors,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-involvement-maintainers-monthly
   * Get cross-foundation maintainers monthly for an organization
   * Query params: accountId (required)
   */
  public async orgMaintainersMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_involvement_maintainers_monthly');

    try {
      const accountId = this.parseAccountIdParam(req, 'get_org_involvement_maintainers_monthly');

      const response = await this.orgInvolvementService.getMaintainersMonthly(accountId);

      logger.success(req, 'get_org_involvement_maintainers_monthly', startTime, {
        account_id: accountId,
        total_maintainers: response.totalMaintainersYearly,
        total_projects: response.totalProjectsYearly,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-involvement-event-attendance-monthly
   * Get cross-foundation event attendance monthly for an organization
   * Query params: accountId (required)
   */
  public async orgEventAttendanceMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_involvement_event_attendance_monthly');

    try {
      const accountId = this.parseAccountIdParam(req, 'get_org_involvement_event_attendance_monthly');

      const response = await this.orgInvolvementService.getEventAttendanceMonthly(accountId);

      logger.success(req, 'get_org_involvement_event_attendance_monthly', startTime, {
        account_id: accountId,
        total_attended: response.totalAttended,
        total_speakers: response.totalSpeakers,
        monthly_data_points: response.monthlyLabels.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-involvement-certified-employees-monthly
   * Get cross-foundation certified employees monthly for an organization
   * Query params: accountId (required)
   */
  public async orgCertifiedEmployeesMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_involvement_certified_employees_monthly');

    try {
      const accountId = this.parseAccountIdParam(req, 'get_org_involvement_certified_employees_monthly');

      const response = await this.orgInvolvementService.getCertifiedEmployeesMonthly(accountId);

      logger.success(req, 'get_org_involvement_certified_employees_monthly', startTime, {
        account_id: accountId,
        total_certifications: response.totalCertifications,
        total_certified_employees: response.totalCertifiedEmployees,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/org-involvement-training-enrollments
   * Get cross-foundation training enrollments YTD for an organization
   * Query params: accountId (required)
   */
  public async orgTrainingEnrollments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_involvement_training_enrollments');

    try {
      const accountId = this.parseAccountIdParam(req, 'get_org_involvement_training_enrollments');

      const response = await this.orgInvolvementService.getTrainingEnrollments(accountId);

      logger.success(req, 'get_org_involvement_training_enrollments', startTime, {
        account_id: accountId,
        total_enrollments: response.totalEnrollments,
        daily_data_points: response.dailyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  // Marketing Analytics Endpoints
  // All marketing endpoints (Web Activities, Email CTR, Social Reach, Social Media, and the
  // ED dashboard KPIs) use `foundationSlug` — underlying Snowflake Platinum views key on a
  // consistent FOUNDATION_SLUG / PROJECT_SLUG column.

  /**
   * GET /api/analytics/web-activities-summary
   * Get web activities summary grouped by domain category
   */
  public async getWebActivitiesSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_web_activities_summary');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_web_activities_summary',
        });
      }

      if (foundationSlug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug exceeds maximum length', {
          operation: 'get_web_activities_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_web_activities_summary',
        });
      }

      const classification = getValidatedClassification(req, 'get_web_activities_summary');
      const period = getValidatedPeriod(req, 'get_web_activities_summary');

      const response = await this.projectService.getWebActivitiesSummary(foundationSlug, classification, period);

      logger.success(req, 'get_web_activities_summary', startTime, {
        foundation_slug: foundationSlug,
        total_sessions: response.totalSessions,
        domain_groups_count: response.domainGroups.length,
        daily_data_points: response.dailyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/email-ctr
   * Get email click-through rate data
   */
  public async getEmailCtr(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_email_ctr');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_email_ctr',
        });
      }

      if (foundationSlug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug exceeds maximum length', {
          operation: 'get_email_ctr',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_email_ctr',
        });
      }

      const classification = getValidatedClassification(req, 'get_email_ctr');
      const period = getValidatedPeriod(req, 'get_email_ctr');

      const response = await this.projectService.getEmailCtr(foundationSlug, classification, period);

      logger.success(req, 'get_email_ctr', startTime, {
        foundation_slug: foundationSlug,
        ...(classification && { classification }),
        current_ctr: response.currentCtr,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/social-reach
   * Get paid social reach and ROAS data
   */
  public async getSocialReach(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_social_reach');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_social_reach',
        });
      }

      if (foundationSlug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug exceeds maximum length', {
          operation: 'get_social_reach',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_social_reach',
        });
      }

      const classification = getValidatedClassification(req, 'get_social_reach');
      const period = getValidatedPeriod(req, 'get_social_reach');

      const response = await this.projectService.getSocialReach(foundationSlug, classification, period);

      logger.success(req, 'get_social_reach', startTime, {
        foundation_slug: foundationSlug,
        total_reach: response.totalReach,
        monthly_data_points: response.monthlyData.length,
        ...(classification && { classification }),
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/keyword-performance
   * Get keyword and search term performance data from Snowflake Platinum tables
   */
  public async getKeywordPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_keyword_performance');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_keyword_performance',
        });
      }

      if (foundationSlug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug exceeds maximum length', {
          operation: 'get_keyword_performance',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_keyword_performance',
        });
      }

      const period = getValidatedPeriod(req, 'get_keyword_performance');

      const response = await this.projectService.getKeywordPerformance(foundationSlug, period);

      logger.success(req, 'get_keyword_performance', startTime, {
        foundation_slug: foundationSlug,
        keyword_count: response.keywords.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/social-media
   * Get social media metrics from Snowflake Platinum tables
   */
  public async getSocialMedia(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_social_media');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_social_media',
        });
      }

      if (foundationSlug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug exceeds maximum length', {
          operation: 'get_social_media',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_social_media',
        });
      }

      const period = getValidatedPeriod(req, 'get_social_media');

      const response = await this.projectService.getSocialMedia(foundationSlug, period);

      logger.success(req, 'get_social_media', startTime, {
        foundation_slug: foundationSlug,
        total_followers: response.totalFollowers,
        platforms_count: response.platforms.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/social-media/monthly
   * Get per-platform monthly social media growth data
   */
  public async getSocialMediaMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_social_media_monthly');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_social_media_monthly',
        });
      }

      if (foundationSlug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug exceeds maximum length', {
          operation: 'get_social_media_monthly',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_social_media_monthly',
        });
      }

      const yearParam = getStringQueryParam(req, 'year');
      if (yearParam && !/^\d{4}$/.test(yearParam)) {
        throw ServiceValidationError.forField('year', 'year must be a 4-digit number', {
          operation: 'get_social_media_monthly',
        });
      }
      const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();

      if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        throw ServiceValidationError.forField('year', 'year must be between 2020 and 2100', {
          operation: 'get_social_media_monthly',
        });
      }

      const response = await this.projectService.getSocialMediaMonthly(foundationSlug, year);

      logger.success(req, 'get_social_media_monthly', startTime, {
        foundation_slug: foundationSlug,
        year,
        platforms_count: response.platforms.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  // North Star Metrics Endpoints
  // All North Star views use `foundationSlug` (FOUNDATION_SLUG column in NORTH_STAR_* tables)

  /**
   * GET /api/analytics/member-retention
   * Get member retention and NRR metrics
   */
  public async getMemberRetention(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_member_retention');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_member_retention',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_member_retention',
        });
      }

      const response = await this.projectService.getMemberRetention(foundationSlug);

      logger.success(req, 'get_member_retention', startTime, {
        foundation_slug: foundationSlug,
        renewal_rate: response.renewalRate,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/member-acquisition
   * Get member acquisition rate metrics
   */
  public async getMemberAcquisition(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_member_acquisition');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_member_acquisition',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_member_acquisition',
        });
      }

      const response = await this.projectService.getMemberAcquisition(foundationSlug);

      logger.success(req, 'get_member_acquisition', startTime, {
        foundation_slug: foundationSlug,
        new_members: response.newMembersThisQuarter,
        quarterly_data_points: response.quarterlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/engaged-community
   * Get engaged community size metrics
   */
  public async getEngagedCommunity(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_engaged_community');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_engaged_community',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_engaged_community',
        });
      }

      const response = await this.projectService.getEngagedCommunity(foundationSlug);

      logger.success(req, 'get_engaged_community', startTime, {
        foundation_slug: foundationSlug,
        total_members: response.totalMembers,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/flywheel-conversion
   * Get flywheel conversion rate metrics
   */
  public async getFlywheelConversion(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_flywheel_conversion');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_flywheel_conversion',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_flywheel_conversion',
        });
      }

      const response = await this.projectService.getFlywheelConversion(foundationSlug);

      logger.success(req, 'get_flywheel_conversion', startTime, {
        foundation_slug: foundationSlug,
        conversion_rate: response.conversionRate,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/nps-summary
   * Get Net Promoter Score summary for a foundation
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getNpsSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_nps_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_nps_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_nps_summary',
        });
      }

      const response = await this.projectService.getNpsSummary(foundationSlug, range);

      logger.success(req, 'get_nps_summary', startTime, {
        foundation_slug: foundationSlug,
        range,
        nps_score: response.npsScore,
        responses: response.responses,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/participating-orgs-summary
   * Get participating organizations summary (membership counts + engagement breakdown)
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getParticipatingOrgsSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_participating_orgs_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_participating_orgs_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_participating_orgs_summary',
        });
      }

      const response = await this.projectService.getParticipatingOrgsSummary(foundationSlug, range);

      logger.success(req, 'get_participating_orgs_summary', startTime, {
        foundation_slug: foundationSlug,
        range,
        total_active_members: response.totalActiveMembers,
        total_new_members: response.totalNewMembers,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/membership-churn-per-tier-summary
   * Get consolidated membership churn per tier summary for a foundation
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getMembershipChurnPerTierSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_membership_churn_per_tier_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_membership_churn_per_tier_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_membership_churn_per_tier_summary',
        });
      }

      const validatedRange = assertHealthMetricsRange(range, 'get_membership_churn_per_tier_summary');

      const response = await this.projectService.getMembershipChurnPerTierSummary(foundationSlug, validatedRange);

      logger.success(req, 'get_membership_churn_per_tier_summary', startTime, {
        foundation_slug: foundationSlug,
        range,
        comparison_available: response.comparisonAvailable,
        current_churn_rate_pct: response.currentPeriod.churnRatePct,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/events-summary
   * Get events summary for a foundation (total events, change, sponsorship vs goal)
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getEventsSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_events_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_events_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_events_summary',
        });
      }

      const response = await this.projectService.getEventsSummary(foundationSlug, range);

      logger.success(req, 'get_events_summary', startTime, {
        foundation_slug: foundationSlug,
        range,
        project_id: response.projectId,
        total_events: response.totalEvents,
        event_change: response.eventChange,
        sponsorship_revenue: response.sponsorshipRevenue,
        sponsorship_goal: response.sponsorshipGoal,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/outstanding-balance-summary
   * Get outstanding balance summary for a foundation
   * Query params: foundationSlug (required)
   */
  public async getOutstandingBalanceSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_outstanding_balance_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_outstanding_balance_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_outstanding_balance_summary',
        });
      }

      const response = await this.projectService.getOutstandingBalanceSummary(foundationSlug);

      logger.success(req, 'get_outstanding_balance_summary', startTime, {
        foundation_slug: foundationSlug,
        project_id: response.projectId,
        total_outstanding_balance: response.totalOutstandingBalance,
        total_members_at_risk: response.totalMembersAtRisk,
        primary_risk_level: response.primaryRiskLevel,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/training-certification-summary
   * Get Training & Certification summary for a foundation
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getTrainingCertificationSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_training_certification_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_training_certification_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_training_certification_summary',
        });
      }

      const validatedRange = assertHealthMetricsRange(range, 'get_training_certification_summary');

      const response = await this.projectService.getTrainingCertificationSummary(foundationSlug, validatedRange);

      logger.success(req, 'get_training_certification_summary', startTime, {
        foundation_slug: foundationSlug,
        project_id: response.projectId,
        range: response.range,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/code-contribution-summary
   * Get Code Contribution summary for a foundation
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getCodeContributionSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_code_contribution_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_code_contribution_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_code_contribution_summary',
        });
      }

      const validatedRange = assertHealthMetricsRange(range, 'get_code_contribution_summary');

      const response = await this.projectService.getCodeContributionSummary(foundationSlug, validatedRange);

      logger.success(req, 'get_code_contribution_summary', startTime, {
        foundation_slug: foundationSlug,
        project_id: response.projectId,
        range: response.range,
        data_available: response.dataAvailable,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/board-meeting-participation-summary
   * Get Board Meeting Participation summary for a foundation
   * Query params: foundationSlug (required), range (optional, default 'YTD')
   */
  public async getBoardMeetingParticipationSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_board_meeting_participation_summary');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;
      const range = (req.query['range'] as string | undefined) || 'YTD';

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_board_meeting_participation_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_board_meeting_participation_summary',
        });
      }

      const validatedRange = assertHealthMetricsRange(range, 'get_board_meeting_participation_summary');

      const response = await this.projectService.getBoardMeetingParticipationSummary(foundationSlug, validatedRange);

      logger.success(req, 'get_board_meeting_participation_summary', startTime, {
        foundation_slug: foundationSlug,
        project_id: response.projectId,
        range: response.range,
        data_available: response.dataAvailable,
        total_meetings: response.totalMeetings,
        invitees_count: response.invitees.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/analytics/event-growth
   * Get event growth metrics (total attendees, top events by attendance/revenue)
   */
  public async getEventGrowth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_event_growth');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_event_growth',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_event_growth',
        });
      }

      const response = await this.projectService.getEventGrowth(foundationSlug);

      logger.success(req, 'get_event_growth', startTime, {
        foundation_slug: foundationSlug,
        total_attendees: response.totalAttendees,
        total_events: response.totalEvents,
        top_events: response.topEvents.length,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/events-overview-summary
   * Foundation-wide Events Summary tiles for the Marketing Impact Overview tab
   * (registrations, attendees, speakers, countries, organizations, events, sponsorship $).
   */
  public async getEventsOverviewSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_events_overview_summary');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_events_overview_summary',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_events_overview_summary',
        });
      }

      const response = await this.projectService.getEventsOverviewSummary(foundationSlug);

      logger.success(req, 'get_events_overview_summary', startTime, {
        foundation_slug: foundationSlug,
        project_id: response.projectId,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/event-roster
   * Foundation event roster — one row per event with registration/sponsorship
   * actual-vs-goal, comparison rating, and CFP status. Defaults to upcoming events;
   * pass includePast=true for the full history.
   */
  public async getEventRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_event_roster');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_event_roster',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_event_roster',
        });
      }

      const includePast = getStringQueryParam(req, 'includePast') === 'true';

      const response = await this.projectService.getEventRoster(foundationSlug, includePast);

      logger.success(req, 'get_event_roster', startTime, {
        foundation_slug: foundationSlug,
        include_past: includePast,
        event_count: response.events.length,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/brand-reach
   * Get brand reach metrics (total digital reach across social + owned sites)
   */
  public async getBrandReach(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_brand_reach');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_brand_reach',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_brand_reach',
        });
      }

      const classification = getValidatedClassification(req, 'get_brand_reach');

      const response = await this.projectService.getBrandReach(foundationSlug, classification);

      logger.success(req, 'get_brand_reach', startTime, {
        foundation_slug: foundationSlug,
        total_social_followers: response.totalSocialFollowers,
        total_monthly_sessions: response.totalMonthlySessions,
        social_platforms: response.socialPlatforms.length,
        ...(classification && { classification }),
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/brand-health
   * Get brand health metrics (share of voice, sentiment, press mentions)
   */
  public async getBrandHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_brand_health');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_brand_health',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_brand_health',
        });
      }

      const includeMentions = getStringQueryParam(req, 'includeMentions') === 'true';
      const period = getValidatedPeriod(req, 'get_brand_health');
      const response = await this.projectService.getBrandHealth(foundationSlug, includeMentions, period);

      logger.success(req, 'get_brand_health', startTime, {
        foundation_slug: foundationSlug,
        total_mentions: response.totalMentions,
        positive_sentiment: response.sentiment.positive,
        top_projects: response.topProjects.length,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/revenue-impact
   * Get marketing-attributed revenue metrics by engagement type
   */
  public async getRevenueImpact(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_revenue_impact');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_revenue_impact',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_revenue_impact',
        });
      }

      const classification = getValidatedClassification(req, 'get_revenue_impact');
      const period = getValidatedPeriod(req, 'get_revenue_impact');

      const response = await this.projectService.getRevenueImpact(foundationSlug, classification, period);

      logger.success(req, 'get_revenue_impact', startTime, {
        foundation_slug: foundationSlug,
        pipeline_influenced: response.pipelineInfluenced,
        revenue_attributed: response.revenueAttributed,
        engagement_types: response.engagementTypes.length,
        ...(classification && { classification }),
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/marketing-attribution
   * Get channel-level marketing attribution with multi-touch revenue models
   * Query params: foundationSlug (required)
   */
  public async getMarketingAttribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_marketing_attribution');

    try {
      const foundationSlug = getStringQueryParam(req, 'foundationSlug');

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_marketing_attribution',
        });
      }

      if (!SLUG_PATTERN.test(foundationSlug)) {
        throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', {
          operation: 'get_marketing_attribution',
        });
      }

      const classification = getValidatedClassification(req, 'get_marketing_attribution');
      const period = getValidatedPeriod(req, 'get_marketing_attribution');

      const response = await this.projectService.getMarketingAttribution(foundationSlug, classification, period);

      logger.success(req, 'get_marketing_attribution', startTime, {
        foundation_slug: foundationSlug,
        channel_count: response.channels.length,
        project_count: response.projects.length,
        ...(classification && { classification }),
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/multi-foundation-summary
   * Aggregate analytics across multiple foundations in a single request
   * Query params: slugs (required, comma-separated foundation slugs, max 25)
   */
  public async getMultiFoundationSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_multi_foundation_summary');

    try {
      const slugs = this.parseAndValidateSlugs(req);

      const response = await this.projectService.getMultiFoundationSummary(req, slugs);

      logger.success(req, 'get_multi_foundation_summary', startTime, {
        slug_count: slugs.length,
        foundations_returned: Object.keys(response.perFoundation).length,
        aggregated_projects: response.aggregated.totalProjects,
        aggregated_members: response.aggregated.totalMembers,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/analytics/org-lens-account-context
   * Resolve LFX One Org Lens display context for a set of Salesforce
   * accounts — one denormalised row per account_id with cdev mapping
   * and highest active corporate membership tier.
   * Query params: accountIds (required) - Comma-separated Salesforce account IDs (max 50)
   */
  public async getOrgLensAccountContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_lens_account_context');

    try {
      const accountIds = this.parseAccountIdsParam(req, 'get_org_lens_account_context');
      const response = await this.organizationService.getOrgLensAccountContext(accountIds);

      logger.success(req, 'get_org_lens_account_context', startTime, {
        requested_count: accountIds.length,
        resolved_count: response.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Parse and validate a comma-separated slugs query parameter.
   * @throws ServiceValidationError if the parameter is missing, empty, exceeds max count, or has invalid format
   */
  private parseAndValidateSlugs(req: Request, maxCount: number = 25): string[] {
    const slugsParam = getStringQueryParam(req, 'slugs');

    if (!slugsParam) {
      throw ServiceValidationError.forField('slugs', 'slugs query parameter is required', {
        operation: 'get_multi_foundation_summary',
      });
    }

    const slugs = [
      ...new Set(
        slugsParam
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    ];

    if (slugs.length === 0) {
      throw ServiceValidationError.forField('slugs', 'At least one foundation slug is required', {
        operation: 'get_multi_foundation_summary',
      });
    }

    if (slugs.length > maxCount) {
      throw ServiceValidationError.forField('slugs', `Maximum of ${maxCount} foundation slugs allowed per request`, {
        operation: 'get_multi_foundation_summary',
      });
    }

    for (const slug of slugs) {
      if (!SLUG_PATTERN.test(slug) || slug.length > NAME_MAX_LENGTH) {
        throw ServiceValidationError.forField('slugs', `Invalid foundation slug format: ${slug}`, {
          operation: 'get_multi_foundation_summary',
        });
      }
    }

    return slugs;
  }

  /** Parse and validate the `accountId` query parameter (single Salesforce account ID); enforces presence and 15/18-char alphanumeric format. */
  private parseAccountIdParam(req: Request, operation: string): string {
    const accountId = getStringQueryParam(req, 'accountId');
    if (!accountId) {
      throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', { operation });
    }
    if (!SALESFORCE_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', { operation });
    }
    return accountId;
  }

  /**
   * Parse and validate the `accountIds` query parameter (comma-separated
   * Salesforce account IDs). De-duplicates, enforces a 50-id ceiling, and
   * checks each id matches the Salesforce 15/18-char alphanumeric format.
   */
  private parseAccountIdsParam(req: Request, operation: string): string[] {
    const raw = getStringQueryParam(req, 'accountIds');
    if (!raw) {
      throw ServiceValidationError.forField('accountIds', 'accountIds query parameter is required', { operation });
    }

    const ids = [
      ...new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    ];

    if (ids.length === 0) {
      throw ServiceValidationError.forField('accountIds', 'At least one accountId is required', { operation });
    }

    const MAX_ACCOUNT_IDS = 50;
    if (ids.length > MAX_ACCOUNT_IDS) {
      throw ServiceValidationError.forField('accountIds', `Maximum of ${MAX_ACCOUNT_IDS} accountIds allowed per request`, { operation });
    }

    for (const id of ids) {
      if (!SALESFORCE_ACCOUNT_ID_PATTERN.test(id)) {
        throw ServiceValidationError.forField('accountIds', 'Invalid Salesforce accountId format', { operation });
      }
    }

    return ids;
  }
}
