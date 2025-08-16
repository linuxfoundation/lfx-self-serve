// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility, RecurrenceType } from '../enums';

export interface MeetingRecurrence {
  end_date_time?: string;
  end_times?: number;
  monthly_day?: number;
  monthly_week?: number;
  monthly_week_day?: number;
  repeat_interval: number;
  type: RecurrenceType;
  weekly_days?: string;
}

export interface MeetingCommittee {
  uid: string;
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

export interface DeleteMeetingRequest {
  deleteType?: 'single' | 'series';
}
