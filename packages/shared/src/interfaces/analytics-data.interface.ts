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
 * API response for Organization Maintainers query
 * Provides organization-level maintainer and project statistics
 */
export interface OrganizationMaintainersResponse {
  /**
   * Total number of distinct maintainers in the organization
   */
  maintainers: number;

  /**
   * Total number of distinct projects with maintainers
   */
  projects: number;

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;
}

/**
 * API response for Membership Tier query
 * Provides organization membership details including tier, dates, and pricing
 */
export interface MembershipTierResponse {
  /**
   * Membership tier level (e.g., "Platinum", "Gold", "Silver")
   */
  tier: string;

  /**
   * Start date of current membership period (YYYY-MM-DD format)
   */
  membershipStartDate: string;

  /**
   * End date of current membership period (YYYY-MM-DD format)
   */
  membershipEndDate: string;

  /**
   * Annual membership price in dollars
   */
  membershipPrice: number;

  /**
   * Membership status (e.g., "Active", "Pending", "Expired")
   */
  membershipStatus: string;

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;
}

/**
 * API response for Organization Contributors query
 * Provides total count of active contributors for the organization
 */
export interface OrganizationContributorsResponse {
  /**
   * Total number of active contributors in the organization
   */
  contributors: number;

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;

  /**
   * Organization/account name
   */
  accountName: string;

  /**
   * Total number of projects with contributors
   */
  projects: number;
}

/**
 * Snowflake row from MEMBER_DASHBOARD_MAINTAINERS query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface MemberDashboardMaintainersRow {
  MAINTAINERS: number;
  PROJECTS: number;
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
}

/**
 * Snowflake row from MEMBER_DASHBOARD_MEMBERSHIP_TIER query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface MembershipTierRow {
  PROJECT_ID: string;
  PROJECT_NAME: string;
  IS_PROJECT_ACTIVE: boolean;
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  MEMBERSHIP_TIER: string;
  MEMBERSHIP_PRICE: number;
  CURRENT_MEMBERSHIP_START_DATE: string;
  CURRENT_MEMBERSHIP_END_DATE: string;
  RENEWAL_PRICE: number;
  MEMBERSHIP_STATUS: string;
}

/**
 * Snowflake row from MEMBER_DASHBOARD_CONTRIBUTORS query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface OrganizationContributorsRow {
  CONTRIBUTORS: number;
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  PROJECTS: number;
}

/**
 * Snowflake row from project count query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface ProjectCountRow {
  TOTAL_PROJECTS: number;
}

/**
 * Snowflake row from MEMBER_DASHBOARD_EVENT_ATTENDANCE query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface MemberDashboardEventAttendanceRow {
  EVENT_NAME: string;
  EVENT_END_DATE: string;
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  ATTENDEES: number;
  SPEAKERS: number;
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
 * API response for Organization Event Attendance query
 * Provides aggregated event attendance statistics
 */
export interface OrganizationEventAttendanceResponse {
  /**
   * Total number of event attendees across all events
   */
  totalAttendees: number;

  /**
   * Total number of speakers across all events
   */
  totalSpeakers: number;

  /**
   * Total number of events with participation
   */
  totalEvents: number;

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
 * Snowflake row from TECHNICAL_COMMITTEE_MEMBER_COUNT query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface TechnicalCommitteeMemberCountRow {
  PROJECT_ID: string;
  ACCOUNT_ID: string;
  COUNT: number;
}

/**
 * Snowflake aggregated row from TECHNICAL_COMMITTEE_MEMBER_COUNT query
 * Raw response with Snowflake naming conventions (ALL_CAPS) for aggregated sum
 */
export interface OrganizationTechnicalCommitteeRow {
  TOTAL_REPRESENTATIVES: number;
  TOTAL_PROJECTS: number;
  ACCOUNT_ID: string;
}

/**
 * API response for Organization Technical Committee Participation query
 * Provides total count of TOC/TSC/TAG representatives
 */
export interface OrganizationTechnicalCommitteeResponse {
  /**
   * Total number of technical committee representatives across all projects
   */
  totalRepresentatives: number;

  /**
   * Total number of projects with technical committee participation
   */
  totalProjects: number;

  /**
   * Salesforce account ID for the organization
   */
  accountId: string;
}
