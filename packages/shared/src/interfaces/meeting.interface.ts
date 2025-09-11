// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ArtifactVisibility, MeetingType, MeetingVisibility, RecurrenceType } from '../enums';

/**
 * Zoom-specific meeting configuration
 * @description Settings specific to Zoom platform integration
 */
export interface ZoomConfig {
  /** Zoom meeting ID (response only) */
  meeting_id?: string;
  /** Zoom meeting passcode (response only) */
  passcode?: string;
  /** Enable/disable Zoom AI companion */
  ai_companion_enabled?: boolean;
  /** Require approval for AI summaries in LFX system */
  ai_summary_require_approval?: boolean;
}

/**
 * Meeting recurrence configuration
 * @description Defines how and when a meeting repeats (compatible with Zoom API)
 */
export interface MeetingRecurrence {
  /** End date/time for the recurrence pattern (ISO string) */
  end_date_time?: string;
  /** Number of times the meeting should repeat before ending */
  end_times?: number;
  /** Day of the month for monthly recurrence (1-31) */
  monthly_day?: number;
  /** Week of the month for monthly recurrence (1-4, -1 for last week) */
  monthly_week?: number;
  /** Day of the week for monthly recurrence (1-7, Sunday=1) */
  monthly_week_day?: number;
  /** Interval between recurrences (e.g., 1=every week, 2=every other week) */
  repeat_interval: number;
  /** Type of recurrence pattern */
  type: RecurrenceType;
  /** Comma-separated days of week for weekly recurrence (1-7, Sunday=1) */
  weekly_days?: string;
}

/**
 * Important link associated with a meeting
 * @description External links relevant to the meeting (agendas, documents, etc.)
 */
export interface ImportantLink {
  /** Unique identifier for the link */
  id?: string;
  /** Display title for the link */
  title: string;
  /** URL of the external resource */
  url: string;
}

/**
 * Committee associated with a meeting
 * @description Basic committee information for meeting association
 */

/**
 * Committee payload for meeting API requests
 * @description Committee structure used in create/update meeting requests
 */
export interface MeetingCommittee {
  /** Unique identifier for the committee */
  uid: string;
  /** Allowed voting statuses for committee members */
  allowed_voting_statuses?: string[];
  /** Committee name */
  name?: string;
}

export interface Meeting {
  // API Response fields - not in create payload
  /** UUID of the LFX Meeting */
  uid: string;
  /** Timestamp when meeting was created */
  created_at: string;
  /** Timestamp when meeting was last updated */
  updated_at: string;
  /** Write access permission for current user (response only) */
  organizer?: boolean;

  // Required API fields
  /** UUID of the LF project */
  project_uid: string;
  /** Meeting start time in RFC3339 format */
  start_time: string;
  /** Meeting duration in minutes (0-600) */
  duration: number;
  /** Meeting timezone (e.g., "America/New_York") */
  timezone: string;
  /** Meeting title */
  title: string;
  /** Meeting description */
  description: string;
  // Optional API fields
  /** Currently only "Zoom" is supported */
  platform?: string;
  /** For recurring meetings */
  recurrence: MeetingRecurrence | null;
  /** Associated committees with voting statuses */
  committees: MeetingCommittee[];
  /** "Board", "Maintainers", "Technical", etc. */
  meeting_type: string | null;
  /** "public" or "private" */
  visibility: MeetingVisibility | null;
  /** Boolean for invitation-only meetings */
  restricted: boolean | null;
  /** Enable meeting recording */
  recording_enabled: boolean | null;
  /** Enable transcription */
  transcript_enabled: boolean | null;
  /** YouTube upload integration */
  youtube_upload_enabled: boolean | null;
  /** Who can access meeting artifacts (recordings, transcripts, AI summaries) */
  artifact_visibility: ArtifactVisibility | null;
  /** Minutes before meeting registrants can join */
  early_join_time_minutes?: number;
  /** Array of organizer usernames */
  organizers: string[];
  /** Meeting access password for private/restricted meetings */
  password: string | null;
  /** Zoom-specific settings */
  zoom_config?: ZoomConfig | null;

  // Fields NOT in API - likely response-only
  /** Meeting join URL */
  join_url?: string;
  /** Count fields (response only) */
  individual_registrants_count: number;
  /** Count fields (response only) */
  committee_members_count: number;
  /** Count fields (response only) */
  registrants_accepted_count: number;
  /** Count fields (response only) */
  registrants_declined_count: number;
  /** Count fields (response only) */
  registrants_pending_count: number;
  /** Meeting occurrences */
  occurrences: MeetingOccurrence[];
}

/**
 * Meeting occurrence entity with meeting details
 * @description Represents a specific occurrence of a recurring meeting
 */
export interface MeetingOccurrence {
  /** Unique identifier for the occurrence */
  occurrence_id: string;
  /** Meeting title */
  title: string;
  /** Meeting description */
  description: string;
  /** Meeting start time in RFC3339 format */
  start_time: string;
  /** Meeting duration in minutes (0-600) */
  duration: number;
}

export interface CreateMeetingRequest {
  // Required API fields
  project_uid: string; // UUID of the LF project
  start_time: string; // Meeting start time in RFC3339 format
  duration: number; // Meeting duration in minutes (0-600)
  timezone: string; // Meeting timezone (e.g., "America/New_York")
  title: string; // Meeting title
  description: string; // Meeting description

  // Optional API fields
  platform?: string; // Currently only "Zoom" is supported
  recurrence?: MeetingRecurrence; // For recurring meetings
  committees?: MeetingCommittee[]; // Associated committees with voting statuses
  meeting_type?: string; // "Board", "Maintainers", "Technical", etc.
  visibility?: MeetingVisibility; // "public" or "private"
  restricted?: boolean; // Boolean for invitation-only meetings
  recording_enabled?: boolean; // Enable meeting recording
  transcript_enabled?: boolean; // Enable transcription
  youtube_upload_enabled?: boolean; // YouTube upload integration
  artifact_visibility?: ArtifactVisibility; // Who can access meeting artifacts
  early_join_time_minutes?: number; // Minutes before meeting registrants can join
  organizers?: string[]; // Array of organizer email addresses
  zoom_config?: ZoomConfig; // Zoom-specific settings
}

export interface UpdateMeetingRequest {
  // Required API fields
  project_uid: string; // UUID of the LF project
  start_time: string; // Meeting start time in RFC3339 format
  duration: number; // Meeting duration in minutes (0-600)
  timezone: string; // Meeting timezone (e.g., "America/New_York")
  title: string; // Meeting title
  description?: string; // Meeting description

  // Optional API fields
  platform?: string; // Currently only "Zoom" is supported
  recurrence?: MeetingRecurrence | null; // For recurring meetings
  committees?: MeetingCommittee[]; // Associated committees with voting statuses
  meeting_type?: string | null; // "Board", "Maintainers", "Technical", etc.
  visibility?: MeetingVisibility | null; // "public" or "private"
  restricted?: boolean | null; // Boolean for invitation-only meetings
  recording_enabled?: boolean | null; // Enable meeting recording
  transcript_enabled?: boolean | null; // Enable transcription
  youtube_upload_enabled?: boolean | null; // YouTube upload integration
  artifact_visibility?: ArtifactVisibility | null; // Who can access meeting artifacts
  early_join_time_minutes?: number; // Minutes before meeting registrants can join
  organizers?: string[]; // Array of organizer email addresses
  zoom_config?: ZoomConfig | null; // Zoom-specific settings
}

export interface DeleteMeetingRequest {
  deleteType?: 'single' | 'series';
}

/**
 * Meeting settings update request
 * @description Structure for updating meeting settings via PUT /meetings/{uid}/settings
 */
export interface MeetingSettingsRequest {
  /** Array of organizer usernames */
  organizers?: string[];
}

/**
 * Interface representing a meeting agenda template
 */
export interface MeetingTemplate {
  /** Unique identifier for the template */
  id: string;
  /** Template title displayed to users */
  title: string;
  /** Structured markdown content for the agenda */
  content: string;
  /** Meeting type this template is designed for */
  meetingType: MeetingType;
  /** Estimated duration in minutes */
  estimatedDuration: number;
}

/**
 * Interface representing a group of templates for a specific meeting type
 */
export interface MeetingTemplateGroup {
  /** Meeting type for this group */
  meetingType: MeetingType;
  /** Array of templates for this meeting type */
  templates: MeetingTemplate[];
}

/**
 * Meeting registrant information from microproxy service
 * @description Individual registrant/guest for a meeting
 */
export interface MeetingRegistrant {
  /** Unique identifier for the registrant (auto-generated) */
  uid: string;
  /** Meeting UUID this registrant belongs to */
  meeting_uid: string;
  /** Registrant's email address */
  email: string;
  /** Registrant's first name */
  first_name: string;
  /** Registrant's last name */
  last_name: string;
  /** Whether this registrant has host access */
  host: boolean;
  /** Registrant's job title */
  job_title: string | null;
  /** Registrant's organization name */
  org_name: string | null;
  /** Specific occurrence ID to invite to */
  occurrence_id: string | null;
  /** LF membership status (read-only) */
  org_is_member: boolean;
  /** Project membership status (read-only) */
  org_is_project_member: boolean;
  /** Registrant's avatar URL */
  avatar_url: string | null;
  /** Registrant's LFID username */
  username: string | null;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;

  // Fields NOT in API - likely response-only
  /** Registrant's type */
  type: 'direct' | 'committee';
  /** Registrant Committee UID (if type is committee) */
  committee_uid?: string | null;
  /** Registrant's invite accepted status */
  invite_accepted: boolean | null;
  /** Registrant's attended status */
  attended: boolean | null;
}

/**
 * Request payload for creating a meeting registrant
 * @description Data required to add a new registrant to a meeting
 */
export interface CreateMeetingRegistrantRequest {
  /** UUID of the meeting */
  meeting_uid: string;
  /** User's email address */
  email: string;
  /** User's first name */
  first_name: string;
  /** User's last name */
  last_name: string;
  /** Whether user should have host access */
  host?: boolean;
  /** User's job title */
  job_title?: string | null;
  /** User's organization */
  org_name?: string | null;
  /** Specific occurrence ID to invite to (blank = all occurrences) */
  occurrence_id?: string | null;
  /** User's avatar URL */
  avatar_url?: string | null;
  /** User's LFID */
  username?: string | null;
}

/**
 * Request payload for updating a meeting registrant
 * @description Data required for PUT request to update an existing registrant
 */
export interface UpdateMeetingRegistrantRequest {
  /** UUID of the meeting (required) */
  meeting_uid: string;
  /** User's email address (required) */
  email: string;
  /** User's first name (required) */
  first_name: string;
  /** User's last name (required) */
  last_name: string;
  /** Whether user should have host access */
  host?: boolean;
  /** User's job title */
  job_title?: string | null;
  /** User's organization */
  org_name?: string | null;
  /** Specific occurrence ID to invite to */
  occurrence_id?: string | null;
  /** User's avatar URL */
  avatar_url?: string | null;
  /** User's LFID */
  username?: string | null;
}

/**
 * State types for tracking registrant changes
 */
export type RegistrantState = 'existing' | 'new' | 'modified' | 'deleted';

/**
 * Enhanced meeting registrant with state tracking
 * @description Extends MeetingRegistrant with metadata for local state management
 */
export interface MeetingRegistrantWithState extends MeetingRegistrant {
  /** Current state of this registrant */
  state: RegistrantState;
  /** Original data from API (for existing registrants) */
  originalData?: MeetingRegistrant;
  /** Temporary ID for new registrants (starts with 'temp_') */
  tempId?: string;
}

/**
 * Batch update request for meeting registrants
 * @description Request payload for updating multiple registrants at once
 */
export interface BatchUpdateMeetingRegistrantsRequest {
  /** Array of registrants to update with their UIDs and change data */
  registrants: { uid: string; changes: UpdateMeetingRegistrantRequest }[];
}

/**
 * Batch delete request for meeting registrants
 * @description Request payload for deleting multiple registrants at once
 */
export interface BatchDeleteMeetingRegistrantsRequest {
  /** Array of registrant UIDs to delete */
  registrantUids: string[];
}

/**
 * Pending changes summary for registrants
 */
export interface RegistrantPendingChanges {
  /** Registrants to be created via API */
  toAdd: CreateMeetingRegistrantRequest[];
  /** Registrants to be updated via API */
  toUpdate: { uid: string; changes: UpdateMeetingRegistrantRequest }[];
  /** Registrant UIDs to be deleted via API */
  toDelete: string[];
}

/**
 * Individual operation result for batch operations
 */
export interface RegistrantOperationResult<T = unknown> {
  /** Success indicator */
  success: boolean;
  /** Result data if successful */
  data?: T;
  /** Error information if failed */
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  /** Original input data for context */
  input?: unknown;
}

/**
 * Batch operation response for registrant operations
 */
export interface BatchRegistrantOperationResponse<T = unknown> {
  /** Array of successful results */
  successes: T[];
  /** Array of failed operations with error details */
  failures: Array<{
    input: unknown;
    error: {
      message: string;
      code?: string;
      details?: unknown;
    };
  }>;
  /** Summary counts */
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

/**
 * Response for meeting join URL endpoint
 * @description Contains the join URL for a specific meeting
 */
export interface MeetingJoinURL {
  /** Meeting join URL */
  join_url: string;
}
