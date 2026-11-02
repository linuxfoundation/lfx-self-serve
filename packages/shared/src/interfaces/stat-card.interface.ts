// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Direction of a period-over-period delta on a stat card, drives arrow icon + color. */
export type StatCardDeltaDirection = 'up' | 'down' | 'flat';

/** Valid column counts for `lfx-stat-card-grid`'s `columns` input — keys `GRID_COLS_CLASS`/`GRID_DIVIDER_CLASS`. */
export type StatCardGridColumns = 2 | 3 | 4 | 5;

/** Optional period-over-period delta rendered below a stat card's value. */
export interface StatCardDelta {
  /** Text rendered next to the delta arrow (e.g., "+8% vs. prior period"). */
  label: string;
  direction: StatCardDeltaDirection;
  /** Flips the color mapping (up renders red, down emerald) while the arrow keeps numeric direction — for metrics where an increase is bad (e.g. negative sentiment). */
  inverted?: boolean;
}

/** A visible button rendered under a stat card's text; a click emits the grid's `actionClick` with `action`. */
export interface StatCardCta {
  label: string;
  /** Key emitted through `actionClick` when the button is clicked. */
  action: string;
  /** Optional Font Awesome class string rendered before the label. */
  icon?: string;
  /** Renders the button in PrimeNG's text (borderless) style instead of outlined. */
  text?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}

/** One slice of a stat card's progress bar. */
export interface StatCardProgressSegment {
  /** Share of the full bar, 0-100. */
  percentage: number;
  /** Tailwind background class for the segment (e.g., "bg-blue-500"). */
  className: string;
}

/** Optional segmented progress bar rendered below a stat card's label. */
export interface StatCardProgress {
  segments: StatCardProgressSegment[];
  /** Accessible description of the bar, which is exposed as a single image. */
  ariaLabel: string;
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
  /** Optional keyed action; absent cells remain display-only. */
  action?: string;
  selected?: boolean;
  disabled?: boolean;
  /** Optional visible buttons under the text; a cell with ctas never renders as a whole-cell button. */
  ctas?: StatCardCta[];
  /** Optional segmented progress bar under the label. */
  progress?: StatCardProgress;
  /** Optional Tailwind class string replacing the default caption color classes of `subLine`. */
  subLineClass?: string;
}
