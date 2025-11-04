// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ANALYTICS_DEFAULTS } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { Logger } from '../helpers/logger';
import { OrganizationService } from '../services/organization.service';
import { UserService } from '../services/user.service';

/**
 * Controller for handling analytics HTTP requests
 * Routes requests to appropriate domain services
 *
 * Generated with [Claude Code](https://claude.ai/code)
 */
export class AnalyticsController {
  private userService: UserService;
  private organizationService: OrganizationService;

  public constructor() {
    this.userService = new UserService();
    this.organizationService = new OrganizationService();
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
        email: userEmail,
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
        email: userEmail,
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
        email: userEmail,
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
   * GET /api/analytics/organization-contributions-overview
   * Get consolidated organization contributions data (maintainers + contributors + technical committee) in a single request
   * Optimized endpoint that executes a single database query for all three metrics
   * Query params: accountId (optional) - Organization account ID
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public async getOrganizationContributionsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_organization_contributions_overview');

    try {
      const accountId = (req.query['accountId'] as string) || ANALYTICS_DEFAULTS.ACCOUNT_ID;

      // Single database query for all three metrics (maintainers + contributors + technical committee)
      const response = await this.organizationService.getContributionsOverview(accountId);

      Logger.success(req, 'get_organization_contributions_overview', startTime, {
        account_id: accountId,
        maintainers: response.maintainers.maintainers,
        contributors: response.contributors.contributors,
        technical_committee_representatives: response.technicalCommittee.totalRepresentatives,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_organization_contributions_overview', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-segment-overview
   * Get consolidated organization segment data (projects participating + total commits) in a single request
   * Optimized endpoint that executes a single database query for both metrics
   * Query params: accountId (optional) - Organization account ID
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public async getOrganizationSegmentOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_organization_segment_overview');

    try {
      const accountId = (req.query['accountId'] as string) || ANALYTICS_DEFAULTS.ACCOUNT_ID;
      const segmentId = ANALYTICS_DEFAULTS.SEGMENT_ID;

      // Single database query for both metrics (projects participating + total commits)
      const response = await this.organizationService.getSegmentOverview(accountId, segmentId);

      Logger.success(req, 'get_organization_segment_overview', startTime, {
        account_id: accountId,
        segment_id: segmentId,
        projects_participating: response.projectsParticipating,
        total_commits: response.totalCommits,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_organization_segment_overview', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/board-member-dashboard
   * Get consolidated board member dashboard data (membership tier + certified employees + board meeting attendance)
   * Optimized endpoint that executes a single database query for all three metrics
   * Query params: accountId (optional) - Organization account ID
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public async getBoardMemberDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_board_member_dashboard');

    try {
      const accountId = (req.query['accountId'] as string) || ANALYTICS_DEFAULTS.ACCOUNT_ID;
      const projectId = ANALYTICS_DEFAULTS.PROJECT_ID;

      // Single database query for all three metrics (membership tier + certified employees + board meeting attendance)
      const response = await this.organizationService.getBoardMemberDashboardData(accountId, projectId);

      Logger.success(req, 'get_board_member_dashboard', startTime, {
        account_id: accountId,
        project_id: projectId,
        tier: response.membershipTier.tier,
        certifications: response.certifiedEmployees.certifications,
        attendance_percentage: response.boardMeetingAttendance.attendancePercentage,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_board_member_dashboard', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/analytics/organization-events-overview
   * Get consolidated organization events data (event attendance + event sponsorships) in a single request
   * Uses parallel database queries (two different tables) for optimal performance
   * Query params: accountId (optional) - Organization account ID
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public async getOrganizationEventsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_organization_events_overview');

    try {
      const accountId = (req.query['accountId'] as string) || ANALYTICS_DEFAULTS.ACCOUNT_ID;
      const projectId = ANALYTICS_DEFAULTS.PROJECT_ID;

      // Parallel database queries for event metrics (two different tables)
      const response = await this.organizationService.getEventsOverview(accountId, projectId);

      Logger.success(req, 'get_organization_events_overview', startTime, {
        account_id: accountId,
        project_id: projectId,
        total_attendees: response.eventAttendance.totalAttendees,
        total_speakers: response.eventAttendance.totalSpeakers,
        sponsored_events: response.eventSponsorships.totalEvents,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_organization_events_overview', startTime, error);
      next(error);
    }
  }
}
