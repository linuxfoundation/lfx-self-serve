// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType, MeetingVisibility, RecurrenceType } from '../enums';

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
  id: string;
  created_at: string;
  project_uid: string;
  user_id?: string;
  visibility: MeetingVisibility | null;
  youtube_enabled: boolean | null;
  zoom_ai_enabled: boolean | null;
  recording_enabled: boolean | null;
  transcripts_enabled: boolean | null;
  timezone: string | null;
  meeting_type: string | null;
  recording_access: string | null;
  recurrence: MeetingRecurrence | null;
  topic: string | null;
  agenda: string | null;
  restricted: boolean | null;
  start_time: string | null;
  duration: number | null;
  early_join_time?: number;
  require_ai_summary_approval?: boolean;
  ai_summary_access?: string;
  meeting_committees: MeetingCommittee[] | null;
  individual_participants_count: number;
  committee_members_count: number;
  participants_accepted_count: number;
  participants_declined_count: number;
  participants_pending_count: number;
  committees: string[];
}

export interface CreateMeetingRequest {
  project_uid: string;
  topic: string;
  agenda?: string;
  start_time: string;
  duration: number;
  timezone: string;
  meeting_type: string;
  early_join_time?: number;
  visibility?: MeetingVisibility;
  recording_enabled?: boolean;
  transcripts_enabled?: boolean;
  youtube_enabled?: boolean;
  zoom_ai_enabled?: boolean;
  require_ai_summary_approval?: boolean;
  ai_summary_access?: string;
  recording_access?: string;
  recurrence?: MeetingRecurrence;
  restricted?: boolean;
  committees?: string[];
  important_links?: ImportantLink[];
}

export interface UpdateMeetingRequest {
  project_uid: string;
  topic: string;
  agenda?: string;
  start_time: string;
  duration: number;
  timezone: string;
  meeting_type: string;
  early_join_time?: number;
  visibility?: MeetingVisibility;
  recording_enabled?: boolean;
  transcripts_enabled?: boolean;
  youtube_enabled?: boolean;
  zoom_ai_enabled?: boolean;
  require_ai_summary_approval?: boolean;
  ai_summary_access?: string;
  recording_access?: string;
  recurrence?: MeetingRecurrence;
  restricted?: boolean;
  committees?: string[];
}

export interface DeleteMeetingRequest {
  deleteType?: 'single' | 'series';
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
