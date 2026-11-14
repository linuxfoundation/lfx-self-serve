// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PastMeeting } from '../interfaces/meeting.interface';

/**
 * Allowlist for anonymous full-access responses from `GET /public/api/meetings/past/:id`.
 * Organizer identity is authenticated-visible (LFXV2-2802, lfx-self-serve-ops#51).
 * A field added upstream must be named here before an anonymous caller can see it.
 *
 * Kept in its own runtime-leaf file with only a type import so specs that mock the
 * constants barrel can import the real list by relative path instead of copying it.
 */
export const PUBLIC_ANONYMOUS_PAST_MEETING_KEYS = [
  'id',
  'meeting_id',
  'meeting_and_occurrence_id',
  'project_uid',
  'project_name',
  'committees',
  'title',
  'description',
  'visibility',
  'restricted',
  'meeting_type',
  'password',
  'start_time',
  'scheduled_start_time',
  'scheduled_end_time',
  'duration',
  'recurrence',
  'occurrences',
  'cancelled_occurrences',
  'early_join_time_minutes',
  'show_meeting_attendees',
  'recording_enabled',
  'transcript_enabled',
  'youtube_upload_enabled',
  'ai_summary_enabled',
  'is_invite_responses_enabled',
  'registrant_count',
  'registrants_accepted_count',
  'registrants_declined_count',
  'registrants_pending_count',
  'organizer',
] as const satisfies readonly (keyof PastMeeting)[];
