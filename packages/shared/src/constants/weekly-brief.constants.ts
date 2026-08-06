// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { WeeklyBriefState } from '../interfaces/weekly-brief.interface';

/**
 * Brief states a "Share to Mailing List" action may fire from — i.e. states
 * with saved brief_text worth sending. Excludes `empty`, `generating`, and
 * `error`.
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
