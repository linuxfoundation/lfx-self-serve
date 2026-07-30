// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Default WG Weekly Brief throttle counters.
 *
 * Used by both the BFF (`apps/lfx-one/src/server/services/weekly-brief.service.ts`)
 * and the Angular client (`apps/lfx-one/src/app/shared/services/weekly-brief.service.ts`)
 * for empty-envelope fallbacks. The runtime `window_resets_at` is computed at the
 * call site (Sunday→Saturday UTC on the server, empty string on the client fallback)
 * and is intentionally not part of this constant.
 *
 * Policy: 2 fresh generates and 3 regenerations per rolling week.
 */
export const WEEKLY_BRIEF_DEFAULT_THROTTLE = {
  generates_used: 0,
  generates_limit: 2,
  regenerations_used: 0,
  regenerations_limit: 3,
} as const;
