// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Types of activities tracked in the LFX platform
 * @description Categories for user activity and project events
 */
export type ActivityType = 'committee' | 'meeting' | 'mailing-list' | 'committee-member' | 'meeting-guest';

/**
 * Recent activity item for dashboard and activity feeds
 * @description Represents a user or project activity with display information
 */
export interface RecentActivity {
  /** Type of activity that occurred */
  type: ActivityType;
  /** Display title for the activity */
  title: string;
  /** Date when activity occurred (ISO string) */
  date: string;
  /** Detailed description of the activity */
  description: string;
  /** Icon class or name for visual representation */
  icon: string;
  /** Optional URL to view more details */
  url?: string;
  /** Project UID this activity is associated with */
  project_uid: string;
}
