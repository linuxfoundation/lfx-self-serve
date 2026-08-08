// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { WEEKLY_BRIEF_ERROR_REASON } from '../constants/weekly-brief.constants';

export type WeeklyBriefState = 'empty' | 'generating' | 'generated' | 'edited' | 'approved' | 'error';

/** Recognized values of `WeeklyBrief.error_reason` — see `WEEKLY_BRIEF_ERROR_REASON`. */
export type WeeklyBriefErrorReason = (typeof WEEKLY_BRIEF_ERROR_REASON)[keyof typeof WEEKLY_BRIEF_ERROR_REASON];

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
   * Set when `state` is 'error' and upstream identified a specific cause. `error_reason`
   * is a pinned part of the upstream contract (LFXV2-2989) — known values today are
   * "no_sources" and "ai_error". `WeeklyBriefErrorReason` values are the only ones the UI
   * treats specially; any other string or absence renders the generic failure state. The
   * BFF forwards this field through unchanged — no server-side mapping needed.
   *
   * `& {}` is the "open enum" idiom: it keeps `WeeklyBriefErrorReason`'s
   * literals as editor-suggested autocomplete without collapsing the whole
   * union to plain `string`, which a bare `WeeklyBriefErrorReason | string`
   * would do.
   */
  error_reason?: WeeklyBriefErrorReason | (string & {});
}

export interface WeeklyBriefThrottle {
  generates_used: number;
  generates_limit: number;
  regenerations_used: number;
  regenerations_limit: number;
  /**
   * Advisory display timestamp only (upstream `NextWindowReset()` — next Sunday 00:00 UTC).
   * Counters actually reset at the Fri→Sat window rollover, since upstream keys the throttle
   * entry on the same `window_start` as the brief itself.
   */
  window_resets_at: string;
}

export interface WeeklyBriefCurrentResponse {
  brief: WeeklyBrief | null;
  /** Null alongside a null `brief` on a genuine miss — upstream's `GET /current` never fabricates counters. */
  throttle: WeeklyBriefThrottle | null;
  /**
   * BFF-side enrichment (not part of upstream's contract): the calling user's own rating on
   * this specific `brief.uid` + `brief.revision`, or `null` if they haven't rated it (or no
   * `brief` was returned). Absent entirely when `brief` is null. Read from the BFF's
   * per-user rating store, not upstream — see `weekly-brief.service.ts#getCurrentBrief`.
   */
  caller_rating?: WeeklyBriefRating | null;
}

/** A caller's one-tap quality rating on a specific weekly-brief revision. BFF-only — no upstream equivalent. */
export type WeeklyBriefRating = 'up' | 'down';

/**
 * Request body for `POST /committees/:committeeId/weekly-briefs/:briefUid/rating`. `revision` is
 * the revision the caller actually saw when they tapped — the server always rates whatever
 * revision is current at write time (see `weekly-brief.service.ts#rateBrief`'s doc comment), so
 * this is never used to reject the write, only logged alongside the server-resolved revision on
 * `rating_recorded` so a rating attributed to content the rater never saw (a co-chair's edit or
 * regenerate landing between page load and tap) can be identified and excluded during offline
 * rating-by-prompt_version analysis.
 */
export interface RateWeeklyBriefRequest {
  rating: WeeklyBriefRating;
  revision: number;
}

/**
 * Response body for `POST /committees/:committeeId/weekly-briefs/:briefUid/rating` — also the
 * shape persisted in the caller's Valkey rating-cache entry (`buildWeeklyBriefRatingCacheKey`
 * / `weekly-brief.service.ts`'s `isStoredRating` guard), since the two are structurally the same
 * "what did they rate it" record.
 */
export interface RateWeeklyBriefResponse {
  rating: WeeklyBriefRating;
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
