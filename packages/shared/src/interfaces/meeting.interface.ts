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
export interface MeetingCommittee {
  /** Unique identifier for the committee */
  uid: string;
  /** Display name of the committee */
  name: string;
  /** Total number of members in the committee */
  committee_total_members: number;
}

/**
 * Committee payload for meeting API requests
 * @description Committee structure used in create/update meeting requests
 */
export interface MeetingCommitteePayload {
  /** Unique identifier for the committee */
  uid: string;
  /** Allowed voting statuses for committee members */
  allowed_voting_statuses: string[];
}

/**
 * Meeting participant information
 * @description Individual or committee member participating in a meeting
 */
export interface MeetingParticipant {
  /** Unique identifier for the participant */
  id: string;
  /** ID of the meeting this participant is associated with */
  meeting_id: string;
  /** Participant's first name */
  first_name: string;
  /** Participant's last name */
  last_name: string;
  /** Participant's email address */
  email: string;
  /** Participant's organization (if any) */
  organization: string | null;
  /** Whether this participant is a meeting host */
  is_host: boolean;
  /** Participant's job title (if provided) */
  job_title: string | null;
  /** Timestamp when participant was added */
  created_at: string;
  /** Timestamp when participant was last updated */
  updated_at: string;
  /** Type of participant (individual person or committee representative) */
  type: 'individual' | 'committee';
  invite_accepted: boolean | null;
  attended: boolean | null;
}

export interface Meeting {
  // API Response fields - not in create payload
  /** UUID of the LFX Meeting */
  uid: string;
  /** Timestamp when meeting was created */
  created_at: string;
  /** Timestamp when meeting was last updated */
  updated_at: string;

  // Required API fields
  /** UUID of the LF project */
  project_uid: string;
  /** Meeting start time in RFC3339 format */
  start_time: string | null;
  /** Meeting duration in minutes (0-600) */
  duration: number | null;
  /** Meeting timezone (e.g., "America/New_York") */
  timezone: string | null;
  /** Meeting title */
  title: string | null;
  /** Meeting description */
  description: string | null;

  // Optional API fields
  /** Currently only "Zoom" is supported */
  platform?: string;
  /** For recurring meetings */
  recurrence: MeetingRecurrence | null;
  /** Associated committees with voting statuses */
  committees?: MeetingCommitteePayload[];
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
  /** Minutes before meeting participants can join */
  early_join_time_minutes?: number;
  /** Array of organizer usernames */
  organizers: string[];
  /** Zoom-specific settings */
  zoom_config?: ZoomConfig | null;

  // Fields NOT in API - likely response-only
  /** Full committee objects (response only) */
  meeting_committees?: MeetingCommittee[] | null;
  /** Count fields (response only) */
  individual_participants_count: number;
  /** Count fields (response only) */
  committee_members_count: number;
  /** Count fields (response only) */
  participants_accepted_count: number;
  /** Count fields (response only) */
  participants_declined_count: number;
  /** Count fields (response only) */
  participants_pending_count: number;
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
  committees?: MeetingCommitteePayload[]; // Associated committees with voting statuses
  meeting_type?: string; // "Board", "Maintainers", "Technical", etc.
  visibility?: MeetingVisibility; // "public" or "private"
  restricted?: boolean; // Boolean for invitation-only meetings
  recording_enabled?: boolean; // Enable meeting recording
  transcript_enabled?: boolean; // Enable transcription
  youtube_upload_enabled?: boolean; // YouTube upload integration
  artifact_visibility?: ArtifactVisibility; // Who can access meeting artifacts
  early_join_time_minutes?: number; // Minutes before meeting participants can join
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
  recurrence?: MeetingRecurrence; // For recurring meetings
  committees?: MeetingCommitteePayload[]; // Associated committees with voting statuses
  meeting_type?: string; // "Board", "Maintainers", "Technical", etc.
  visibility?: MeetingVisibility; // "public" or "private"
  restricted?: boolean; // Boolean for invitation-only meetings
  recording_enabled?: boolean; // Enable meeting recording
  transcript_enabled?: boolean; // Enable transcription
  youtube_upload_enabled?: boolean; // YouTube upload integration
  artifact_visibility?: ArtifactVisibility; // Who can access meeting artifacts
  early_join_time_minutes?: number; // Minutes before meeting participants can join
  organizers?: string[]; // Array of organizer email addresses
  zoom_config?: ZoomConfig; // Zoom-specific settings
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
