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

/**
 * Snowflake row from project count query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface ProjectCountRow {
  TOTAL_PROJECTS: number;
}

/**
 * Snowflake aggregated row from MEMBER_DASHBOARD_EVENT_ATTENDANCE query
 * Raw response with Snowflake naming conventions (ALL_CAPS) for aggregated sums
 */
export interface OrganizationEventAttendanceRow {
  TOTAL_ATTENDEES: number;
  TOTAL_SPEAKERS: number;
  TOTAL_EVENTS: number;
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
}

/**
 * Consolidated Snowflake response joining membership tier, certified employees, and board meeting attendance
 * Uses LEFT JOINs to handle partial data scenarios with nullable fields
 * All fields from joined tables are nullable to support flexible NULL handling
 */
export interface BoardMemberDashboardConsolidatedRow {
  // Membership Tier fields
  MEMBERSHIP_TIER: string | null;
  CURRENT_MEMBERSHIP_START_DATE: string | null;
  CURRENT_MEMBERSHIP_END_DATE: string | null;
  MEMBERSHIP_STATUS: string | null;

  // Certified Employees fields
  CERTIFICATIONS: number | null;
  CERTIFIED_EMPLOYEES: number | null;

  // Board Meeting Attendance fields
  TOTAL_MEETINGS: number | null;
  ATTENDED_MEETINGS: number | null;
  NOT_ATTENDED_MEETINGS: number | null;
  ATTENDANCE_PERCENTAGE: number | null;

  // Common fields
  ACCOUNT_ID: string;
  PROJECT_ID: string;
}

/**
 * Consolidated Snowflake response joining organization-level contributions (maintainers + contributors)
 * Uses LEFT JOIN to combine data from maintainers and contributors tables
 * Nullable fields support partial data scenarios
 */
export interface OrganizationContributionsConsolidatedRow {
  // Maintainers fields
  MAINTAINERS: number | null;
  MAINTAINER_PROJECTS: number | null;

  // Contributors fields
  CONTRIBUTORS: number | null;
  CONTRIBUTOR_PROJECTS: number | null;

  // Technical Committee fields
  TOTAL_REPRESENTATIVES: number | null;
  TOTAL_TC_PROJECTS: number | null;

  // Common fields
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
}

/**
 * Consolidated API response for organization contributions overview
 * Combines maintainers, contributors, and technical committee data in a single response
 */
export interface OrganizationContributionsOverviewResponse {
  /**
   * Maintainer statistics
   */
  maintainers: {
    maintainers: number;
    projects: number;
  };

  /**
   * Contributor statistics
   */
  contributors: {
    contributors: number;
    projects: number;
  };

  /**
   * Technical Committee statistics (TOC/TSC/TAG)
   */
  technicalCommittee: {
    totalRepresentatives: number;
    totalProjects: number;
  };

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;

  /**
   * Organization/account name
   */
  accountName: string;
}

/**
 * Consolidated API response for board member dashboard
 * Combines membership tier, certified employees, and board meeting attendance in a single response
 */
export interface BoardMemberDashboardResponse {
  /**
   * Membership tier information
   */
  membershipTier: {
    tier: string;
    membershipStartDate: string;
    membershipEndDate: string;
    membershipStatus: string;
  };

  /**
   * Certified employees information
   */
  certifiedEmployees: {
    certifications: number;
    certifiedEmployees: number;
  };

  /**
   * Board meeting attendance information
   */
  boardMeetingAttendance: {
    totalMeetings: number;
    attendedMeetings: number;
    notAttendedMeetings: number;
    attendancePercentage: number;
  };

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;

  /**
   * Project ID
   */
  projectId: string;
}

/**
 * Consolidated API response for organization events overview
 * Contains event attendance data including attendees and speakers
 *
 * Generated with [Claude Code](https://claude.ai/code)
 */
export interface OrganizationEventsOverviewResponse {
  /**
   * Event attendance information
   */
  eventAttendance: {
    totalAttendees: number;
    totalSpeakers: number;
    totalEvents: number;
    accountName: string;
  };

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;

  /**
   * Project ID (used for sponsorships filtering)
   */
  projectId: string;
}
