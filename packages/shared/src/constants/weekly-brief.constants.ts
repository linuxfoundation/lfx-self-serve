// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { WeeklyBriefSourceSection, WeeklyBriefState } from '../interfaces/weekly-brief.interface';

/**
 * Brief states a "Share to Mailing List" action may fire from — i.e. states
 * with saved brief_text worth sending. Excludes `empty`, `generating`, and
 * `error`. Also reused (LFXV2-3042) as the states a brief may be rated in —
 * both actions require reviewable saved content, so the same set applies.
 */
export const WEEKLY_BRIEF_SHAREABLE_STATES: readonly WeeklyBriefState[] = ['generated', 'edited', 'approved'] as const;

/**
 * Default WG Weekly Brief throttle counters.
 *
 * Used by the BFF (`apps/lfx-one/src/server/services/weekly-brief.service.ts`) for
 * its mock-mode envelope. The runtime `window_resets_at` is computed at the call
 * site and is intentionally not part of this constant.
 *
 * Policy: 2 fresh generates and 3 regenerations per fixed Sunday–Saturday
 * calendar week (matches `WeeklyBrief.window_start`/`.window_end`) — not a
 * rolling 7-day window. Upstream keys the throttle entry on the same
 * `window_start` as the brief itself, so counters actually reset at the
 * Friday→Saturday 00:00 UTC window rollover. `window_resets_at`
 * (`nextSundayIso()` in mock mode) is the advisory display timestamp
 * upstream surfaces in 429 bodies — next Sunday 00:00 UTC — not the real
 * counter-reset boundary.
 */
export const WEEKLY_BRIEF_DEFAULT_THROTTLE = {
  generates_used: 0,
  generates_limit: 2,
  regenerations_used: 0,
  regenerations_limit: 3,
} as const;

/** Mirrors upstream's `brief_text` bound (`UpdateCurrentWeeklyBriefRequestBody`: maxLength 20000, non-empty). */
export const WEEKLY_BRIEF_TEXT_MAX_LENGTH = 20_000;

/** Max AI-extracted action items surfaced per brief revision (LFXV2-3043) — guards against an overlong Pending Actions list and bounds AI spend per extraction. */
export const WEEKLY_BRIEF_ACTION_ITEMS_MAX = 5;

/** Max character length of an extracted action item's `text` (LFXV2-3043). Also passed as the JSON schema's `maxLength` hint to the model, but enforced defensively server-side too — the schema bound is a request to the model, not a guarantee about its response. */
export const WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH = 300;

/** Max character length of an extracted action item's `suggested_owner_role` (LFXV2-3043). Same defense-in-depth rationale as `WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH`. */
export const WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH = 100;

/**
 * Generation is async upstream (202/generating; the LLM call runs out-of-band) — the
 * card polls GET /current on this interval, up to this many attempts, until the brief
 * reaches a terminal state. 4s x 20 attempts = ~80s cap.
 */
export const WEEKLY_BRIEF_POLL_INTERVAL_MS = 4000;
export const WEEKLY_BRIEF_MAX_POLL_ATTEMPTS = 20;

/** States a poll of GET /current should stop on — everything else (`empty`, `generating`) keeps it running. */
export const WEEKLY_BRIEF_TERMINAL_STATES: ReadonlySet<WeeklyBriefState> = new Set(['generated', 'edited', 'approved', 'error']);

/**
 * `WeeklyBrief.error_reason` values the UI treats specially. Currently only `NO_SOURCES`
 * (the committee had no activity in the lookback window, not a genuine generation
 * failure) — any other value or absence renders the generic failure state. See
 * `WeeklyBriefErrorReason` in `weekly-brief.interface.ts` for the derived type.
 */
export const WEEKLY_BRIEF_ERROR_REASON = { NO_SOURCES: 'no_sources' } as const;

/** Number of past briefs fetched per page in the archive drawer (LFXV2-3046). The BFF caps all limit values at 50. */
export const WEEKLY_BRIEF_ARCHIVE_PAGE_SIZE = 10;

/**
 * Raw `source_refs` count above which the weekly-brief card's Sources row collapses behind a
 * `Sources (N)` disclosure toggle instead of rendering every chip flat (LFXV2-3335). At or
 * below this threshold there's no disclosure wrapper and no kind-sections — just the flat row,
 * same as before this feature existed. Per-(kind, label) dedupe grouping (see
 * `mapWeeklyBriefSourceRefsToChips`) still applies at every count, threshold or not; a size-1
 * group renders unchanged either way, so this only matters when duplicate labels are present.
 *
 * Deliberately gated on the raw ref count, not the deduped `sourceChips().length` — matches
 * the ticket's own worked example (a 16-ref week still shows "Sources (16)" pre-expansion,
 * even though several of those refs dedupe down to one grouped chip once revealed). The
 * disclosure and the dedupe solve two different problems (row height vs. duplicate-looking
 * chips) and are gated independently on purpose, even though a heavily-duplicated week can hit
 * both at once.
 */
export const WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD = 5;

/**
 * Fixed display order and section labels for the weekly-brief card's expanded Sources
 * disclosure (LFXV2-3335) — an array (not a `Record`) because iteration order is the whole
 * point. Kept here rather than in `weekly-brief.utils.ts` alongside `SOURCE_REF_ICONS` /
 * `SOURCE_REF_DEFAULT_LABELS`: those two are keyed for icon/default-label *resolution* per
 * ref (any order), this one is *display sequence* (order matters, and "members" ranks last
 * here despite sorting mid-pack alphabetically) — different concerns that happen to share a
 * key set today, not the same lookup table split across files. A `kind` missing from this
 * list still renders, grouped under the component's "Other" catch-all section.
 */
export const WEEKLY_BRIEF_SOURCE_SECTIONS: readonly WeeklyBriefSourceSection[] = [
  { kind: 'meeting', label: 'Meetings' },
  { kind: 'vote', label: 'Votes' },
  { kind: 'mailing-list', label: 'Mailing List' },
  { kind: 'doc', label: 'Documents' },
  { kind: 'members', label: 'Membership' },
] as const;

/**
 * Verb phrasing for the "this week so far" activity-tally caption (GH-1922) — one entry per
 * `WEEKLY_BRIEF_SOURCE_SECTIONS` kind. Kept separate from that constant because the two solve
 * different problems: `WEEKLY_BRIEF_SOURCE_SECTIONS` is a noun *label* for a disclosure section
 * heading ("Meetings"), this is a verb *phrase* for a count sentence ("1 meeting held" / "2
 * meetings held") — singular/plural forms a section label doesn't need.
 */
export const WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES: readonly { kind: string; singular: string; plural: string }[] = [
  { kind: 'meeting', singular: 'meeting held', plural: 'meetings held' },
  { kind: 'vote', singular: 'vote closed', plural: 'votes closed' },
  { kind: 'mailing-list', singular: 'mailing-list post', plural: 'mailing-list posts' },
  { kind: 'doc', singular: 'document added', plural: 'documents added' },
  { kind: 'members', singular: 'membership change', plural: 'membership changes' },
] as const;
