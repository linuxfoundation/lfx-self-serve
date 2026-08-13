// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Format a number for display using compact notation.
 * - Handles negative numbers, NaN, and Infinity gracefully
 * - Numbers >= 999,950,000 are displayed as "X.XB"
 * - Numbers >= 999,950 are displayed as "X.XM"
 * - Numbers >= 1,000 are displayed as "X.XK"
 * - Smaller numbers use locale-formatted strings
 */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return '0';
  return formatCompact(Math.abs(num), num < 0 ? '-' : '');
}

/**
 * Format a number as currency (USD) using compact notation.
 * - Handles negative numbers, NaN, and Infinity gracefully
 * - Numbers >= 999,950,000 are displayed as "$X.XB"
 * - Numbers >= 999,950 are displayed as "$X.XM"
 * - Numbers >= 1,000 are displayed as "$X.XK"
 * - Smaller numbers use locale-formatted strings with "$" prefix
 */
export function formatCurrency(num: number): string {
  if (!Number.isFinite(num)) return '$0';
  return formatCompact(Math.abs(num), num < 0 ? '-' : '', '$');
}

/**
 * Format a monetary value-lost figure using compact notation.
 * Suitable for displaying churn, refund, or write-off amounts.
 * - Handles negative numbers, NaN, and Infinity gracefully
 * - Values >= 999,950,000 are displayed as "$X.XB"
 * - Values >= 999,950 are displayed as "$X.XM"
 * - Values >= 1,000 are displayed as "$X.XK"
 * - Smaller values use locale-formatted strings with "$" prefix
 */
export function formatValueLost(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  return formatCompact(Math.abs(value), value < 0 ? '-' : '', '$');
}

/**
 * Format a percentage for display to a single decimal place.
 * Raw rates arrive from Snowflake at full float precision (e.g. 94.919659091),
 * so anything interpolated into user-facing copy must go through this.
 * - Handles NaN and Infinity gracefully
 * - Normalizes negative zero so "-0.0%" never renders
 * - Returns the number only; callers add the "%" suffix
 * - `digits` defaults to 1. Pass 2 for rates that live below 1% — paid CTR and conversion rate
 *   are routinely 0.04%, which one decimal erases to "0.0" and misreports as a measured zero.
 *   The server keeps two decimals for those fields precisely so the UI can show them.
 */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  const rounded = Number(value.toFixed(digits));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits);
}

/** Centralized compact formatter — thresholds, scales, and rounding in one place.
 *  Locale is pinned to en-US: this runs during SSR (Node) and in the browser,
 *  and an unpinned toLocaleString() renders different separators per client
 *  locale, causing hydration text mismatches. */
export function formatCompact(abs: number, sign: string, prefix = ''): string {
  if (abs >= 999_950_000) return `${sign}${prefix}${stripTrailingZero((abs / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 999_950) return `${sign}${prefix}${stripTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${prefix}${stripTrailingZero((abs / 1_000).toFixed(1))}K`;
  return `${sign}${prefix}${abs.toLocaleString('en-US')}`;
}

/**
 * Format a compact figure rounded to at most one decimal place.
 * The compact branches (K/M/B) already round to one decimal, but the sub-1000 branch
 * renders whatever precision it is handed — so derived values like CPA arrive as
 * "586.302…". Use this for computed/derived figures; use the plain formatters for
 * exact amounts (e.g. cents-denominated currency) where dropping a decimal would
 * misstate the value.
 */
export function formatCompactRounded(num: number, prefix = ''): string {
  if (!Number.isFinite(num)) return `${prefix}0`;
  // toFixed, not Math.round: Math.round resolves halves toward +Infinity, so -3.75 would round to
  // -3.7 while 3.75 rounds to 3.8 — understating negative derived values. toFixed rounds away
  // from zero on both signs, matching formatPercent.
  const rounded = Number(num.toFixed(1));
  return formatCompact(Math.abs(rounded), rounded < 0 ? '-' : '', prefix);
}

/** Strip trailing zeros (and a dangling decimal point) from a fixed-decimal string. */
function stripTrailingZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
