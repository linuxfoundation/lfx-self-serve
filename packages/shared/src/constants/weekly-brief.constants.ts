// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { WeeklyBriefCurrentActivityPhrase, WeeklyBriefSourceSection, WeeklyBriefState } from '../interfaces/weekly-brief.interface';

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

/**
 * Caps how many poll ticks (GH-1922) keep asking the BFF to rebuild `current_activity` while it
 * stays absent (`undefined` — see `WeeklyBriefCurrentResponse.current_activity`'s doc comment).
 * That fan-out isn't free — a governance committee's tally costs an upstream committee read plus
 * `CommitteeActivityService`'s own multi-call aggregation — and a persistently failing upstream
 * would otherwise get asked again on every one of `WEEKLY_BRIEF_MAX_POLL_ATTEMPTS` ticks for an
 * answer that keeps failing the same way. Deliberately smaller than that cap: this only bounds the
 * *tally's* self-heal retries, not the brief's own terminal-state poll, which keeps running
 * regardless — a card can still finish generating and simply render without the "this week so
 * far" line once this is exhausted.
 *
 * Known v1 gap this cap doesn't cover: `pollUntilTerminal` (where this budget lives) only runs
 * while the brief itself is `generating` — a page load onto an already-terminal brief (the far
 * more common case) never invokes it at all. A transient `current_activity` degrade on that load
 * has no self-heal PURPOSE-BUILT for it — nothing in `weekly-brief-card.component.ts` exists to
 * retry the tally specifically. It can still recover incidentally, any time something else causes
 * `initBriefResponseSubscription`'s GET to re-run (a navigation, a reload, `refresh$`, or a
 * visible retry control in another render branch) — deliberately not enumerated here, since which
 * call sites/buttons do that is exactly the kind of detail that drifts out of sync with its
 * source as the component evolves; see that file's own call sites for the current list. Not
 * solved by this constant — a real fix would need `initBriefResponseSubscription` to kick off its
 * own bounded re-ask, independent of the generating-poll's budget.
 */
export const WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS = 3;

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
 * Verb phrasing for the "this week so far" activity-tally caption (GH-1922) — the single source
 * of truth for which kinds the tally recognizes, their display order, and their singular/plural
 * count text ("1 meeting held" / "2 meetings held"). Kept separate from
 * `WEEKLY_BRIEF_SOURCE_SECTIONS` because the two solve different problems: that constant is a
 * noun *label* for a disclosure section heading ("Meetings"), this is a verb *phrase* for a
 * count sentence — but `weekly-brief-card.component.ts` drives the tally's sections from THIS
 * list alone (not by cross-referencing `WEEKLY_BRIEF_SOURCE_SECTIONS` by kind), so a kind
 * missing here can never render a phrase-less, blank-labeled toggle — see
 * `WeeklyBriefCurrentActivityPhrase`'s doc comment.
 *
 * `mailing-list` and `members` are forward-declared, not currently reachable: the server-side
 * builder (`weekly-brief.service.ts#buildCurrentActivity`) sources `source_refs` from
 * `CommitteeActivityService`, which has no mailing-list leg at all (tracked upstream —
 * linuxfoundation/lfx-self-serve#1934) and never constructs a `member_joined`/`member_left`
 * event (a known, permanently-deferred v1 limitation, not a tracked issue — no upstream
 * membership-timestamp/deletion-history signal to build one from). A week whose only real
 * activity was on one of these two kinds still renders "no activity yet" — an accepted v1 gap in
 * what the tally can attest to, not a claim that no such activity occurred.
 */
export const WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES: readonly WeeklyBriefCurrentActivityPhrase[] = [
  { kind: 'meeting', singular: 'meeting held', plural: 'meetings held' },
  { kind: 'vote', singular: 'vote closed', plural: 'votes closed' },
  { kind: 'mailing-list', singular: 'mailing-list post', plural: 'mailing-list posts' },
  { kind: 'doc', singular: 'document added', plural: 'documents added' },
  { kind: 'members', singular: 'membership change', plural: 'membership changes' },
] as const;
