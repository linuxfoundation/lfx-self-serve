// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';

/** Shape a project slug must have before it reaches a read; the server rejects anything else. */
export const HEALTH_METRICS_PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

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

/** Where a section's data comes from, finishing its empty state's "This fills in …" (the design's wording). */
export const HEALTH_METRICS_L2_EMPTY_SOURCES = {
  event: 'once the foundation has an event on the calendar',
  survey: 'after a member satisfaction survey closes',
  invoice: 'when a member invoice becomes overdue',
  courses: 'as people enroll in the foundation’s courses',
  board: 'as board meetings are held or added in LFX',
  members: 'as members join and take part in foundation activities',
} as const;

/** A section's empty state for YTD and for a past year; `{source}` and `{Y}` are filled in per section and period. */
export const HEALTH_METRICS_L2_EMPTY_COPY = {
  ytd: { title: 'Nothing recorded yet', text: 'This fills in {source}. Updates can take 24–48 hours to appear.' },
  past: {
    title: 'Nothing in {Y}',
    text: 'Nothing was recorded this year. Activity tracked outside LFX or under another foundation isn’t included.',
  },
} as const;

/** A tab's blank card for a past year: its lead names the tab's activity, and every tab gives these reasons. */
export const HEALTH_METRICS_L2_BLANK_PAST = {
  lead: 'No {activity} was recorded for the foundation in {Y}.',
  reasons: ['The foundation may not have launched yet', 'It may have been recorded under a parent foundation', 'A later year may have data to compare'],
} as const;
