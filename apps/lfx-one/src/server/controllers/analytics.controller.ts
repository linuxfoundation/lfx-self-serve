// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ActiveWeeksStreakResponse,
  ActiveWeeksStreakRow,
  UserCodeCommitsResponse,
  UserCodeCommitsRow,
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
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.USER_PULL_REQUESTS
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
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.USER_CODE_COMMITS
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
