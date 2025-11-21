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
 * Consolidated Snowflake response joining membership tier and certified employees
 * Uses LEFT JOINs to handle partial data scenarios with nullable fields
 * All fields from joined tables are nullable to support flexible NULL handling
 */
export interface BoardMemberDashboardConsolidatedRow {
  // Membership Tier fields
  MEMBERSHIP_TIER: string | null;
  START_DATE: string | null;
  LAST_END_DATE: string | null;
  MEMBERSHIP_STATUS: string | null;

  // Certified Employees fields
  CERTIFICATIONS: number | null;
  CERTIFIED_EMPLOYEES: number | null;

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
 * Combines membership tier and certified employees in a single response
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
   * Salesforce account ID for the organization
   */
  accountId: string;

  /**
   * Project unique identifier
   */
  uid: string;
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
}

/**
 * Snowflake aggregated response from MEMBER_DASHBOARD_EVENT_SPONSORSHIPS query (per currency)
 * Contains calculated totals via SQL aggregation grouped by currency
 * Includes window function for total event count (repeated across rows)
 */
export interface OrganizationEventSponsorshipsAggregateRow {
  /**
   * Total sponsorship amount for this currency (SUM of PRICE)
   */
  TOTAL_AMOUNT: number;

  /**
   * Currency code for this row (e.g., USD, INR, EUR)
   */
  CURRENCY_CODE: string;

  /**
   * Salesforce account ID for the organization
   */
  ACCOUNT_ID: string;

  /**
   * Total number of distinct events sponsored (across all currencies)
   * Computed via window function, repeated in each row
   */
  TOTAL_EVENTS: number;
}

/**
 * Currency-specific sponsorship summary
 */
export interface CurrencySummary {
  /**
   * Total amount in this currency
   */
  amount: number;

  /**
   * Currency code (e.g., USD, INR, EUR)
   */
  currencyCode: string;
}

/**
 * Snowflake row from projects dimension table
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface ProjectRow {
  /**
   * Project unique identifier
   */
  PROJECT_ID: string;

  /**
   * Project display name
   */
  NAME: string;

  /**
   * Project URL slug
   */
  SLUG: string;
}

/**
 * API response for projects list query
 */
export interface ProjectsListResponse {
  /**
   * Array of projects
   */
  projects: {
    uid: string;
    name: string;
    slug: string;
  }[];
}

/**
 * Snowflake row from project issues resolution daily query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface ProjectIssuesResolutionRow {
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
   * Date of the metric (YYYY-MM-DD format)
   */
  METRIC_DATE: string;

  /**
   * Number of issues opened on this date
   */
  OPENED_ISSUES_COUNT: number;

  /**
   * Number of issues closed on this date
   */
  CLOSED_ISSUES_COUNT: number;
}

/**
 * Snowflake row from project issues resolution aggregated query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface ProjectIssuesResolutionAggregatedRow {
  /**
   * Total number of issues opened
   */
  OPENED_ISSUES: number;

  /**
   * Total number of issues closed
   */
  CLOSED_ISSUES: number;

  /**
   * Resolution rate as a percentage
   */
  RESOLUTION_RATE_PCT: number;

  /**
   * Median number of days to close an issue
   */
  MEDIAN_DAYS_TO_CLOSE: number;
}

/**
 * API response for project issues resolution query
 */
export interface ProjectIssuesResolutionResponse {
  /**
   * Array of daily issue resolution data
   */
  data: ProjectIssuesResolutionRow[];

  /**
   * Total opened issues across all dates
   */
  totalOpenedIssues: number;

  /**
   * Total closed issues across all dates
   */
  totalClosedIssues: number;

  /**
   * Resolution rate as a percentage from database
   */
  resolutionRatePct: number;

  /**
   * Median days to close an issue
   */
  medianDaysToClose: number;

  /**
   * Number of days with data
   */
  totalDays: number;
}

/**
 * Snowflake row from project pull requests weekly query
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface ProjectPullRequestsWeeklyRow {
  /**
   * Week start date (YYYY-MM-DD format)
   */
  WEEK_START_DATE: string;

  /**
   * Number of PRs merged during this week
   */
  MERGED_PR_COUNT: number;

  /**
   * Average time to merge in days
   */
  AVG_MERGED_IN_DAYS: number;

  /**
   * Average number of reviewers per PR
   */
  AVG_REVIEWERS_PER_PR: number;

  /**
   * Number of pending PRs at the end of the week
   */
  PENDING_PR_COUNT: number;
}

/**
 * API response for project pull requests weekly query
 */
export interface ProjectPullRequestsWeeklyResponse {
  /**
   * Array of weekly PR data
   */
  data: ProjectPullRequestsWeeklyRow[];

  /**
   * Total PRs merged across all weeks
   */
  totalMergedPRs: number;

  /**
   * Average merge time across all weeks (in days)
   */
  avgMergeTime: number;

  /**
   * Number of weeks with data
   */
  totalWeeks: number;
}

/**
 * Contributors Mentored row from Snowflake FOUNDATION_CONTRIBUTORS_MENTORED_WEEKLY table
 * Represents weekly mentorship activity data
 */
export interface FoundationContributorsMentoredRow {
  /**
   * Week start date (YYYY-MM-DD)
   */
  WEEK_START_DATE: string;

  /**
   * Foundation identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation slug for filtering
   */
  FOUNDATION_SLUG: string;

  /**
   * New contributors mentored that week
   */
  WEEKLY_MENTORED_CONTRIBUTOR_COUNT: number;

  /**
   * Cumulative total of contributors mentored
   */
  MENTORED_CONTRIBUTOR_COUNT: number;
}

/**
 * API response for Contributors Mentored query
 * Contains weekly mentorship data with aggregated metrics
 */
export interface FoundationContributorsMentoredResponse {
  /**
   * Array of weekly mentorship data
   */
  data: FoundationContributorsMentoredRow[];

  /**
   * Latest cumulative count of mentored contributors
   */
  totalMentored: number;

  /**
   * Average new contributors mentored per week
   */
  avgWeeklyNew: number;

  /**
   * Number of weeks with data
   */
  totalWeeks: number;
}

/**
 * Unique contributors weekly row from Snowflake
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface UniqueContributorsWeeklyRow {
  /**
   * Foundation or Project ID
   */
  FOUNDATION_ID?: string;
  PROJECT_ID?: string;

  /**
   * Foundation or Project Name
   */
  FOUNDATION_NAME?: string;
  PROJECT_NAME?: string;

  /**
   * Foundation or Project Slug
   */
  FOUNDATION_SLUG?: string;
  PROJECT_SLUG?: string;

  /**
   * Week start date (YYYY-MM-DD format)
   */
  WEEK_START_DATE: string;

  /**
   * Number of unique contributors in this week
   */
  UNIQUE_CONTRIBUTORS: number;

  /**
   * Total active contributors (including repeat contributors)
   */
  TOTAL_ACTIVE_CONTRIBUTORS: number;

  /**
   * Number of new contributors (first contribution)
   */
  NEW_CONTRIBUTORS: number;

  /**
   * Number of returning contributors
   */
  RETURNING_CONTRIBUTORS: number;
}

/**
 * Response from unique contributors weekly endpoint
 * Includes weekly data and aggregated metrics
 */
export interface UniqueContributorsWeeklyResponse {
  /**
   * Weekly contributor data (raw Snowflake rows)
   */
  data: UniqueContributorsWeeklyRow[];

  /**
   * Total unique contributors across all weeks
   */
  totalUniqueContributors: number;

  /**
   * Average unique contributors per week
   */
  avgUniqueContributors: number;

  /**
   * Total number of weeks with data
   */
  totalWeeks: number;
}
