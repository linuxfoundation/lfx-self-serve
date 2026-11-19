// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsBarFillRule } from '../interfaces/health-metrics-table.interface';

// ── Table layout and cells ─────────────────────────────────────────────────

/** The redesign shrinks every column minimum to 72% of its old pixel value. */
export const HEALTH_METRICS_TABLE_COLUMN_SCALE = 0.72;

/** A table's minimum width never goes past this; wider content scrolls inside the card. */
export const HEALTH_METRICS_TABLE_MIN_WIDTH_CAP_PX = 700;

/** The "no value" text a cell shows, in neutral-400. */
export const HEALTH_METRICS_TABLE_DASH = '—';

/** What an unfiltered table with no rows says; a tab may give its own copy. */
export const HEALTH_METRICS_TABLE_EMPTY_TEXT = 'Nothing matches this view.';

/** The value-and-bar cell's default fill: neutral at 0%, danger under 20%, warning under 50%, accent otherwise. */
export const HEALTH_METRICS_VALUE_BAR_FILL: HealthMetricsBarFillRule = {
  zeroClass: 'bg-gray-300',
  thresholds: [
    { below: 20, fillClass: 'bg-red-500' },
    { below: 50, fillClass: 'bg-amber-500' },
  ],
  defaultClass: 'bg-blue-500',
};

/** The bar-under-value and goal-bar cells' default fill. */
export const HEALTH_METRICS_PROGRESS_BAR_FILL_CLASS = 'bg-blue-500';

// ── Sorting ────────────────────────────────────────────────────────────────

/** Membership tiers from the highest rank to the lowest, as the design sorts them; any other named tier ranks above Non-member. */
export const HEALTH_METRICS_SORT_TIER_ORDER: readonly string[] = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Associate', 'End User Supporter', 'Non-member'];

/** The whitespace JavaScript's `trim()` removes, as code points, so the server trims a sort value the same way. */
export const HEALTH_METRICS_SORT_TRIM_CODE_POINTS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000, 0xfeff,
];

/** "Dormant" attendance as a sort value: below every rate, including 0%. */
export const HEALTH_METRICS_SORT_DORMANT_VALUE = -1;

// ── Truncation tooltip ─────────────────────────────────────────────────────

/** Milliseconds between hover or keyboard focus on cut-off text and its full-text tooltip; the uikit tooltip's default. */
export const HEALTH_METRICS_TRUNCATION_TIP_DELAY_MS = 300;

/** Milliseconds the pointer may spend crossing from the text to the tooltip before it closes. */
export const HEALTH_METRICS_TRUNCATION_TIP_GRACE_MS = 100;

/** Distance between the cut-off text and its tooltip, in px. */
export const HEALTH_METRICS_TRUNCATION_TIP_GAP_PX = 6;

/** Overflow in px still counted as fitting: `scrollWidth` and `clientWidth` round fractional widths apart by up to 1px. */
export const HEALTH_METRICS_TRUNCATION_TIP_TOLERANCE_PX = 1;
