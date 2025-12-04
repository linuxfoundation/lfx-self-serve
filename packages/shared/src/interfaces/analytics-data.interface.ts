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
 * User Project Contribution row from Snowflake USER_PROJECT_CONTRIBUTIONS_DAILY table
 * Represents daily contribution activity for a user's projects
 */
export interface UserProjectContributionRow {
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
   * Project logo URL
   */
  PROJECT_LOGO: string | null;

  /**
   * Date of the activity (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Whether the user is a maintainer of this project
   */
  IS_MAINTAINER: boolean;

  /**
   * User's affiliation/organization name
   */
  AFFILIATION: string | null;

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
 * Organization Event Attendance Monthly row from Snowflake
 * Raw response from FOUNDATION_EVENT_ATTENDANCE_ORG_MONTHLY table
 * Contains monthly event attendance metrics for board member dashboard charts
 */
export interface OrganizationEventAttendanceMonthlyRow {
  /**
   * Foundation unique identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation display name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Organization account ID (Salesforce)
   */
  ACCOUNT_ID: string;

  /**
   * Organization account name
   */
  ACCOUNT_NAME: string;

  /**
   * Month start date (first day of month) - returned as Date object from Snowflake
   */
  MONTH_START_DATE: Date;

  /**
   * Number of event registrations for this month
   */
  REGISTRATION_COUNT: number;

  /**
   * Number of attendees for this month
   */
  ATTENDED_COUNT: number;

  /**
   * Number of speakers for this month
   */
  SPEAKER_COUNT: number;

  /**
   * Total registrations (aggregated yearly)
   */
  TOTAL_REGISTRATIONS: number;

  /**
   * Total attendees (aggregated yearly)
   */
  TOTAL_ATTENDED: number;

  /**
   * Total speakers (aggregated yearly)
   */
  TOTAL_SPEAKERS: number;

  /**
   * Cumulative attendees up to this month (calculated via SQL window function)
   */
  CUMULATIVE_ATTENDED: number;

  /**
   * Cumulative speakers up to this month (calculated via SQL window function)
   */
  CUMULATIVE_SPEAKERS: number;
}

/**
 * API response for Organization Event Attendance Monthly query
 * Contains event attendance data for an organization with monthly trend data
 */
export interface OrganizationEventAttendanceMonthlyResponse {
  /**
   * Total attendees from the organization (yearly total from TOTAL_ATTENDED)
   */
  totalAttended: number;

  /**
   * Total speakers from the organization (yearly total from TOTAL_SPEAKERS)
   */
  totalSpeakers: number;

  /**
   * Organization account ID
   */
  accountId: string;

  /**
   * Organization account name
   */
  accountName: string;

  /**
   * Monthly cumulative attendee count data for trend visualization
   * Array of cumulative attendee counts (oldest to newest)
   */
  attendeesMonthlyData: number[];

  /**
   * Monthly cumulative speaker count data for trend visualization
   * Array of cumulative speaker counts (oldest to newest)
   */
  speakersMonthlyData: number[];

  /**
   * Month labels for chart visualization
   * Array of month strings (e.g., ['Jan 2024', 'Feb 2024']) matching monthlyData
   */
  monthlyLabels: string[];
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

/**
 * Monthly project count with foundation metadata
 * Combined result from cumulative aggregation query
 */
export interface MonthlyProjectCountWithFoundation {
  /**
   * Foundation segment ID
   */
  FOUNDATION_SEGMENT_ID: string;

  /**
   * Foundation name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation source ID from Salesforce
   */
  FOUNDATION_SOURCE_ID: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Month start date (first day of month)
   */
  MONTH_START: string;

  /**
   * Cumulative count of projects up to this month
   */
  PROJECT_COUNT: number;
}

/**
 * Monthly member count with foundation metadata
 * Combined result from cumulative aggregation query for member organizations
 * Uses actual MEMBER_DASHBOARD_MEMBERSHIP_TIER column names
 */
export interface MonthlyMemberCountWithFoundation {
  /**
   * Project/Foundation ID
   */
  PROJECT_ID: string;

  /**
   * Project/Foundation name
   */
  PROJECT_NAME: string;

  /**
   * Project/Foundation URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Month start date (first day of month)
   */
  MONTH_START: string;

  /**
   * Cumulative count of member organizations up to this month
   */
  MEMBER_COUNT: number;
}

/**
 * API response for foundation total projects query
 * Contains cumulative monthly trend data
 * Optimized response without full project list for better performance
 */
export interface FoundationTotalProjectsResponse {
  /**
   * Total number of distinct child projects (latest cumulative count)
   */
  totalProjects: number;

  /**
   * Monthly cumulative project count data for trend visualization
   * Array of cumulative counts (oldest to newest)
   */
  monthlyData: number[];

  /**
   * Month labels for chart visualization
   * Array of month strings (e.g., ['Jan 2020', 'Feb 2020']) matching monthlyData
   */
  monthlyLabels: string[];
}

/**
 * API response for foundation total members query
 * Contains cumulative monthly trend data for member organizations
 * Optimized response with aggregated member counts over time
 */
export interface FoundationTotalMembersResponse {
  /**
   * Total number of distinct member organizations (latest cumulative count)
   */
  totalMembers: number;

  /**
   * Monthly cumulative member count data for trend visualization
   * Array of cumulative counts (oldest to newest)
   */
  monthlyData: number[];

  /**
   * Month labels for chart visualization
   * Array of month strings (e.g., ['Jan 2020', 'Feb 2020']) matching monthlyData
   */
  monthlyLabels: string[];
}

/**
 * Foundation top project by software value row from Snowflake
 * Raw response from FOUNDATION_TOP_PROJECTS_BY_SOFTWARE_VALUE table
 */
export interface FoundationTopProjectBySoftwareValueRow {
  /**
   * Foundation ID
   */
  FOUNDATION_ID: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Project ID
   */
  PROJECT_ID: string;

  /**
   * Project name
   */
  PROJECT_NAME: string;

  /**
   * Project URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Estimated software value in dollars
   */
  SOFTWARE_VALUE: number;

  /**
   * Date of last metric calculation
   */
  LAST_METRIC_DATE: string;

  /**
   * Rank by value (1 = highest)
   */
  VALUE_RANK: number;
}

/**
 * API response for foundation software value query
 * Contains total software value and top projects by value
 */
export interface FoundationSoftwareValueResponse {
  /**
   * Total estimated software value in millions of dollars
   */
  totalValue: number;

  /**
   * Top projects by software value
   * Values converted to millions
   */
  topProjects: {
    name: string;
    value: number;
  }[];
}

/**
 * Foundation maintainers daily row from Snowflake
 * Raw response from FOUNDATION_MAINTAINERS_YEARLY table (despite name, contains daily data)
 */
export interface FoundationMaintainersDailyRow {
  /**
   * Foundation ID
   */
  FOUNDATION_ID: string;

  /**
   * Foundation name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Metric date (daily granularity)
   */
  METRIC_DATE: string;

  /**
   * Number of active maintainers on this date
   */
  ACTIVE_MAINTAINERS: number;

  /**
   * Average maintainers yearly (calculated aggregate)
   */
  AVG_MAINTAINERS_YEARLY: number;
}

/**
 * Weekly aggregated maintainers result from Snowflake query
 */
export interface WeeklyMaintainersRow {
  /**
   * Week start date
   */
  WEEK_START: string;

  /**
   * Average maintainers for this week
   */
  AVG_WEEKLY_MAINTAINERS: number;

  /**
   * Average maintainers yearly (same across all rows)
   */
  AVG_MAINTAINERS_YEARLY: number;
}

/**
 * API response for foundation maintainers query
 * Contains average maintainers and weekly trend data
 */
export interface FoundationMaintainersResponse {
  /**
   * Average number of maintainers (from AVG_MAINTAINERS_YEARLY)
   */
  avgMaintainers: number;

  /**
   * Daily or aggregated maintainer count data for trend visualization
   */
  trendData: number[];

  /**
   * Date labels for chart visualization
   * Array of date strings matching trendData
   */
  trendLabels: string[];
}

/**
 * Foundation health score distribution row from Snowflake
 * Raw response from FOUNDATION_HEALTH_SCORE_DISTRIBUTION table
 */
export interface FoundationHealthScoreDistributionRow {
  /**
   * Foundation ID
   */
  FOUNDATION_ID: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Health score category (Excellent, Healthy, Stable, Unsteady, Critical)
   */
  HEALTH_SCORE_CATEGORY: string;

  /**
   * Number of projects in this category
   */
  PROJECT_COUNT: number;
}

/**
 * API response for foundation health score distribution query
 * Contains project count breakdown by health category
 */
export interface FoundationHealthScoreDistributionResponse {
  /**
   * Number of projects with excellent health
   */
  excellent: number;

  /**
   * Number of projects with healthy status
   */
  healthy: number;

  /**
   * Number of projects with stable status
   */
  stable: number;

  /**
   * Number of projects with unsteady status
   */
  unsteady: number;

  /**
   * Number of projects with critical status
   */
  critical: number;
}

/**
 * Foundation health metrics daily row from Snowflake
 * Raw response from FOUNDATION_HEALTH_METRICS_DAILY table
 */
export interface FoundationHealthMetricsDailyRow {
  /**
   * Foundation ID
   */
  FOUNDATION_ID: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Metric date (YYYY-MM-DD format)
   */
  METRIC_DATE: string;

  /**
   * Average health score across all projects
   */
  AVG_HEALTH_SCORE: number;

  /**
   * Minimum health score among projects
   */
  MIN_HEALTH_SCORE: number;

  /**
   * Maximum health score among projects
   */
  MAX_HEALTH_SCORE: number;

  /**
   * Count of projects with health score data
   */
  PROJECTS_WITH_HEALTH_SCORE_COUNT: number;

  /**
   * Total software value in dollars
   */
  TOTAL_SOFTWARE_VALUE: number;

  /**
   * Average software value per project
   */
  AVG_SOFTWARE_VALUE: number;

  /**
   * Count of projects with software value data
   */
  PROJECTS_WITH_SOFTWARE_VALUE_COUNT: number;

  /**
   * Total projects count (for foundation level)
   */
  TOTAL_PROJECTS_COUNT?: number;

  /**
   * Total sub-projects count (for project level)
   */
  TOTAL_SUB_PROJECTS_COUNT?: number;
}

/**
 * Project health metrics daily row from Snowflake
 * Raw response from PROJECT_HEALTH_METRICS_DAILY table
 */
export interface ProjectHealthMetricsDailyRow {
  /**
   * Project ID
   */
  PROJECT_ID: string;

  /**
   * Project URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Metric date (YYYY-MM-DD format)
   */
  METRIC_DATE: string;

  /**
   * Average health score across all sub-projects
   */
  AVG_HEALTH_SCORE: number;

  /**
   * Minimum health score among sub-projects
   */
  MIN_HEALTH_SCORE: number;

  /**
   * Maximum health score among sub-projects
   */
  MAX_HEALTH_SCORE: number;

  /**
   * Count of sub-projects with health score data
   */
  PROJECTS_WITH_HEALTH_SCORE_COUNT: number;

  /**
   * Total software value in dollars
   */
  TOTAL_SOFTWARE_VALUE: number;

  /**
   * Average software value per sub-project
   */
  AVG_SOFTWARE_VALUE: number;

  /**
   * Count of sub-projects with software value data
   */
  PROJECTS_WITH_SOFTWARE_VALUE_COUNT: number;

  /**
   * Total sub-projects count
   */
  TOTAL_SUB_PROJECTS_COUNT: number;
}

/**
 * API response for health metrics daily query
 * Contains daily trend data with aggregated metrics
 */
export interface HealthMetricsDailyResponse {
  /**
   * Array of daily health metrics data
   */
  data: FoundationHealthMetricsDailyRow[] | ProjectHealthMetricsDailyRow[];

  /**
   * Current average health score (from most recent date)
   */
  currentAvgHealthScore: number;

  /**
   * Number of days with data
   */
  totalDays: number;
}

/**
 * Foundation unique contributors daily row from Snowflake
 * Raw response from FOUNDATION_UNIQUE_CONTRIBUTORS_DAILY table
 */
export interface FoundationUniqueContributorsDailyRow {
  /**
   * Foundation ID
   */
  FOUNDATION_ID: string;

  /**
   * Foundation name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Activity date (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Number of unique contributors on this date
   */
  DAILY_UNIQUE_CONTRIBUTORS: number;

  /**
   * Average contributors (calculated aggregate)
   */
  AVG_CONTRIBUTORS: number;

  /**
   * Total days with data
   */
  TOTAL_DAYS: number;
}

/**
 * Project unique contributors daily row from Snowflake
 * Raw response from PROJECT_UNIQUE_CONTRIBUTORS_DAILY table
 */
export interface ProjectUniqueContributorsDailyRow {
  /**
   * Project ID
   */
  PROJECT_ID: string;

  /**
   * Project name
   */
  PROJECT_NAME: string;

  /**
   * Project URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Activity date (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Number of unique contributors on this date
   */
  DAILY_UNIQUE_CONTRIBUTORS: number;

  /**
   * Average contributors (calculated aggregate)
   */
  AVG_CONTRIBUTORS: number;

  /**
   * Total days with data
   */
  TOTAL_DAYS: number;
}

/**
 * API response for unique contributors daily query
 * Contains daily trend data with aggregated metrics
 */
export interface UniqueContributorsDailyResponse {
  /**
   * Array of daily unique contributors data
   */
  data: FoundationUniqueContributorsDailyRow[] | ProjectUniqueContributorsDailyRow[];

  /**
   * Average unique contributors per day
   */
  avgContributors: number;

  /**
   * Number of days with data
   */
  totalDays: number;
}

/**
 * Foundation health events monthly row from Snowflake
 * Raw response from FOUNDATION_HEALTH_EVENTS_MONTHLY table
 */
export interface FoundationHealthEventsMonthlyRow {
  /**
   * Foundation ID
   */
  FOUNDATION_ID: string;

  /**
   * Foundation name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Month start date (YYYY-MM-DD format)
   */
  MONTH_START_DATE: string;

  /**
   * Number of events in this month
   */
  EVENT_COUNT: number;

  /**
   * Total events across all months
   */
  TOTAL_EVENTS: number;
}

/**
 * Project health events monthly row from Snowflake
 * Raw response from PROJECT_HEALTH_EVENTS_MONTHLY table
 */
export interface ProjectHealthEventsMonthlyRow {
  /**
   * Project ID
   */
  PROJECT_ID: string;

  /**
   * Project name
   */
  PROJECT_NAME: string;

  /**
   * Project URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Month start date (YYYY-MM-DD format)
   */
  MONTH_START_DATE: string;

  /**
   * Number of events in this month
   */
  EVENT_COUNT: number;

  /**
   * Total events across all months
   */
  TOTAL_EVENTS: number;
}

/**
 * API response for health events monthly query
 * Contains monthly trend data with aggregated metrics
 */
export interface HealthEventsMonthlyResponse {
  /**
   * Array of monthly events data
   */
  data: FoundationHealthEventsMonthlyRow[] | ProjectHealthEventsMonthlyRow[];

  /**
   * Total events across all months
   */
  totalEvents: number;

  /**
   * Number of months with data
   */
  totalMonths: number;
}

/**
 * Certified Employees Monthly row from Snowflake
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 * Contains monthly certification metrics for board member dashboard charts
 */
export interface CertifiedEmployeesMonthlyRow {
  /**
   * Organization account ID
   */
  ACCOUNT_ID: string;

  /**
   * Foundation unique identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation display name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Month start date (first day of month) - returned as Date object from Snowflake
   */
  MONTH_START_DATE: Date;

  /**
   * Number of certifications for this month
   */
  MONTHLY_CERTIFICATIONS: number;

  /**
   * Number of certified employees for this month
   */
  MONTHLY_CERTIFIED_EMPLOYEES: number;

  /**
   * Total certifications (aggregated yearly)
   */
  TOTAL_CERTIFICATIONS: number;

  /**
   * Total certified employees (aggregated yearly)
   */
  TOTAL_CERTIFIED_EMPLOYEES: number;

  /**
   * Cumulative certifications up to this month (calculated via SQL window function)
   */
  CUMULATIVE_CERTIFICATIONS: number;
}

/**
 * API response for Certified Employees query
 * Contains certification data for an organization with monthly trend data
 */
export interface CertifiedEmployeesResponse {
  /**
   * Total number of certifications held by employees (from TOTAL_CERTIFICATIONS)
   */
  certifications: number;

  /**
   * Number of certified employees (from TOTAL_CERTIFIED_EMPLOYEES)
   */
  certifiedEmployees: number;

  /**
   * Organization account ID
   */
  accountId: string;

  /**
   * Monthly certified employees count data for trend visualization
   * Array of certified employee counts (oldest to newest, from MONTHLY_CERTIFIED_EMPLOYEES)
   */
  monthlyData: number[];

  /**
   * Month labels for chart visualization
   * Array of month strings (e.g., ['Jan 2024', 'Feb 2024']) matching monthlyData
   */
  monthlyLabels: string[];
}

/**
 * Membership Tier row from Snowflake MEMBER_DASHBOARD_MEMBERSHIP_TIER table
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 */
export interface MembershipTierRow {
  /**
   * Project ID
   */
  PROJECT_ID: string;

  /**
   * Project name
   */
  PROJECT_NAME: string;

  /**
   * Project URL slug
   */
  PROJECT_SLUG: string;

  /**
   * Whether the project is active
   */
  IS_PROJECT_ACTIVE: boolean;

  /**
   * Organization account ID
   */
  ACCOUNT_ID: string;

  /**
   * Organization account name
   */
  ACCOUNT_NAME: string;

  /**
   * Membership tier name (e.g., "Platinum Membership")
   */
  MEMBERSHIP_TIER: string;

  /**
   * Membership price in dollars
   */
  MEMBERSHIP_PRICE: number;

  /**
   * Membership start date (YYYY-MM-DD format)
   */
  START_DATE: string;

  /**
   * Membership end date (YYYY-MM-DD format)
   */
  LAST_END_DATE: string;

  /**
   * Renewal price in dollars
   */
  RENEWAL_PRICE: number;

  /**
   * Membership status (e.g., "Active")
   */
  MEMBERSHIP_STATUS: string;
}

/**
 * API response for Membership Tier query
 * Contains membership tier data for an organization within a foundation
 */
export interface MembershipTierResponse {
  /**
   * Project ID
   */
  projectId: string;

  /**
   * Project name
   */
  projectName: string;

  /**
   * Project URL slug
   */
  projectSlug: string;

  /**
   * Whether the project is active
   */
  isProjectActive: boolean;

  /**
   * Organization account ID
   */
  accountId: string;

  /**
   * Organization account name
   */
  accountName: string;

  /**
   * Membership tier name (cleaned, e.g., "Platinum" without "Membership" suffix)
   */
  membershipTier: string;

  /**
   * Membership price in dollars
   */
  membershipPrice: number;

  /**
   * Membership start date (YYYY-MM-DD format)
   */
  startDate: string;

  /**
   * Membership end date (YYYY-MM-DD format)
   */
  endDate: string;

  /**
   * Renewal price in dollars
   */
  renewalPrice: number;

  /**
   * Membership status (e.g., "Active")
   */
  membershipStatus: string;
}

/**
 * Organization Maintainers Monthly row from Snowflake
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 * Contains monthly maintainer metrics for board member dashboard charts
 */
export interface OrganizationMaintainersMonthlyRow {
  /**
   * Foundation unique identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation display name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Organization account ID
   */
  ACCOUNT_ID: string;

  /**
   * Organization account name
   */
  ACCOUNT_NAME: string;

  /**
   * Metric month date (first day of month) - returned as Date object from Snowflake
   */
  METRIC_MONTH: Date;

  /**
   * Number of active maintainers for this month
   */
  ACTIVE_MAINTAINERS: number;

  /**
   * Number of active projects for this month
   */
  ACTIVE_PROJECTS: number;

  /**
   * Total maintainers yearly (aggregated)
   */
  TOTAL_MAINTAINERS_YEARLY: number;

  /**
   * Total projects yearly (aggregated)
   */
  TOTAL_PROJECTS_YEARLY: number;

  /**
   * Average maintainers yearly (calculated aggregate)
   */
  AVG_MAINTAINERS_YEARLY: number;
}

/**
 * API response for Organization Maintainers query
 * Contains maintainer data for an organization with monthly trend data
 */
export interface OrganizationMaintainersResponse {
  /**
   * Number of maintainers from the organization (yearly total)
   */
  maintainers: number;

  /**
   * Number of projects where the organization has maintainers (yearly total)
   */
  projects: number;

  /**
   * Organization account ID
   */
  accountId: string;

  /**
   * Organization account name
   */
  accountName: string;

  /**
   * Monthly maintainer count data for trend visualization
   * Array of active maintainer counts (oldest to newest)
   */
  monthlyData: number[];

  /**
   * Month labels for chart visualization
   * Array of month strings (e.g., ['Jan 2024', 'Feb 2024']) matching monthlyData
   */
  monthlyLabels: string[];
}

/**
 * Organization Contributors Monthly row from Snowflake
 * Raw response with Snowflake naming conventions (ALL_CAPS)
 * Contains monthly contributor metrics for board member dashboard charts
 */
export interface OrganizationContributorsMonthlyRow {
  /**
   * Foundation unique identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation display name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Organization unique identifier
   */
  ORGANIZATION_ID: string;

  /**
   * Organization account ID (Salesforce)
   */
  ACCOUNT_ID: string;

  /**
   * Organization account name
   */
  ACCOUNT_NAME: string;

  /**
   * Month start date (first day of month) - returned as Date object from Snowflake
   */
  MONTH_START_DATE: Date;

  /**
   * Number of unique contributors for this month
   */
  UNIQUE_CONTRIBUTORS: number;

  /**
   * Total active contributors (aggregated yearly)
   */
  TOTAL_ACTIVE_CONTRIBUTORS: number;
}

/**
 * API response for Organization Contributors query
 * Contains contributor data for an organization with monthly trend data
 */
export interface OrganizationContributorsResponse {
  /**
   * Total active contributors from the organization (yearly total from TOTAL_ACTIVE_CONTRIBUTORS)
   */
  contributors: number;

  /**
   * Organization account ID
   */
  accountId: string;

  /**
   * Organization account name
   */
  accountName: string;

  /**
   * Monthly contributor count data for trend visualization
   * Array of unique contributor counts (oldest to newest, from UNIQUE_CONTRIBUTORS)
   */
  monthlyData: number[];

  /**
   * Month labels for chart visualization
   * Array of month strings (e.g., ['Jan 2024', 'Feb 2024']) matching monthlyData
   */
  monthlyLabels: string[];
}

/**
 * Foundation Company Bus Factor row from Snowflake
 * Raw response from FOUNDATION_COMPANY_BUS_FACTOR table
 * Contains company concentration risk metrics for foundation health dashboard
 */
export interface FoundationCompanyBusFactorRow {
  /**
   * Foundation unique identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation display name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Number of companies accounting for >50% of contributions
   */
  BUS_FACTOR_COMPANY_COUNT: number;

  /**
   * Percentage of contributions from bus factor companies (rounded to 2 decimals)
   */
  BUS_FACTOR_CONTRIBUTION_PCT: number;

  /**
   * Total number of contributing companies
   */
  TOTAL_COMPANIES: number;

  /**
   * Total contributions across all companies
   */
  TOTAL_CONTRIBUTIONS: number;

  /**
   * Total contributions from bus factor companies
   */
  BUS_FACTOR_CONTRIBUTIONS: number;

  /**
   * Number of other contributing companies (calculated: TOTAL_COMPANIES - BUS_FACTOR_COMPANY_COUNT)
   */
  OTHER_COMPANIES_COUNT: number;

  /**
   * Percentage of contributions from other companies (calculated: 100 - BUS_FACTOR_CONTRIBUTION_PCT, rounded to 2 decimals)
   */
  OTHER_COMPANIES_PCT: number;
}

/**
 * API response for Foundation Company Bus Factor query
 * Contains company concentration risk metrics for foundation health dashboard
 * Maps to existing CompanyBusFactor interface format for UI consistency
 */
export interface FoundationCompanyBusFactorResponse {
  /**
   * Number of top companies accounting for >50% contributions
   */
  topCompaniesCount: number;

  /**
   * Percentage of contributions from top companies
   */
  topCompaniesPercentage: number;

  /**
   * Number of other contributing companies
   */
  otherCompaniesCount: number;

  /**
   * Percentage of contributions from other companies
   */
  otherCompaniesPercentage: number;
}

/**
 * Foundation Code Commits Daily row from Snowflake
 * Raw response from FOUNDATION_CODE_COMMITS table
 * Contains daily code commit metrics for maintainer dashboard charts
 */
export interface FoundationCodeCommitsDailyRow {
  /**
   * Foundation unique identifier
   */
  FOUNDATION_ID: string;

  /**
   * Foundation display name
   */
  FOUNDATION_NAME: string;

  /**
   * Foundation URL slug
   */
  FOUNDATION_SLUG: string;

  /**
   * Date of the activity (YYYY-MM-DD format)
   */
  ACTIVITY_DATE: string;

  /**
   * Number of commits on this date
   */
  DAILY_COMMIT_COUNT: number;

  /**
   * Total commits across all dates (from SQL window function)
   */
  TOTAL_COMMITS: number;
}

/**
 * Project Code Commits Daily row from Snowflake
 * Raw response from PROJECT_CODE_COMMITS table
 * Contains daily code commit metrics for maintainer dashboard charts
 */
export interface ProjectCodeCommitsDailyRow {
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
   * Number of commits on this date
   */
  DAILY_COMMIT_COUNT: number;

  /**
   * Total commits across all dates (from SQL window function)
   */
  TOTAL_COMMITS: number;
}

/**
 * API response for Code Commits query
 * Contains daily code commit data for trend visualization
 */
export interface CodeCommitsDailyResponse {
  /**
   * Array of daily code commit data
   */
  data: {
    /**
     * Date of the activity (YYYY-MM-DD format)
     */
    ACTIVITY_DATE: string;

    /**
     * Number of commits on this date
     */
    DAILY_COMMIT_COUNT: number;
  }[];

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
 * Daily training enrollment aggregation from Snowflake
 * Used for cumulative chart visualization
 */
export interface TrainingEnrollmentDailyRow {
  /**
   * Date of enrollments (YYYY-MM-DD format)
   */
  ENROLLMENT_DATE: string;

  /**
   * Number of enrollments on this date
   */
  DAILY_COUNT: number;

  /**
   * Cumulative count up to this date
   */
  CUMULATIVE_COUNT: number;
}

/**
 * API response for Training Enrollments query
 * Contains enrollment data for an organization within a foundation
 */
export interface TrainingEnrollmentsResponse {
  /**
   * Total number of training enrollments this year
   */
  totalEnrollments: number;

  /**
   * Daily enrollment data for cumulative chart
   */
  dailyData: {
    /**
     * Date of enrollments (YYYY-MM-DD format)
     */
    date: string;

    /**
     * Number of enrollments on this date
     */
    count: number;

    /**
     * Cumulative count up to this date
     */
    cumulativeCount: number;
  }[];

  /**
   * Organization account ID
   */
  accountId: string;

  /**
   * Project URL slug
   */
  projectSlug: string;
}
