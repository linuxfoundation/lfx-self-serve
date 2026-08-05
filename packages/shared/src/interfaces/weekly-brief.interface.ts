// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type WeeklyBriefState = 'empty' | 'generating' | 'generated' | 'edited' | 'approved' | 'error';

/**
 * Matches upstream's `GroupWeeklyBriefSourceRef` exactly — `kind` is an open
 * string (not an enum; documented values include "meeting", "mailing-list",
 * "doc"), not the invented `source_type` shape this used to have. Upstream
 * marks nothing Required on this type, and the committee-service converter
 * omits `title`/`excerpt` when empty — the BFF forwards this object
 * unchanged, so both stay optional here rather than promising a string that
 * may not be present on the wire.
 */
export interface WeeklyBriefSourceRef {
  excerpt?: string;
  id: string;
  kind: string;
  title?: string;
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
  /** Set once the brief has been edited via PUT /current; absent if never edited. */
  last_edited_at?: string;
  /** LFX username of the caller who last edited the brief. */
  last_edited_by?: string;
  /**
   * Set when `state` is 'error' and upstream identified a specific cause.
   * Currently only "no_sources" (committee had no activity in the lookback
   * window) is meaningful to the UI; any other value or absence renders the
   * generic failure state. Populated via extractBriefErrorReason() in
   * weekly-brief.service.ts — see TODO(LFXV2-2989) there for the pinned field
   * name once upstream ships it.
   */
  error_reason?: string;
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
  /** Null alongside a null `brief` on a genuine miss — upstream's `GET /current` never fabricates counters. */
  throttle: WeeklyBriefThrottle | null;
}

/**
 * Matches upstream's `GenerateWeeklyBriefRequestBody` exactly — `force` is
 * the only field the Go service accepts. There is no client-supplied
 * revision: conflict detection is entirely server-side (409
 * `edited_brief_exists` with the current `revision` in the error body when
 * an edited brief exists and `force` isn't set).
 */
export interface GenerateWeeklyBriefRequest {
  force?: boolean;
}

export interface GenerateWeeklyBriefResponse {
  /** Upstream's `GroupWeeklyBriefGenerateResult` marks nothing Required — the BFF reads this defensively. */
  brief?: WeeklyBrief;
  throttle?: WeeklyBriefThrottle;
}

export interface SaveWeeklyBriefRequest {
  brief_text: string;
  revision: number;
}

/**
 * `total_recipients` is a recipient-count snapshot taken at send-acceptance
 * time — the underlying newsletter send is asynchronous (202 Accepted; fan-out
 * completes in a detached background job), so there is no synchronous
 * sent/failed count to report here. The zero-recipient case settles
 * synchronously with `total_recipients: 0` and no email dispatched.
 */
export interface ShareWeeklyBriefResult {
  committee_name: string;
  total_recipients: number;
}
