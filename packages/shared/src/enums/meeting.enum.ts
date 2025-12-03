// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meeting visibility levels
 * @description Determines who can see the meeting in calendars and listings
 */
export enum MeetingVisibility {
  /** Meeting is visible to all users and appears in public calendars */
  PUBLIC = 'public',
  /** Meeting is only visible to authorized users */
  PRIVATE = 'private',
}

/**
 * Meeting type categories
 * @description Categorizes meetings by their purpose and governance structure
 */
export enum MeetingType {
  /** Board of directors meetings */
  BOARD = 'Board',
  /** Project maintainer meetings */
  MAINTAINERS = 'Maintainers',
  /** Marketing and outreach meetings */
  MARKETING = 'Marketing',
  /** Technical working group meetings */
  TECHNICAL = 'Technical',
  /** Legal committee meetings */
  LEGAL = 'Legal',
  /** Other meeting types not covered above */
  OTHER = 'Other',
  /** No specific meeting type assigned */
  NONE = 'None',
}

/**
 * Meeting recurrence patterns
 * @description Defines how often recurring meetings repeat (maps to Zoom API values)
 */
export enum RecurrenceType {
  /** Meeting repeats every day */
  DAILY = 1,
  /** Meeting repeats weekly on the same day */
  WEEKLY = 2,
  /** Meeting repeats monthly on the same date/day pattern */
  MONTHLY = 3,
}

/**
 * Meeting artifact visibility levels
 * @description Determines who can access meeting recordings, transcripts, and AI summaries
 */
export enum ArtifactVisibility {
  /** Only meeting hosts can access artifacts */
  MEETING_HOSTS = 'meeting_hosts',
  /** Meeting hosts and guests can access artifacts */
  MEETING_PARTICIPANTS = 'meeting_participants',
  /** Artifacts are publicly accessible */
  PUBLIC = 'public',
}

// TODO(v1-migration): Remove v1_meeting and v1_past_meeting types once all meetings are migrated to V2
/**
 * Query service meeting resource types
 * @description Types used when fetching meetings from the query service
 */
export type QueryServiceMeetingType = 'meeting' | 'past_meeting' | 'v1_meeting' | 'v1_past_meeting';
