// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { OrganizationService } from '../services/organization.service';
import { ProjectService } from '../services/project.service';
import { UserService } from '../services/user.service';

/**
 * Controller for handling analytics HTTP requests
 * Routes requests to appropriate domain services
 */
export class AnalyticsController {
  private userService: UserService;
  private organizationService: OrganizationService;
  private projectService: ProjectService;

  public constructor() {
    this.userService = new UserService();
    this.organizationService = new OrganizationService();
    this.projectService = new ProjectService();
  }

  /**
   * GET /api/analytics/active-weeks-streak
   * Get active weeks streak data for the authenticated user
   */
  public async getActiveWeeksStreak(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_active_weeks_streak');

    try {
      const userEmail = req.oidc?.user?.['email'];

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_active_weeks_streak',
        });
      }

      const response = await this.userService.getActiveWeeksStreak(userEmail);

      Logger.success(req, 'get_active_weeks_streak', startTime, {
        total_weeks: response.totalWeeks,
        current_streak: response.currentStreak,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_active_weeks_streak', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/pull-requests-merged
   * Get pull requests merged activity data for the authenticated user
   */
  public async getPullRequestsMerged(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_pull_requests_merged');

    try {
      const userEmail = req.oidc?.user?.['email'];

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_pull_requests_merged',
        });
      }

      const response = await this.userService.getPullRequestsMerged(userEmail);

      Logger.success(req, 'get_pull_requests_merged', startTime, {
        total_days: response.totalDays,
        total_pull_requests: response.totalPullRequests,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_pull_requests_merged', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/code-commits
   * Get code commits activity data for the authenticated user
   */
  public async getCodeCommits(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_code_commits');

    try {
      const userEmail = req.oidc?.user?.['email'];

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_code_commits',
        });
      }

      const response = await this.userService.getCodeCommits(userEmail);

      Logger.success(req, 'get_code_commits', startTime, {
        total_days: response.totalDays,
        total_commits: response.totalCommits,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_code_commits', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/my-projects
   * Get user's projects with activity data for the last 30 days
   * Supports pagination via query parameters: page (default 1) and limit (default 10)
   */
  public async getMyProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_my_projects');

    try {
      // Parse pagination parameters
      const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query['limit'] as string, 10) || 10));

      const response = await this.userService.getMyProjects(page, limit);

      Logger.success(req, 'get_my_projects', startTime, {
        page,
        limit,
        returned_projects: response.data.length,
        total_projects: response.totalProjects,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_my_projects', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-events-overview
   * Get consolidated organization events data (event attendance + event sponsorships) in a single request
   * Query params: accountId (required) - Organization account ID
   *   */
  public async getOrganizationEventsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_organization_events_overview');

    try {
      const accountId = req.query['accountId'] as string | undefined;

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_organization_events_overview',
        });
      }

      // Query for event metrics
      const response = await this.organizationService.getEventsOverview(accountId);

      Logger.success(req, 'get_organization_events_overview', startTime, {
        account_id: accountId,
        total_attendees: response.eventAttendance.totalAttendees,
        total_speakers: response.eventAttendance.totalSpeakers,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_organization_events_overview', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/certified-employees
   * Get certified employees data for an organization
   * Query params: accountId (required) - Organization account ID, projectSlug (required) - Foundation project slug
   */
  public async getCertifiedEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_certified_employees');

    try {
      const accountId = req.query['accountId'] as string | undefined;
      const projectSlug = req.query['projectSlug'] as string | undefined;

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_certified_employees',
        });
      }

      if (!projectSlug) {
        throw ServiceValidationError.forField('projectSlug', 'projectSlug query parameter is required', {
          operation: 'get_certified_employees',
        });
      }

      const response = await this.organizationService.getCertifiedEmployees(accountId, projectSlug);

      Logger.success(req, 'get_certified_employees', startTime, {
        account_id: accountId,
        project_slug: projectSlug,
        certifications: response.certifications,
        certified_employees: response.certifiedEmployees,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_certified_employees', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/membership-tier
   * Get membership tier data for an organization
   * Query params: accountId (required) - Organization account ID, projectSlug (required) - Foundation project slug
   */
  public async getMembershipTier(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_membership_tier');

    try {
      const accountId = req.query['accountId'] as string | undefined;
      const projectSlug = req.query['projectSlug'] as string | undefined;

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

      const response = await this.organizationService.getMembershipTier(accountId, projectSlug);

      Logger.success(req, 'get_membership_tier', startTime, {
        account_id: accountId,
        project_slug: projectSlug,
        membership_tier: response.membershipTier,
        membership_status: response.membershipStatus,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_membership_tier', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-maintainers
   * Get maintainers data for an organization
   * Query params: accountId (required) - Organization account ID
   */
  public async getOrganizationMaintainers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_organization_maintainers');

    try {
      const accountId = req.query['accountId'] as string | undefined;

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_organization_maintainers',
        });
      }

      const response = await this.organizationService.getOrganizationMaintainers(accountId);

      Logger.success(req, 'get_organization_maintainers', startTime, {
        account_id: accountId,
        maintainers: response.maintainers,
        projects: response.projects,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_organization_maintainers', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-contributors
   * Get contributors data for an organization
   * Query params: accountId (required) - Organization account ID
   */
  public async getOrganizationContributors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_organization_contributors');

    try {
      const accountId = req.query['accountId'] as string | undefined;

      if (!accountId) {
        throw ServiceValidationError.forField('accountId', 'accountId query parameter is required', {
          operation: 'get_organization_contributors',
        });
      }

      const response = await this.organizationService.getOrganizationContributors(accountId);

      Logger.success(req, 'get_organization_contributors', startTime, {
        account_id: accountId,
        contributors: response.contributors,
        projects: response.projects,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_organization_contributors', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/training-enrollments
   * Get training enrollments data for an organization
   * Query params: accountId (required) - Organization account ID, projectSlug (required) - Foundation project slug
   */
  public async getTrainingEnrollments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_training_enrollments');

    try {
      const accountId = req.query['accountId'] as string | undefined;
      const projectSlug = req.query['projectSlug'] as string | undefined;

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

      const response = await this.organizationService.getTrainingEnrollments(accountId, projectSlug);

      Logger.success(req, 'get_training_enrollments', startTime, {
        account_id: accountId,
        project_slug: projectSlug,
        total_enrollments: response.totalEnrollments,
        daily_data_points: response.dailyData.length,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_training_enrollments', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/projects
   * Get list of projects with maintainers from Snowflake
   *   */
  public async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_projects_list');

    try {
      const response = await this.projectService.getProjectsWithMaintainersList();

      Logger.success(req, 'get_projects_list', startTime, {
        project_count: response.projects.length,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_projects_list', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/project-issues-resolution
   * Get project issues resolution data (opened vs closed issues) from Snowflake
   * Query params: slug (required), entityType (required)
   *   */
  public async getProjectIssuesResolution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_project_issues_resolution');

    try {
      const slug = req.query['slug'] as string | undefined;
      const entityType = req.query['entityType'] as 'foundation' | 'project' | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_project_issues_resolution',
        });
      }

      if (!entityType) {
        throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', {
          operation: 'get_project_issues_resolution',
        });
      }

      // Validate entityType
      if (entityType !== 'foundation' && entityType !== 'project') {
        throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', {
          operation: 'get_project_issues_resolution',
        });
      }

      const response = await this.projectService.getProjectIssuesResolution(slug, entityType);

      Logger.success(req, 'get_project_issues_resolution', startTime, {
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
      Logger.error(req, 'get_project_issues_resolution', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/project-pull-requests-weekly
   * Get project pull requests weekly data (merge velocity) from Snowflake
   * Query params: slug (required), entityType (required)
   *   */
  public async getProjectPullRequestsWeekly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_project_pull_requests_weekly');

    try {
      const slug = req.query['slug'] as string | undefined;
      const entityType = req.query['entityType'] as 'foundation' | 'project' | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_project_pull_requests_weekly',
        });
      }

      if (!entityType) {
        throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', {
          operation: 'get_project_pull_requests_weekly',
        });
      }

      // Validate entityType
      if (entityType !== 'foundation' && entityType !== 'project') {
        throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', {
          operation: 'get_project_pull_requests_weekly',
        });
      }

      const response = await this.projectService.getProjectPullRequestsWeekly(slug, entityType);

      Logger.success(req, 'get_project_pull_requests_weekly', startTime, {
        slug,
        entity_type: entityType,
        total_weeks: response.totalWeeks,
        total_merged_prs: response.totalMergedPRs,
        avg_merge_time: response.avgMergeTime,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_project_pull_requests_weekly', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/contributors-mentored
   * Get contributors mentored weekly data from Snowflake
   * Query params: slug (required) - Foundation slug for filtering
   */
  public async getContributorsMentored(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_contributors_mentored');

    try {
      const slug = req.query['slug'] as string | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_contributors_mentored',
        });
      }

      const response = await this.projectService.getContributorsMentored(slug);

      Logger.success(req, 'get_contributors_mentored', startTime, {
        slug,
        total_mentored: response.totalMentored,
        avg_weekly_new: response.avgWeeklyNew,
        total_weeks: response.totalWeeks,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_contributors_mentored', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/unique-contributors-weekly
   * Get unique contributors weekly data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getUniqueContributorsWeekly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_unique_contributors_weekly');

    try {
      const slug = req.query['slug'] as string | undefined;
      const entityType = req.query['entityType'] as 'foundation' | 'project' | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_unique_contributors_weekly',
        });
      }

      if (!entityType) {
        throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', {
          operation: 'get_unique_contributors_weekly',
        });
      }

      // Validate entityType
      if (entityType !== 'foundation' && entityType !== 'project') {
        throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', {
          operation: 'get_unique_contributors_weekly',
        });
      }

      const response = await this.projectService.getUniqueContributorsWeekly(slug, entityType);

      Logger.success(req, 'get_unique_contributors_weekly', startTime, {
        slug,
        entity_type: entityType,
        total_weeks: response.totalWeeks,
        total_unique: response.totalUniqueContributors,
        avg_unique: response.avgUniqueContributors,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_unique_contributors_weekly', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-total-projects
   * Get total projects count for a foundation from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationTotalProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_foundation_total_projects');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_total_projects',
        });
      }

      const response = await this.projectService.getFoundationTotalProjects(foundationSlug);

      Logger.success(req, 'get_foundation_total_projects', startTime, {
        foundation_slug: foundationSlug,
        total_projects: response.totalProjects,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_foundation_total_projects', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-total-members
   * Get total members count for a foundation from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationTotalMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_foundation_total_members');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_total_members',
        });
      }

      const response = await this.projectService.getFoundationTotalMembers(foundationSlug);

      Logger.success(req, 'get_foundation_total_members', startTime, {
        foundation_slug: foundationSlug,
        total_members: response.totalMembers,
        monthly_data_points: response.monthlyData.length,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_foundation_total_members', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-software-value
   * Get foundation software value and top projects from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationSoftwareValue(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_foundation_software_value');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_software_value',
        });
      }

      const response = await this.projectService.getFoundationSoftwareValue(foundationSlug);

      Logger.success(req, 'get_foundation_software_value', startTime, {
        foundation_slug: foundationSlug,
        total_value_millions: response.totalValue,
        top_projects_count: response.topProjects.length,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_foundation_software_value', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-maintainers
   * Get foundation maintainers data from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationMaintainers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_foundation_maintainers');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_maintainers',
        });
      }

      const response = await this.projectService.getFoundationMaintainers(foundationSlug);

      Logger.success(req, 'get_foundation_maintainers', startTime, {
        foundation_slug: foundationSlug,
        avg_maintainers: response.avgMaintainers,
        trend_data_points: response.trendData.length,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_foundation_maintainers', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/foundation-health-score-distribution
   * Get foundation health score distribution from Snowflake
   * Query params: foundationSlug (required)
   */
  public async getFoundationHealthScoreDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_foundation_health_score_distribution');

    try {
      const foundationSlug = req.query['foundationSlug'] as string | undefined;

      if (!foundationSlug) {
        throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', {
          operation: 'get_foundation_health_score_distribution',
        });
      }

      const response = await this.projectService.getFoundationHealthScoreDistribution(foundationSlug);

      const totalProjects = Object.values(response).reduce((sum, count) => sum + count, 0);

      Logger.success(req, 'get_foundation_health_score_distribution', startTime, {
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
      Logger.error(req, 'get_foundation_health_score_distribution', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/health-metrics-daily
   * Get health metrics daily data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getHealthMetricsDaily(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_health_metrics_daily');

    try {
      const slug = req.query['slug'] as string | undefined;
      const entityType = req.query['entityType'] as 'foundation' | 'project' | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_health_metrics_daily',
        });
      }

      if (!entityType) {
        throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', {
          operation: 'get_health_metrics_daily',
        });
      }

      // Validate entityType
      if (entityType !== 'foundation' && entityType !== 'project') {
        throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', {
          operation: 'get_health_metrics_daily',
        });
      }

      const response = await this.projectService.getHealthMetricsDaily(slug, entityType);

      Logger.success(req, 'get_health_metrics_daily', startTime, {
        slug,
        entity_type: entityType,
        total_days: response.totalDays,
        current_avg_health_score: response.currentAvgHealthScore,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_health_metrics_daily', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/unique-contributors-daily
   * Get unique contributors daily data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getUniqueContributorsDaily(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_unique_contributors_daily');

    try {
      const slug = req.query['slug'] as string | undefined;
      const entityType = req.query['entityType'] as 'foundation' | 'project' | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_unique_contributors_daily',
        });
      }

      if (!entityType) {
        throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', {
          operation: 'get_unique_contributors_daily',
        });
      }

      // Validate entityType
      if (entityType !== 'foundation' && entityType !== 'project') {
        throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', {
          operation: 'get_unique_contributors_daily',
        });
      }

      const response = await this.projectService.getUniqueContributorsDaily(slug, entityType);

      Logger.success(req, 'get_unique_contributors_daily', startTime, {
        slug,
        entity_type: entityType,
        total_days: response.totalDays,
        avg_contributors: response.avgContributors,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_unique_contributors_daily', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/health-events-monthly
   * Get health events monthly data from Snowflake
   * Query params: slug (required), entityType (required)
   */
  public async getHealthEventsMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_health_events_monthly');

    try {
      const slug = req.query['slug'] as string | undefined;
      const entityType = req.query['entityType'] as 'foundation' | 'project' | undefined;

      if (!slug) {
        throw ServiceValidationError.forField('slug', 'slug query parameter is required', {
          operation: 'get_health_events_monthly',
        });
      }

      if (!entityType) {
        throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', {
          operation: 'get_health_events_monthly',
        });
      }

      // Validate entityType
      if (entityType !== 'foundation' && entityType !== 'project') {
        throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', {
          operation: 'get_health_events_monthly',
        });
      }

      const response = await this.projectService.getHealthEventsMonthly(slug, entityType);

      Logger.success(req, 'get_health_events_monthly', startTime, {
        slug,
        entity_type: entityType,
        total_months: response.totalMonths,
        total_events: response.totalEvents,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_health_events_monthly', startTime, error);
      next(error);
    }
  }
}
