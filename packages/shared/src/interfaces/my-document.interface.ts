// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Source type for My Documents page */
export type MyDocumentSource = 'link' | 'meeting' | 'file' | 'recording' | 'transcript' | 'summary' | 'mailing_list';

// ─── Query Result Shapes ─────────────────────────────────────────────────────

/** Raw shape returned by query service for `committee_link` resource type */
export interface CommitteeLinkQueryResult {
  uid: string;
  name: string;
  url?: string;
  created_at?: string;
  committee_uid?: string;
}

/** Raw shape returned by query service for `groupsio_artifact` resource type */
export interface GroupsIOArtifactQueryResult {
  artifact_id: string;
  group_id: number;
  project_uid?: string;
  committee_uid?: string;
  type?: string;
  filename?: string;
  link_url?: string;
  download_url?: string;
  media_type?: string;
  last_posted_at?: string;
  created_at: string;
}

/** Raw shape returned by query service for `v1_meeting_registrant` resource type */
export interface MeetingRegistrantQueryResult {
  meeting_id: string;
}

/** Raw shape returned by query service for `v1_past_meeting_participant` resource type */
export interface PastMeetingParticipantQueryResult {
  meeting_and_occurrence_id: string;
}

/** Raw shape returned by query service for `v1_past_meeting_transcript` resource type */
export interface PastMeetingTranscriptQueryResult {
  id: string;
  meeting_and_occurrence_id: string;
  meeting_id: string;
  title: string;
  start_time: string;
  created_at: string;
  recording_files?: { file_type?: string; download_url?: string }[];
  sessions?: { share_url?: string }[];
}

/** Raw shape returned by query service for `v1_past_meeting_summary` resource type */
export interface PastMeetingSummaryQueryResult {
  id: string;
  meeting_and_occurrence_id: string;
  meeting_id: string;
  summary_title?: string;
  zoom_meeting_topic?: string;
  summary_start_time?: string;
  created_at: string;
  /** Consolidated markdown of the summary (indexer contract field) */
  content?: string;
  /** Edited markdown content, takes precedence over content when present */
  edited_content?: string;
}

/** Raw shape returned by query service for `v1_past_meeting_recording` resource type */
export interface PastMeetingRecordingQueryResult {
  id: string;
  meeting_and_occurrence_id: string;
  meeting_id: string;
  title: string;
  start_time: string;
  created_at: string;
  recording_files?: { file_type?: string; play_url?: string }[];
  sessions?: { share_url?: string }[];
}

/**
 * Unified document row for the My Documents table.
 * Aggregates attachments across groups, meetings, and mailing lists.
 */
export interface MyDocumentItem {
  /** Unique identifier (source:uid) */
  id: string;
  /** Display name of the document */
  name: string;
  /** Where the document came from */
  source: MyDocumentSource;
  /** Foundation display name */
  foundationName: string;
  /** Foundation UID — undefined when the source has no associated foundation */
  foundationUid?: string;
  /** Committee/group name or meeting title */
  groupOrMeetingName: string;
  /** Committee UID or meeting ID */
  groupOrMeetingUid: string;
  /** ISO date string for display */
  date: string;
  /** URL for link-type documents */
  url?: string;
  /** Attachment UID for download */
  attachmentUid?: string;
  /** Meeting ID for upcoming meeting attachments */
  meetingId?: string;
  /** Past meeting occurrence ID for past meeting attachments */
  pastMeetingId?: string;
  /** Mailing list (groups.io) ID for mailing list attachments */
  mailingListId?: string;
  /** File extension or MIME type for icon display (e.g., 'pdf', 'pptx') */
  fileType?: string;
  /** Raw markdown content for summary-type documents — used by the preview dialog */
  summaryContent?: string;
  /** Summary record UID — used by the preview dialog to support edit/approve actions */
  summaryUid?: string;
}
