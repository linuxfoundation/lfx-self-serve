// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ActiveWeeksStreakResponse,
  ActiveWeeksStreakRow,
  ProjectItem,
  UserCodeCommitsResponse,
  UserCodeCommitsRow,
  UserProjectActivityRow,
  UserProjectsResponse,
  UserPullRequestsResponse,
  UserPullRequestsRow,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ResourceNotFoundError } from '../errors';
import { Logger } from '../helpers/logger';
import { SnowflakeService } from '../services/snowflake.service';

/**
 * Controller for handling analytics HTTP requests
 * Fetches analytics data from Snowflake for dashboard visualizations
 */
export class AnalyticsController {
  private snowflakeService: SnowflakeService | null = null;

  /**
   * GET /api/analytics/active-weeks-streak
   * Get active weeks streak data for the authenticated user
   */
  public async getActiveWeeksStreak(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_active_weeks_streak');

    try {
      // Get user email from authenticated session
      const userEmail = req.oidc?.user?.['email'];

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_active_weeks_streak',
        });
      }

      // Execute Snowflake query with parameterized email
      const query = `
        SELECT WEEKS_AGO, IS_ACTIVE
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.ACTIVE_WEEKS_STREAK
        WHERE EMAIL = ?
        ORDER BY WEEKS_AGO ASC
        LIMIT 52
      `;

      const result = await this.getSnowflakeService().execute<ActiveWeeksStreakRow>(query, [userEmail]);

      // If no data found for user, return 404
      if (result.rows.length === 0) {
        throw new ResourceNotFoundError('Active weeks streak data', userEmail, {
          operation: 'get_active_weeks_streak',
        });
      }

      // Calculate current streak (consecutive weeks of activity from week 0)
      // Data is ordered by WEEKS_AGO ASC, so index 0 is week 0 (current week)
      let currentStreak = 0;

      for (const row of result.rows) {
        if (row.IS_ACTIVE === 1) {
          currentStreak++;
        } else {
          break; // Stop at first inactive week
        }
      }

      // Build response
      const response: ActiveWeeksStreakResponse = {
        data: result.rows,
        currentStreak,
        totalWeeks: result.rows.length,
      };

      Logger.success(req, 'get_active_weeks_streak', startTime, {
        email: userEmail,
        total_weeks: result.rows.length,
        current_streak: currentStreak,
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
      // Get user email from authenticated session
      const userEmail = req.oidc?.user?.['email'];

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_pull_requests_merged',
        });
      }

      // Execute Snowflake query with parameterized email
      // Use window function to calculate total in SQL for accuracy
      // Filter for last 30 days of data
      const query = `
        SELECT
          ACTIVITY_DATE,
          DAILY_COUNT,
          SUM(DAILY_COUNT) OVER () as TOTAL_COUNT
        FROM ANALYTICS.PLATINUM_LFX_ONE.USER_PULL_REQUESTS
        WHERE EMAIL = ?
          AND ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
        ORDER BY ACTIVITY_DATE ASC
      `;

      const result = await this.getSnowflakeService().execute<UserPullRequestsRow>(query, [userEmail]);

      // If no data found for user, return 404
      if (result.rows.length === 0) {
        throw new ResourceNotFoundError('Pull requests data', userEmail, {
          operation: 'get_pull_requests_merged',
        });
      }

      // Get total from SQL calculation (same value on all rows from window function)
      const totalPullRequests = result.rows[0].TOTAL_COUNT;

      // Build response
      const response: UserPullRequestsResponse = {
        data: result.rows,
        totalPullRequests,
        totalDays: result.rows.length,
      };

      Logger.success(req, 'get_pull_requests_merged', startTime, {
        email: userEmail,
        total_days: result.rows.length,
        total_pull_requests: totalPullRequests,
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
      // Get user email from authenticated session
      const userEmail = req.oidc?.user?.['email'];

      if (!userEmail) {
        throw new AuthenticationError('User email not found in authentication context', {
          operation: 'get_code_commits',
        });
      }

      // Execute Snowflake query with parameterized email
      // Use window function to calculate total in SQL for accuracy
      // Filter for last 30 days of data
      const query = `
        SELECT
          ACTIVITY_DATE,
          DAILY_COUNT,
          SUM(DAILY_COUNT) OVER () as TOTAL_COUNT
        FROM ANALYTICS.PLATINUM_LFX_ONE.USER_CODE_COMMITS
        WHERE EMAIL = ?
          AND ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
        ORDER BY ACTIVITY_DATE ASC
      `;

      const result = await this.getSnowflakeService().execute<UserCodeCommitsRow>(query, [userEmail]);

      // If no data found for user, return 404
      if (result.rows.length === 0) {
        throw new ResourceNotFoundError('Code commits data', userEmail, {
          operation: 'get_code_commits',
        });
      }

      // Get total from SQL calculation (same value on all rows from window function)
      const totalCommits = result.rows[0].TOTAL_COUNT;

      // Build response
      const response: UserCodeCommitsResponse = {
        data: result.rows,
        totalCommits,
        totalDays: result.rows.length,
      };

      Logger.success(req, 'get_code_commits', startTime, {
        email: userEmail,
        total_days: result.rows.length,
        total_commits: totalCommits,
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
      // Get user email from authenticated session (commented for future implementation)
      // const userEmail = req.oidc?.user?.['email'];
      // if (!userEmail) {
      //   throw new AuthenticationError('User email not found in authentication context', {
      //     operation: 'get_my_projects',
      //   });
      // }

      // Parse pagination parameters
      const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query['limit'] as string, 10) || 10));
      const offset = (page - 1) * limit;

      // First, get total count of unique projects
      const countQuery = `
        SELECT COUNT(DISTINCT PROJECT_ID) as TOTAL_PROJECTS
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM.PROJECT_CODE_ACTIVITY
        WHERE ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
      `;

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const countResult = await this.getSnowflakeService().execute<{ TOTAL_PROJECTS: number }>(countQuery, []);
      const totalProjects = countResult.rows[0]?.TOTAL_PROJECTS || 0;

      // If no projects found, return empty response
      if (totalProjects === 0) {
        Logger.success(req, 'get_my_projects', startTime, {
          page,
          limit,
          total_projects: 0,
        });

        res.json({
          data: [],
          totalProjects: 0,
        });
        return;
      }

      // Get paginated projects with all their activity data
      // Use CTE to first get paginated project list, then join for activity data
      const query = `
        WITH PaginatedProjects AS (
          SELECT DISTINCT PROJECT_ID, PROJECT_NAME, PROJECT_SLUG
          FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM.PROJECT_CODE_ACTIVITY
          WHERE ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
          ORDER BY PROJECT_NAME, PROJECT_ID
          LIMIT ? OFFSET ?
        )
        SELECT
          p.PROJECT_ID,
          p.PROJECT_NAME,
          p.PROJECT_SLUG,
          a.ACTIVITY_DATE,
          a.DAILY_TOTAL_ACTIVITIES,
          a.DAILY_CODE_ACTIVITIES,
          a.DAILY_NON_CODE_ACTIVITIES
        FROM PaginatedProjects p
        JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM.PROJECT_CODE_ACTIVITY a
          ON p.PROJECT_ID = a.PROJECT_ID
        WHERE a.ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
        ORDER BY p.PROJECT_NAME, p.PROJECT_ID, a.ACTIVITY_DATE ASC
      `;

      const result = await this.getSnowflakeService().execute<UserProjectActivityRow>(query, [limit, offset]);

      // Group rows by PROJECT_ID and transform into ProjectItem[]
      const projectsMap = new Map<string, ProjectItem>();

      for (const row of result.rows) {
        if (!projectsMap.has(row.PROJECT_ID)) {
          // Initialize new project with placeholder values
          projectsMap.set(row.PROJECT_ID, {
            name: row.PROJECT_NAME,
            logo: undefined, // Component will show default icon
            role: 'Member', // Placeholder
            affiliations: [], // Placeholder
            codeActivities: [],
            nonCodeActivities: [],
            status: 'active', // Placeholder
          });
        }

        // Add daily activity values to arrays
        const project = projectsMap.get(row.PROJECT_ID)!;
        project.codeActivities.push(row.DAILY_CODE_ACTIVITIES);
        project.nonCodeActivities.push(row.DAILY_NON_CODE_ACTIVITIES);
      }

      // Convert map to array
      const projects = Array.from(projectsMap.values());

      // Build response
      const response: UserProjectsResponse = {
        data: projects,
        totalProjects,
      };

      Logger.success(req, 'get_my_projects', startTime, {
        page,
        limit,
        returned_projects: projects.length,
        total_projects: totalProjects,
      });

      res.json(response);
    } catch (error) {
      Logger.error(req, 'get_my_projects', startTime, error);
      next(error);
    }
  }

  /**
   * Lazy initialization of SnowflakeService
   * Ensures serverLogger is fully initialized before creating the service
   */
  private getSnowflakeService(): SnowflakeService {
    if (!this.snowflakeService) {
      this.snowflakeService = new SnowflakeService();
    }
    return this.snowflakeService;
  }
}
