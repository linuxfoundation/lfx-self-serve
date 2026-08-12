// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { WEEKLY_BRIEF_ERROR_REASON } from '../constants/weekly-brief.constants';
import type { PastMeetingActivityFeedAction, TabActivityFeedAction, VoteDrawerActivityFeedAction } from './activity-feed.interface';

export type WeeklyBriefState = 'empty' | 'generating' | 'generated' | 'edited' | 'approved' | 'error';

/** Recognized values of `WeeklyBrief.error_reason` — see `WEEKLY_BRIEF_ERROR_REASON`. */
export type WeeklyBriefErrorReason = (typeof WEEKLY_BRIEF_ERROR_REASON)[keyof typeof WEEKLY_BRIEF_ERROR_REASON];

/**
 * Matches upstream's `GroupWeeklyBriefSourceRef` exactly — `kind` is an open
 * string (not an enum; the Goa design's prose documents "meeting",
 * "mailing-list", "doc" as examples), not the invented `source_type` shape
 * this used to have. Upstream marks nothing Required on this type, and the
 * committee-service converter omits `title`/`excerpt` when empty — the BFF
 * forwards this object unchanged, so both stay optional here rather than
 * promising a string that may not be present on the wire.
 *
 * What `lfx-v2-committee-service`'s `group_weekly_brief_generator.go`
 * (`buildClaimsAndRefs`) actually emits today: "meeting", "mailing-list",
 * "vote", and "members" — never "doc" (a design-doc example only). Kept
 * mapped in `weekly-brief.utils.ts` anyway in case upstream starts sending
 * it; any other unrecognized `kind` — present or future — renders unlinked
 * rather than breaking.
 */
export interface WeeklyBriefSourceRef {
  excerpt?: string;
  id: string;
  kind: string;
  title?: string;
}

/**
 * What clicking a "Sources" chip does, for a `WeeklyBriefSourceRef` that resolves to a real
 * target. Reuses `ActivityFeedAction`'s `past-meeting`/`vote-drawer`/`tab` variants exactly
 * (LFXV2-3009's committee Overview activity feed already navigates through these same
 * mechanisms) rather than a narrower union that duplicates their shape. `vote-drawer` carries
 * the vote's own uid (`ref.id` for a "vote" kind) straight to `committee-overview.component.ts`'s
 * existing drawer-opening logic — including its cache-miss fetch-by-uid fallback and its own
 * "Vote unavailable, try the Votes tab instead" toast on a genuine fetch failure — rather than
 * dropping the id and routing to the generic Votes tab. `survey-drawer`/`external-url` still don't apply to any documented or observed
 * `source_refs` kind.
 */
export type WeeklyBriefSourceChipAction = PastMeetingActivityFeedAction | VoteDrawerActivityFeedAction | TabActivityFeedAction;

/**
 * Precomputed display view-model for one "Sources" chip under a weekly brief — built from a
 * `WeeklyBriefSourceRef` by `mapWeeklyBriefSourceRefsToChips` (`../utils/weekly-brief.utils`).
 * `action: null` means the chip renders unlinked (no resolvable click target for that `kind` —
 * e.g. "mailing-list", which has no archive URL anywhere in this contract, or an unrecognized
 * future `kind`).
 */
export interface WeeklyBriefSourceChip {
  id: string;
  label: string;
  icon: string;
  action: WeeklyBriefSourceChipAction | null;
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
 * the revision the caller actually saw when they tapped — the server rejects the write with a 409
 * (`REVISION_MISMATCH`) when it no longer matches the server-resolved current revision, so a
 * rating can never land on content the caller never actually reviewed (a co-chair's edit or
 * regenerate landing between page load and tap; see `weekly-brief.service.ts#rateBrief`'s doc
 * comment for the full reasoning, PR #1361 review).
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

/**
 * Unlike {@link ShareWeeklyBriefResult}, a Slack incoming webhook POST is synchronous — Slack
 * accepts or rejects the message in the same request, so there is no recipient-count/fan-out
 * concept to report here. A resolved promise means Slack accepted the message.
 */
export interface ShareWeeklyBriefToSlackResult {
  committee_name: string;
}

/**
 * An AI-extracted follow-up item from a brief's `brief_text` (LFXV2-3043). Extraction runs
 * lfx-one-side, once per `(source_brief_uid, revision)` pair, cached by the BFF — this record
 * has no independent `revision` field because a new revision produces an entirely new cached
 * set (and new `uid`s), not an update to this one.
 */
export interface WeeklyBriefActionItem {
  /** Deterministic per cached revision: `${committee_uid}-${source_brief_uid}-${revision}-${index}`. Committee-scoped because the mock-mode brief fixture reuses the same source_brief_uid across committees. */
  uid: string;
  /** Short, actionable follow-up text */
  text: string;
  /** Suggested owner role/persona, when the model could infer one */
  suggested_owner_role?: string;
  /** The brief this item was extracted from */
  source_brief_uid: string;
  /** The committee the brief belongs to */
  committee_uid: string;
}

export interface GetWeeklyBriefActionItemsResponse {
  items: WeeklyBriefActionItem[];
}
