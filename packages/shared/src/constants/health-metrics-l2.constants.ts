// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';

/** Bottom gutter under the scrolling pane — the gate shell's own `p-6`, so the page itself stays put. */
export const HEALTH_METRICS_L2_PANES_BOTTOM_GUTTER_PX = 24;

/** Floor for the measured pane height, so a short viewport still scrolls rather than collapsing. */
export const HEALTH_METRICS_L2_PANES_MIN_HEIGHT_PX = 320;

/**
 * How long a deep link's section key stays armed for its post-data re-scroll, re-armed per read.
 * Sized at roughly double the server's ~15s worst-case budget for one read, leaving room for
 * hydration and the network on top, so a slow-but-healthy read still lands its scroll.
 */
export const HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS = 30_000;

/** Keys that scroll the document. A keystroke outside this set is not the reader leaving a deep link. */
export const HEALTH_METRICS_L2_SCROLL_KEYS: readonly string[] = [' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'];

/**
 * The four periods the Level 2 views carry as column suffixes, oldest → current. `COMPLETED_YEAR_4`
 * has no column on them, so it is deliberately absent and rejected rather than resolving to another year.
 */
export const HEALTH_METRICS_L2_RANGES = ['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD'] as const;

/** Column suffix per period, shared by every Level 2 view that is keyed by these four periods. */
export const HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX: Readonly<Record<HealthMetricsL2Range, string>> = {
  YTD: 'ytd',
  COMPLETED_YEAR: 'last_completed_year',
  COMPLETED_YEAR_2: 'prev_completed_year',
  COMPLETED_YEAR_3: '3rd_last_completed_year',
};
