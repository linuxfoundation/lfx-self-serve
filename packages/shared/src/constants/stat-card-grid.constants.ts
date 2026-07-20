// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Tailwind grid-column classes for `lfx-stat-card-grid`, keyed by its `columns` input. */
export const GRID_COLS_CLASS: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

/**
 * Tailwind divider classes for `lfx-stat-card-grid`, keyed by its `columns` input.
 * Columns 2 and 3 go straight from a single stacked column to a single row at `sm`, so
 * `divide-y`/`divide-x` toggle cleanly at that breakpoint. Column 4 passes through a 2x2
 * layout at `sm`/`md` before becoming a single row at `lg`: `nth-child(n+3)` adds the
 * horizontal divider between rows, and `nth-child(even)` adds the vertical divider between
 * the two cards within each row; both are cleared again at `lg`, where `divide-x` takes over
 * for the single-row 4-column layout.
 */
export const GRID_DIVIDER_CLASS: Record<2 | 3 | 4, string> = {
  2: 'divide-y divide-gray-200 sm:divide-y-0 sm:divide-x',
  3: 'divide-y divide-gray-200 sm:divide-y-0 sm:divide-x',
  4: 'divide-y divide-gray-200 sm:divide-y-0 sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-gray-200 sm:[&>*:nth-child(even)]:border-l sm:[&>*:nth-child(even)]:border-gray-200 lg:[&>*:nth-child(n+3)]:border-t-0 lg:[&>*:nth-child(even)]:border-l-0 lg:divide-x',
};
