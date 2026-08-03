// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Valid values for the Org Lens Meetings time-range dropdown, in display order. */
export const ORG_MEETINGS_TIME_RANGES = [
  'past90d',
  'past180d',
  'past365d',
  'previousQuarter',
  'previousYear',
  'previous5y',
  'previous10y',
  'allTime',
  'custom',
] as const;

/**
 * The bounded windows the meetings-insights warehouse models are built for, and therefore the only
 * values the BFF endpoints accept. `allTime` and `custom` remain in `ORG_MEETINGS_TIME_RANGES` for
 * the dropdown's shape but are rejected with 400 rather than silently defaulted, so the dropdown
 * disables them from this single source of truth.
 */
export const ORG_MEETINGS_SUPPORTED_TIME_RANGES = ['past90d', 'past180d', 'past365d', 'previousQuarter', 'previousYear', 'previous5y', 'previous10y'] as const;

/** Window used when the `range` query parameter is omitted. */
export const ORG_MEETINGS_DEFAULT_TIME_RANGE = 'past365d';

/** Dropdown-row labels for each time range. */
export const ORG_MEETINGS_TIME_RANGE_LABELS: Record<(typeof ORG_MEETINGS_TIME_RANGES)[number], string> = {
  past90d: 'Past 90 days',
  past180d: 'Past 180 days',
  past365d: 'Past 365 days',
  previousQuarter: 'Previous quarter',
  previousYear: 'Previous year',
  previous5y: 'Previous 5 years',
  previous10y: 'Previous 10 years',
  allTime: 'All time',
  custom: 'Custom',
};

/** Groups of time ranges rendered as divider-separated sections in the dropdown, matching the insights.linuxfoundation.org time selector. */
export const ORG_MEETINGS_TIME_RANGE_GROUPS: (typeof ORG_MEETINGS_TIME_RANGES)[number][][] = [
  ['past90d', 'past180d', 'past365d'],
  ['previousQuarter', 'previousYear', 'previous5y', 'previous10y'],
  ['allTime'],
  ['custom'],
];

/** Per-card icon-tile tint, matching the /events and /org/overview stat-strip convention (varied tints rather than a single uniform blue). */
export const ORG_MEETINGS_KPI_ICON_CLASS = {
  employeesActive: 'bg-blue-100 text-blue-600',
  meetingsAttended: 'bg-emerald-100 text-emerald-600',
  projectsSupported: 'bg-violet-100 text-violet-600',
  foundationsSupported: 'bg-amber-100 text-amber-600',
} as const;

/**
 * Visual amplification factor for the influence table's "attendance contribution" bar. Real
 * `fromAttendancePct` values cluster well under 50%, so the raw percentage reads as nearly empty —
 * this scales the fill width for legibility without affecting the displayed percentage text.
 */
export const ORG_MEETINGS_ATTENDANCE_BAR_SCALE = 2.2;

/** Signal-bar geometry for the influence accordion's band chip icon, matching the Org Lens Project Detail band chip (PR #1028): four ascending bars, filled up to the band's rank and greyed beyond it. */
export const ORG_INFLUENCE_SIGNAL_BAR_HEIGHTS = [5, 8.3, 11.6, 15];
export const ORG_INFLUENCE_SIGNAL_BAR_WIDTH = 2.6;
export const ORG_INFLUENCE_SIGNAL_BAR_GAP = 1.8;

/** Breakdown measure label highlighted (as the section's subject) in the influence accordion's expanded detail row. */
export const ORG_INFLUENCE_MEASURE_LABEL_MEETING_ATTENDANCE = 'Meeting Attendance';

/**
 * The two breakdown measures counted cumulatively across the whole platform rather than over the
 * selected window: board and committee membership are standing states, not period activities, so
 * their bars barely move when the window changes. They are decorated at render time — these are the
 * warehouse's stored `label` values and the component matches on them, so putting the qualifier in
 * the data would break the match.
 */
export const ORG_INFLUENCE_CUMULATIVE_MEASURE_LABELS: readonly string[] = ['Board Members', 'Committee Members'];

/** Suffix appended to the two cumulative measures so a reader can tell them apart from the seven that follow the window. */
export const ORG_INFLUENCE_CUMULATIVE_MEASURE_SUFFIX = ' (all time)';

/** Window the foundation-wide reference population is measured at — fixed, and named wherever the figure is rendered. */
export const ORG_INFLUENCE_REFERENCE_WINDOW_LABEL = 'the last 2 years';
