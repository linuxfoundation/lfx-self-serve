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
 * layout at `sm`/`md` before becoming a single row at `lg`, so plain `divide-y` would add a
 * spurious top border on the top-right card — `nth-child(n+3)` targets only the second-row
 * cards instead.
 */
export const GRID_DIVIDER_CLASS: Record<2 | 3 | 4, string> = {
  2: 'divide-y divide-gray-200 sm:divide-y-0 sm:divide-x',
  3: 'divide-y divide-gray-200 sm:divide-y-0 sm:divide-x',
  4: 'divide-y divide-gray-200 sm:divide-y-0 sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-gray-200 lg:[&>*]:border-t-0 lg:divide-x',
};
