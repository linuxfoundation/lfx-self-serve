// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Generic table row data for dashboard tables
 * @description Standard structure for tabular data display in dashboard components
 */
export interface TableData {
  /** Unique identifier for the row */
  id: string | number;
  /** Display title for the item */
  title: string;
  /** URL to view item details */
  url: string;
  /** Current status of the item */
  status: string;
  /** Date associated with the item (null if not applicable) */
  date: string | null;
}

/**
 * Project statistics for dashboard overview
 * @description Key metrics about project membership, committees, and meetings
 */
export interface ProjectStats {
  /** Total number of project members across all committees */
  totalMembers: number;
  /** Total number of committees in the project */
  totalCommittees: number;
  /** Total number of meetings (past and future) */
  totalMeetings: number;
  /** Number of upcoming scheduled meetings */
  upcomingMeetings: number;
  /** Number of public meetings */
  publicMeetings: number;
  /** Number of private meetings */
  privateMeetings: number;
}

/**
 * Project health metrics for dashboard insights
 * @description Calculated metrics to assess project activity and engagement levels
 */
export interface ProjectHealth {
  /** Overall activity score (0-100 scale) */
  activityScore: number;
  /** Average number of members per committee */
  avgMembersPerCommittee: number;
  /** Meeting frequency (meetings per month) */
  meetingFrequency: number;
  /** Committee utilization percentage (active vs total) */
  committeeUtilization: number;
  /** Number of recent committee updates */
  recentCommitteeUpdates: number;
  /** Number of recent meetings held */
  recentMeetings: number;
}
