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
  /** Participant count for past meetings (response only) */
  participant_count?: number;
  /** Attended count for past meetings (response only) */
  attended_count?: number;
  /** Meeting occurrences */
  occurrences: MeetingOccurrence[];
  /** Project name */
  project_name: string;
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
  /** Whether this occurrence has been cancelled */
  is_cancelled?: boolean;
}

/**
 * Meeting with occurrence information
 * @description Combines meeting details with a specific occurrence for display and sorting purposes
 */
export interface MeetingWithOccurrence {
  /** Meeting details */
  meeting: Meeting;
  /** Specific occurrence of the meeting */
  occurrence: MeetingOccurrence;
  /** Timestamp for sorting meetings chronologically (milliseconds since epoch) */
  sortTime: number;
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
  /** Registrant's RSVP (only included when include_rsvp=true) */
  rsvp?: MeetingRsvp | null;
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
  /** RSVP response status for this registrant */
  rsvpStatus?: RsvpResponse;
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

/**
 * Extended recurrence pattern for UI form handling
 * @description Extends MeetingRecurrence with UI-specific fields for custom pattern configuration
 */
export interface CustomRecurrencePattern extends MeetingRecurrence {
  /** UI helper: Type of recurrence pattern for form display */
  patternType?: 'daily' | 'weekly' | 'monthly';
  /** UI helper: Selected days for weekly patterns (0=Sunday, 1=Monday, etc.) - converted to/from weekly_days */
  weeklyDaysArray?: number[];
  /** UI helper: Monthly recurrence type for form display */
  monthlyType?: 'dayOfMonth' | 'dayOfWeek';
  /** UI helper: When the recurrence should end for form display */
  endType?: 'never' | 'date' | 'occurrences';
}

/**
 * Recurrence summary for display purposes
 * @description Human-readable description of the recurrence pattern
 */
export interface RecurrenceSummary {
  /** Main description (e.g., "Every 2 weeks on Monday, Wednesday") */
  description: string;
  /** End description (e.g., "Until December 31, 2024" or "For 10 occurrences") */
  endDescription: string;
  /** Full summary combining both */
  fullSummary: string;
}

/**
 * Meeting session information
 * @description Individual session within a meeting (typically for past meetings)
 */
export interface MeetingSession {
  /** Session unique identifier */
  uid: string;
  /** Session start time */
  start_time: string;
  /** Session end time */
  end_time: string;
}

/**
 * Past meeting interface
 * @description Extended meeting interface with additional fields specific to past meetings
 */
export interface PastMeeting extends Meeting {
  /** Scheduled start time for past meetings */
  scheduled_start_time: string;
  /** Scheduled end time for past meetings */
  scheduled_end_time: string;
  /** Original meeting UID (different from uid which is the past meeting occurrence UID) */
  meeting_uid: string;
  /** The specific occurrence ID for recurring meetings */
  occurrence_id: string;
  /** Platform-specific meeting ID (e.g., Zoom meeting ID) */
  platform_meeting_id: string;
  /** Array of session objects with start/end times */
  sessions: MeetingSession[];
}

/**
 * Past meeting participant information
 * @description Individual participant who was invited/attended a past meeting
 */
export interface PastMeetingParticipant {
  /** Unique identifier for the participant */
  uid: string;
  /** Original meeting UUID this participant belongs to */
  meeting_uid: string;
  /** Past meeting UUID for the specific occurrence */
  past_meeting_uid: string;
  /** Participant's email address */
  email: string;
  /** Participant's first name */
  first_name: string;
  /** Participant's last name */
  last_name: string;
  /** Whether participant has host access */
  host: boolean;
  /** Whether participant actually attended the meeting */
  is_attended: boolean;
  /** Whether participant was invited to the meeting */
  is_invited: boolean;
  /** LF membership status */
  org_is_member: boolean;
  /** Project membership status */
  org_is_project_member: boolean;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Result of canceling a meeting occurrence
 * @description Contains the result of canceling a meeting occurrence
 */
export interface MeetingCancelOccurrenceResult {
  confirmed: boolean;
  error?: string;
}

/**
 * Recording session information
 * @description Individual session within a past meeting recording
 */
export interface RecordingSession {
  /** Session start time */
  start_time: string;
  /** Shareable URL for the recording */
  share_url: string;
  /** Total size of the session in bytes */
  total_size: number;
  /** Session UUID */
  uuid: string;
}

/**
 * Recording file information
 * @description Individual recording file from a meeting session
 */
export interface RecordingFile {
  /** Unique identifier for the recording file */
  id: string;
  /** Download URL for the recording file */
  download_url: string;
  /** Play URL for the recording file */
  play_url: string;
  /** File size in bytes */
  file_size: number;
  /** File type (e.g., MP4, M4A, CHAT, TRANSCRIPT) */
  file_type: string;
  /** Recording type (e.g., shared_screen_with_speaker_view, audio_only) */
  recording_type: string;
  /** Recording start time */
  recording_start: string;
  /** Recording end time */
  recording_end: string;
  /** Recording status */
  status: string;
  /** Platform-specific meeting ID */
  platform_meeting_id: string;
}

/**
 * Past meeting recording information
 * @description Recording data for a completed past meeting
 */
export interface PastMeetingRecording {
  /** Unique identifier for the recording */
  uid: string;
  /** Past meeting UID this recording belongs to */
  past_meeting_uid: string;
  /** Platform (e.g., Zoom) */
  platform: string;
  /** Platform-specific meeting ID */
  platform_meeting_id: string;
  /** Number of recording files */
  recording_count: number;
  /** Array of recording files */
  recording_files: RecordingFile[];
  /** Array of recording sessions */
  sessions: RecordingSession[];
  /** Total size of all recordings in bytes */
  total_size: number;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Summary data for a past meeting
 * @description Contains the AI-generated summary content and metadata
 */
export interface SummaryData {
  /** Summary title */
  title: string;
  /** AI-generated summary content in markdown format */
  content: string;
  /** User-edited summary content (can be empty) */
  edited_content: string;
  /** Zoom document URL for the summary */
  doc_url: string;
  /** Summary generation start time */
  start_time: string;
  /** Summary generation end time */
  end_time: string;
}

/**
 * Zoom configuration for meeting summary
 * @description Platform-specific configuration for Zoom summaries
 */
export interface ZoomSummaryConfig {
  /** Zoom meeting ID */
  meeting_id: string;
  /** Zoom meeting UUID */
  meeting_uuid: string;
}

/**
 * Past meeting summary information
 * @description AI-generated summary data for a completed past meeting
 */
export interface PastMeetingSummary {
  /** Unique identifier for the summary */
  uid: string;
  /** Original meeting UID */
  meeting_uid: string;
  /** Past meeting UID this summary belongs to */
  past_meeting_uid: string;
  /** Platform (e.g., Zoom) */
  platform: string;
  /** Whether the summary has been approved */
  approved: boolean;
  /** Whether the summary requires approval before viewing */
  requires_approval: boolean;
  /** Whether notification email was sent */
  email_sent: boolean;
  /** Access password for the summary */
  password: string;
  /** Summary content and metadata */
  summary_data: SummaryData;
  /** Zoom-specific configuration (optional) */
  zoom_config?: ZoomSummaryConfig;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Update past meeting summary request
 * @description Request payload for updating a past meeting summary's edited content and approval status
 */
export interface UpdatePastMeetingSummaryRequest {
  /** Updated summary content (HTML/text) - optional when only approving */
  edited_content?: string;
  /** Approval status - optional when only editing content */
  approved?: boolean;
}

/**
 * RSVP response type
 * @description User's response to a meeting invitation
 */
export type RsvpResponse = 'accepted' | 'maybe' | 'declined';

/**
 * RSVP scope type
 * @description Defines which occurrences of a recurring meeting the RSVP applies to
 */
export type RsvpScope = 'single' | 'all' | 'this_and_following';

/**
 * RSVP counts by response type
 * @description Aggregated counts of RSVPs grouped by response
 */
export interface RsvpCounts {
  /** Number of accepted RSVPs */
  accepted: number;
  /** Number of declined RSVPs */
  declined: number;
  /** Number of maybe RSVPs */
  maybe: number;
  /** Total number of RSVPs */
  total: number;
}

/**
 * Meeting RSVP information
 * @description User's RSVP response for a meeting
 */
export interface MeetingRsvp {
  /** Unique identifier for the RSVP */
  id: string;
  /** Meeting UUID this RSVP belongs to */
  meeting_uid: string;
  /** User's registrant ID */
  registrant_id: string;
  /** User's username */
  username: string;
  /** User's email address */
  email: string;
  /** User's RSVP response */
  response: RsvpResponse;
  /** Scope of the RSVP (which occurrences it applies to) */
  scope: RsvpScope;
  /** Occurrence ID (only present when scope is 'single') */
  occurrence_id?: string;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Request payload for creating a meeting RSVP
 * @description Data required to create or update a meeting RSVP
 */
export interface CreateMeetingRsvpRequest {
  /** User's registrant ID (optional - backend derives from username if not provided) */
  registrant_id?: string;
  /** User's username (optional - backend derives from authenticated user if not provided) */
  username?: string;
  /** User's email (optional - backend derives from authenticated user if not provided) */
  email?: string;
  /** The specific occurrence ID to RSVP for (optional) */
  occurrence_id?: string;
  /** Scope of the RSVP */
  scope: RsvpScope;
  /** User's RSVP response */
  response: RsvpResponse;
}
