// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type WeeklyBriefState = 'empty' | 'generating' | 'generated' | 'edited' | 'approved' | 'error';

export type WeeklyBriefSourceType = 'meeting' | 'vote' | 'member' | 'mailing_list';

export interface WeeklyBriefSourceRef {
  claim_id: string;
  source_type: WeeklyBriefSourceType;
  source_uid: string;
  source_label?: string;
  source_url?: string;
}

export interface WeeklyBrief {
  uid: string;
  committee_uid: string;
  window_start: string; // ISO8601 UTC Sunday 00:00:00
  window_end: string; // ISO8601 UTC Saturday 23:59:59
  state: WeeklyBriefState;
  brief_text: string;
  source_refs: WeeklyBriefSourceRef[];
  prompt_version: string;
  model: string;
  regeneration_count: number;
  private_source_present: boolean;
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface WeeklyBriefThrottle {
  generates_used: number;
  generates_limit: number;
  regenerations_used: number;
  regenerations_limit: number;
  window_resets_at: string;
}

export interface WeeklyBriefCurrentResponse {
  brief: WeeklyBrief | null;
  throttle: WeeklyBriefThrottle;
}

export interface GenerateWeeklyBriefRequest {
  reason?: string;
  revision?: number;
  force?: boolean;
}

export interface GenerateWeeklyBriefResponse {
  brief: WeeklyBrief;
  throttle: WeeklyBriefThrottle;
}

export interface SaveWeeklyBriefRequest {
  brief_text: string;
  revision: number;
}
