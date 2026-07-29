// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Time windows the committee-member engagement warehouse model is built for (LFXV2-1705), and
 * therefore the only values `GET /api/committees/:uid/engagement` accepts for `?window=`.
 */
export const COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS = ['30d', '90d', 'ytd'] as const;

/** Window used when the `window` query parameter is omitted. */
export const COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW = '30d';

/**
 * Attendance-rate thresholds (attended / invited) for engagement classification, computed in the
 * BFF so they can be tuned without a dbt deploy once real distributions are observed.
 *   rate <= 0            → Inactive (never invited, or invited but attended nothing)
 *   0 < rate < medium     → Low
 *   medium <= rate < high → Medium
 *   rate >= high          → High
 */
export const COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS = {
  high: 0.75,
  medium: 0.4,
} as const;
