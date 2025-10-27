// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectItem } from './components.interface';

/**
 * Active Weeks Streak row from Snowflake ACTIVE_WEEKS_STREAK table
 * Represents a single week's activity data for a user
 */
export interface ActiveWeeksStreakRow {
  /**
   * Number of weeks ago from current date (0 = current week, 1 = last week, etc.)
   */
  WEEKS_AGO: number;

  /**
   * Whether the user was active during this week (1 = active, 0 = inactive)
   */
  IS_ACTIVE: number;
}

/**
 * API response for Active Weeks Streak query
 */
export interface ActiveWeeksStreakResponse {
  /**
   * Array of weekly activity data
   */
  data: ActiveWeeksStreakRow[];

  /**
   * Current active streak count (consecutive weeks)
   */
  currentStreak: number;

  /**
   * Total number of weeks with data
   */
  totalWeeks: number;
}

/**
 * User Pull Requests row from Snowflake USER_PULL_REQUESTS table
 * Represents daily pull request activity
 */
export interface UserPullRequestsRow {
  /**
   * Date of the activity (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Number of pull requests merged on this date
   */
  DAILY_COUNT: number;

  /**
   * Total count across all dates (from SQL window function)
   */
  TOTAL_COUNT: number;
}

/**
 * API response for User Pull Requests query
 */
export interface UserPullRequestsResponse {
  /**
   * Array of daily pull request activity data
   */
  data: UserPullRequestsRow[];

  /**
   * Total pull requests merged across all dates
   */
  totalPullRequests: number;

  /**
   * Number of days with data
   */
  totalDays: number;
}

/**
 * User Code Commits row from Snowflake USER_CODE_COMMITS table
 * Represents daily code commit activity
 */
export interface UserCodeCommitsRow {
  /**
   * Date of the activity (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Number of commits on this date
   */
  DAILY_COUNT: number;

  /**
   * Total count across all dates (from SQL window function)
   */
  TOTAL_COUNT: number;
}

/**
 * API response for User Code Commits query
 */
export interface UserCodeCommitsResponse {
  /**
   * Array of daily code commit activity data
   */
  data: UserCodeCommitsRow[];

  /**
   * Total commits across all dates
   */
  totalCommits: number;

  /**
   * Number of days with data
   */
  totalDays: number;
}

/**
 * User Project Activity row from Snowflake PROJECT_CODE_ACTIVITY table
 * Represents daily project activity data
 */
export interface UserProjectActivityRow {
  /**
   * Project unique identifier
   */
  PROJECT_ID: string;

  /**
   * Project display name
   */
  PROJECT_NAME: string;

  /**
   * Project URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Date of the activity (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Total activities (code + non-code) for this date
   */
  DAILY_TOTAL_ACTIVITIES: number;

  /**
   * Code-related activities for this date
   */
  DAILY_CODE_ACTIVITIES: number;

  /**
   * Non-code-related activities for this date
   */
  DAILY_NON_CODE_ACTIVITIES: number;
}

/**
 * API response for User Projects query
 */
export interface UserProjectsResponse {
  /**
   * Array of projects with activity data
   */
  data: ProjectItem[];

  /**
   * Total number of projects
   */
  totalProjects: number;
}
