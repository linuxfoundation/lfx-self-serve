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
 * `action: null` on a chip with no `group` means it renders unlinked — no resolvable click
 * target for that `kind` (e.g. "mailing-list", which has no archive URL anywhere in this
 * contract, or an unrecognized future `kind`). A chip *with* `group` also always has
 * `action: null`, but for a different reason: it's not unlinked, it's a toggle button — the
 * click opens `group.instances` rather than navigating, and each of those instances carries its
 * own real `action` instead. `kind` is copied straight from the source `WeeklyBriefSourceRef` so
 * the template can group chips into kind-sections without resolving it again (frontend-checklist §4).
 */
export interface WeeklyBriefSourceChip {
  id: string;
  label: string;
  icon: string;
  kind: string;
  action: WeeklyBriefSourceChipAction | null;

  /**
   * Present when this chip represents 2+ source refs collapsed under the same kind+label —
   * e.g. 12 instances of a recurring meeting. Absent for a chip backed by a single,
   * unique source ref, which renders exactly as it did before this field existed.
   */
  group?: {
    count: number;
    /** Precomputed "label (count)" display string for the group chip's tag — kept off the
     *  template, which only reads signals/computeds (frontend-checklist §4). */
    badgeLabel: string;
    /** Individual chips for level-2 expansion, each with its own action; label suffixed
     *  with an ordinal (" #1", " #2", ...) in source_refs order — WeeklyBriefSourceRef has
     *  no date field to sort/label by, see LFXV2-3335. */
    instances: WeeklyBriefSourceChip[];
  };
}

/**
 * One entry of `WEEKLY_BRIEF_SOURCE_SECTIONS` (`../constants/weekly-brief.constants`) — the
 * fixed display order/label for a Sources-disclosure kind-section. Kept alongside
 * `WeeklyBriefSourceChipSection` below since the two shapes are the same concept before and
 * after `sourceChips()` is filtered into each section (LFXV2-3335).
 */
export interface WeeklyBriefSourceSection {
  kind: string;
  label: string;
}

/** A `WeeklyBriefSourceSection` populated with the chips that fell into it (LFXV2-3335). */
export interface WeeklyBriefSourceChipSection extends WeeklyBriefSourceSection {
  chips: WeeklyBriefSourceChip[];
}

/**
 * A `WeeklyBriefSourceSection` populated with one kind's non-zero refs from
 * `WeeklyBriefCurrentActivity.source_refs`, plus the precomputed verb-phrase count text for
 * that kind (e.g. "1 meeting held") — the "this week so far" tally's analog to
 * `WeeklyBriefSourceChipSection` (GH-1922). Omitted entirely (not zero-length) for a kind with
 * no activity — `weekly-brief-card.component.ts`'s `currentActivity` (built by
 * `initCurrentActivitySections`) only returns non-zero kinds, same filtering
 * `initSourceChipSections` already does for the Sources row.
 */
export interface WeeklyBriefCurrentActivitySection extends WeeklyBriefSourceSection {
  refs: WeeklyBriefSourceRef[];
  countText: string;
}

/**
 * Verb-phrase singular/plural for one activity kind in the "this week so far" tally caption
 * (GH-1922) — see `WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES`'s own doc comment for the full
 * membership/ordering/label contract, including the "recognized kinds only" scope of this list
 * and the trailing `other` catch-all for the kinds it doesn't cover — not restated here to avoid
 * the two drifting apart.
 */
export interface WeeklyBriefCurrentActivityPhrase {
  kind: string;
  singular: string;
  plural: string;
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
   * per-user rating store, not upstream — see `weekly-brief.service.ts#fetchBriefResponse`.
   */
  caller_rating?: WeeklyBriefRating | null;
  /**
   * BFF-side enrichment (not part of upstream's contract, same as `caller_rating`): a raw
   * count of activity in the current, not-yet-closed week — distinct from `brief`'s own
   * completed-week window (GH-1922). Sourced from `CommitteeActivityService`'s existing live
   * meeting/vote/document aggregation (not a weekly-brief-specific upstream call), so it's
   * populated identically in mock and live mode — see
   * `weekly-brief.service.ts#buildCurrentActivity`. Three states, not two — `null` and absent
   * are deliberately distinct:
   *   - **Absent** (key not present at all): two distinct classes of cause, only one worth
   *     re-asking for. Either `buildCurrentActivity` genuinely couldn't produce an answer (see
   *     that method's own doc comment for its three actual causes) — transient, worth asking
   *     again on a governance committee, up to `WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS`
   *     poll ticks; OR the caller deliberately asked the BFF to skip the fan-out via
   *     `includeCurrentActivity: false` (GH-1922 cost optimization —
   *     `weekly-brief-card.component.ts` does this on every non-poll load for any committee it
   *     already knows isn't governance-classified, since the tally section can never render for
   *     one regardless) — never worth re-asking for. A caller re-asking on absent must also check
   *     whether asking is worthwhile at all — see `weekly-brief-card.component.ts`'s `pollUntilTerminal`,
   *     which additionally gates on `isGoverningBoardCommittee()` for exactly this reason.
   *   - **`null`**: known, definitively, not to apply — the committee isn't
   *     governance-classified, or the current week's activity exceeds what a single upstream
   *     page can return (never a silently-truncated count). Not transient; re-asking within the
   *     same poll cycle can't change either answer, so a caller that retries on any falsy value
   *     without checking for this distinction (e.g. `weekly-brief-card.component.ts`'s
   *     `pollUntilTerminal`) would spend calls forever for no reason.
   *   - **Present**: the real tally, possibly with an empty `source_refs` (a genuine quiet week
   *     — still a real answer, not absence).
   */
  current_activity?: WeeklyBriefCurrentActivity | null;
}

/** See `WeeklyBriefCurrentResponse.current_activity`. */
export interface WeeklyBriefCurrentActivity {
  window_start: string;
  window_end: string;
  source_refs: WeeklyBriefSourceRef[];
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
 * The committee-service composes and sends the Slack message itself (lfx-v2-committee-service
 * PR #178 / LFXV2-3094), responding `204 No Content` on success — there is nothing to report
 * back beyond a resolved promise meaning Slack accepted the message. Empty on purpose, not a
 * placeholder: the Angular success handler never read `committee_name` even when this interface
 * carried it, and this BFF no longer fetches the committee for its own sake to populate it.
 */
export type ShareWeeklyBriefToSlackResult = Record<string, never>;

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
