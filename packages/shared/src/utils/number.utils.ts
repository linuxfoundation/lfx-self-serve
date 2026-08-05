// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Format a number for display using compact notation.
 * - Handles negative numbers, NaN, and Infinity gracefully
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
 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const rounded = Number(value.toFixed(1));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

/** Centralized compact formatter — thresholds, scales, and rounding in one place.
 *  Locale is pinned to en-US: this runs during SSR (Node) and in the browser,
 *  and an unpinned toLocaleString() renders different separators per client
 *  locale, causing hydration text mismatches. */
export function formatCompact(abs: number, sign: string, prefix = ''): string {
  if (abs >= 999_950) return `${sign}${prefix}${stripTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${prefix}${stripTrailingZero((abs / 1_000).toFixed(1))}K`;
  return `${sign}${prefix}${abs.toLocaleString('en-US')}`;
}

/** Strip trailing zeros (and a dangling decimal point) from a fixed-decimal string. */
function stripTrailingZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
