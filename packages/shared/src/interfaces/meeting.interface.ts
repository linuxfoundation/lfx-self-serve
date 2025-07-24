// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export enum MeetingVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  RESTRICTED = 'restricted',
}

export interface MeetingCommittee {
  id: string;
  name: string;
  committee_total_members: number;
}

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  first_name: string;
  last_name: string;
  email: string;
  organization: string | null;
  is_host: boolean;
  job_title: string | null;
  created_at: string;
  updated_at: string;
  type: 'individual' | 'committee';
  invite_accepted: boolean | null;
  attended: boolean | null;
}

export interface Meeting {
  id: string;
  created_at: string;
  project_id: number;
  visibility: MeetingVisibility | null;
  youtube_enabled: boolean | null;
  zoom_ai_enabled: boolean | null;
  recording_enabled: boolean | null;
  transcripts_enabled: boolean | null;
  timezone: string | null;
  meeting_type: string | null;
  recording_access: string | null;
  recurrence: Record<string, any> | null;
  topic: string | null;
  agenda: string | null;
  start_time: string | null;
  end_time: string | null;
  duration: number | null;
  status: string | null;
  meeting_committees: MeetingCommittee[] | null;
  individual_participants_count: number;
  committee_members_count: number;
  committees: string[];
}
