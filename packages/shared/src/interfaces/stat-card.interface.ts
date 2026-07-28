// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Direction of a period-over-period delta on a stat card, drives arrow icon + color. */
export type StatCardDeltaDirection = 'up' | 'down' | 'flat';

/** Optional period-over-period delta rendered below a stat card's value. */
export interface StatCardDelta {
  /** Text rendered next to the delta arrow (e.g., "+8% vs. prior period"). */
  label: string;
  direction: StatCardDeltaDirection;
}

/**
 * A single cell in an `lfx-stat-card-grid`.
 * @description Shared shape used by dashboards that surface a row of summary
 * counts (committee dashboard, mailing-list dashboard, etc.).
 */
export interface StatCardItem {
  /** Numeric or string value rendered at the top of the cell (replaced by an em-dash while loading). */
  value: number | string;
  /** Short descriptive label rendered below the value (e.g., "Total Groups"). */
  label: string;
  /** Optional muted line rendered below the label (e.g., "Next: Jul 2", "Across 3 projects"). */
  subLine?: string;
  /** Font Awesome class string for the icon (e.g., "fa-light fa-envelope"). */
  icon: string;
  /** Tailwind class string applied to the icon's rounded container (bg + text color). */
  iconContainerClass: string;
  /** Optional period-over-period delta (e.g., "+8% vs. prior period"). */
  delta?: StatCardDelta;
}
