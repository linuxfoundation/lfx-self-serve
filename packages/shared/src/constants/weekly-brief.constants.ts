// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Default WG Weekly Brief throttle counters.
 *
 * Used by the BFF (`apps/lfx-one/src/server/services/weekly-brief.service.ts`) for
 * its mock-mode envelope. The runtime `window_resets_at` is computed at the call
 * site and is intentionally not part of this constant.
 *
 * Policy: 2 fresh generates and 3 regenerations per rolling week.
 */
export const WEEKLY_BRIEF_DEFAULT_THROTTLE = {
  generates_used: 0,
  generates_limit: 2,
  regenerations_used: 0,
  regenerations_limit: 3,
} as const;

/** Mirrors upstream's `brief_text` bound (`UpdateCurrentWeeklyBriefRequestBody`: maxLength 20000, non-empty). */
export const WEEKLY_BRIEF_TEXT_MAX_LENGTH = 20_000;
