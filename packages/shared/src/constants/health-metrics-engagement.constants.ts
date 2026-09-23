// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HealthMetricsEngagementAttendanceTone,
  HealthMetricsEngagementGroupAttendance,
  HealthMetricsEngagementGroupTypeFilter,
  HealthMetricsEngagementMeetingParticipation,
  HealthMetricsEngagementNonMemberParticipation,
  HealthMetricsEngagementOrgParticipation,
  HealthMetricsEngagementSectionKey,
} from '../interfaces/health-metrics-engagement.interface';

/**
 * Health Metrics tab bar. Overview and Engagement are routable today; the remaining four render
 * disabled so the bar does not reshuffle as LFXV2-3367..3370 land.
 */
export const HEALTH_METRICS_TABS = [
  { key: 'overview', label: 'Overview', route: '' },
  { key: 'engagement', label: 'Engagement', route: 'engagement' },
  { key: 'events', label: 'Events', route: null },
  { key: 'members', label: 'Members', route: null },
  { key: 'non-members', label: 'Non-Members', route: null },
  { key: 'training', label: 'Training', route: null },
] as const;

/**
 * The six Engagement sections in render order. `key` is the section's URL fragment and the
 * scroll-spy allowlist; the DOM id is `sec-eng-<key>`. Copy is verbatim from the design and carries
 * the product reasoning — it is not placeholder text.
 */
export const HEALTH_METRICS_ENGAGEMENT_SECTIONS = [
  {
    key: 'participation',
    label: 'Meeting participation',
    heading: 'Meeting participation',
    description:
      'The complete picture of who shows up — every meeting type this foundation runs, board and groups included. This is the foundation-wide whole; the Members section adds the governance-accurate cut (board & voting, voting reps only, per member).',
    footnote:
      'Board & voting are included in this foundation-wide view. The Members section adds the governance-accurate cut — voting reps only, per member, next to dues and renewals — using the same board number, not a different one.',
    footnoteCaution: false,
  },
  {
    key: 'committees',
    label: 'Group attendance',
    heading: 'Group attendance',
    description:
      'Every group — governance bodies, working groups, SIGs and TAGs — lowest attendance first. Dormant groups rank above every percentage: a group that has not met at all is worse than one attending badly.',
    footnote: 'Ranked by default rather than filtered — the ED sees the failing group without configuring anything. Filters narrow, they are not required.',
    footnoteCaution: false,
  },
  {
    key: 'trend',
    label: 'Attendance trend',
    heading: 'Attendance trend',
    description:
      'All-meeting attendance over time. Level and direction are separate signals — attendance can be improving and still sit below where it needs to be.',
    footnote:
      'Empty and low-confidence states matter here — a foundation with two periods of history gets the numbers without a trend line implying a pattern.',
    footnoteCaution: false,
  },
  {
    key: 'orgs',
    label: 'Organization participation',
    heading: 'Organization participation',
    description:
      'Which member organizations actually turn up, and when they were last seen. Last engaged is the stronger churn signal — recency beats rate, and it is not surfaced anywhere in PCC today.',
    footnote:
      'Avg reps per meeting and % of meetings attended are surfaced from PCC Level 4, where they sit behind an org-by-org drilldown. Here the ED scans every org at once. Row opens the meeting record.',
    footnoteCaution: false,
  },
  {
    key: 'reps',
    label: 'Representatives',
    heading: 'Representatives',
    description: 'The people behind the organizations. A seat that is never filled is a paid benefit going unused — and an early churn signal.',
    footnote: 'Duplicate-identity records are a known data issue — the same person appears twice under different titles in both PCC and Self Serve today.',
    footnoteCaution: false,
  },
  {
    key: 'nonmem',
    label: 'Non-member participation',
    heading: 'Non-member participation',
    description:
      'Organizations turning up to meetings without paying for membership. Showing up is a stronger buying signal than contributing code — they are already spending staff time.',
    footnote:
      'Organization matching is under validation — known members have previously appeared as non-members. Treat this list as provisional until the match is fixed.',
    footnoteCaution: true,
  },
] as const;

/** Static note under the sub-nav items; stays plain text until the Members tab exists to link to. */
export const HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE_NOTE = 'Board & voting-member attendance is reported per member in Members';

/**
 * Group-type cuts shared by the group-attendance and attendance-trend segments. `sigtag` matches a
 * group whose type is either SIG or TAG. Note these are the design's cuts, not the ticket's
 * board / TSC-TAC / other-voting split — the design places governance detail in Members.
 */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'gov', label: 'Governance' },
  { key: 'sigtag', label: 'SIG / TAG' },
  { key: 'wg', label: 'Working groups' },
] as const;

/** Below this many meetings in the period, attendance reads "No data" rather than a percentage. */
export const HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE = 3;

/** Days without activity before an organization is lapsed. Group dormancy is the view's own flag. */
export const HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS = 180;

/** Attendance below this share (0-1) is the one threshold worth colouring amber. */
export const HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD = 0.5;

/** Fewer points than this cannot express a direction, so the trend chart is suppressed entirely. */
export const HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS = 2;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX = 'sec-eng-';

/** Absolute router path the Health Metrics tab bar resolves its tab links against. */
export const HEALTH_METRICS_BASE_PATH = '/foundation/health-metrics';

/**
 * The four periods `ENGAGEMENT_GROUP_ATTENDANCE` carries as column suffixes, oldest → current.
 * `COMPLETED_YEAR_4` has no column on the view, so it is deliberately absent.
 */
export const HEALTH_METRICS_ENGAGEMENT_RANGES = ['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD'] as const;

/**
 * The four labels `ENGAGEMENT_GROUP_ATTENDANCE.GROUP_TYPE_LABEL` actually emits. The view buckets
 * committee categories itself, so a cut matches one label rather than a category list.
 */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES: readonly string[] = ['Governance', 'Other', 'SIG / TAG', 'Working groups'];

/**
 * Which `GROUP_TYPE_LABEL` values fall into each filter cut. `all` has no entry on purpose — it
 * drops the predicate rather than listing every label. The design gives `Other` no cut of its own,
 * so the three cuts deliberately do not sum to the all-types count.
 */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS: Partial<Record<HealthMetricsEngagementGroupTypeFilter, readonly string[]>> = {
  gov: ['Governance'],
  sigtag: ['SIG / TAG'],
  wg: ['Working groups'],
};

/** Rows per page in the Group attendance table. */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_PAGE_SIZE = 25;

/**
 * The empty Group attendance shape — a period the view carries no columns for, the pre-hydration
 * render, a read with no foundation selected, and the client's post-error placeholder behind
 * `loadFailed`. The server never returns it for a failed read; that error propagates.
 */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT: HealthMetricsEngagementGroupAttendance = {
  rows: [],
  totalRecords: 0,
  counts: { groups: 0, dormantGroups: 0 },
};

/** Inline sparkline viewBox, in px — a 60px trend cell is the design's column width. */
export const HEALTH_METRICS_ENGAGEMENT_SPARKLINE_WIDTH_PX = 60;
export const HEALTH_METRICS_ENGAGEMENT_SPARKLINE_HEIGHT_PX = 18;

/** Attendance-bar fill per tone — grey at zero, amber below the threshold, blue otherwise. */
export const HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS: Record<HealthMetricsEngagementAttendanceTone, string> = {
  empty: 'bg-gray-300',
  low: 'bg-amber-500',
  ok: 'bg-blue-500',
};

/** Bottom gutter under the scrolling pane — the gate shell's own `p-6`, so the page itself stays put. */
export const HEALTH_METRICS_ENGAGEMENT_PANES_BOTTOM_GUTTER_PX = 24;

/** Floor for the measured pane height, so a short viewport still scrolls rather than collapsing. */
export const HEALTH_METRICS_ENGAGEMENT_PANES_MIN_HEIGHT_PX = 320;

/**
 * How long a deep link's section key stays armed for its post-data re-scroll, re-armed per read.
 * Sized at roughly double the server's ~15s worst-case budget for one read, leaving room for
 * hydration and the network on top, so a slow-but-healthy read still lands its scroll.
 */
export const HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS = 30_000;

/**
 * Sections whose read can still change the pane's height, so a deep link is released only once
 * every one of them has settled. A section from the follow-up PRs on #2802 joins this list only once its
 * component emits `reading`/`settled` and the container binds both.
 */
export const HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS = [
  'participation',
  'committees',
  'orgs',
  'nonmem',
] as const satisfies readonly HealthMetricsEngagementSectionKey[];

/** Keys that scroll the document. A keystroke outside this set is not the reader leaving a deep link. */
export const HEALTH_METRICS_ENGAGEMENT_SCROLL_KEYS: readonly string[] = [' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'];

/** The design's `PARTMODE` segment: which measure drives the participation hero and bar column. */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_MODES = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'meetings', label: 'Meetings held' },
] as const;

/**
 * The six values `ENGAGEMENT_MEETING_PARTICIPATION.MEETING_TYPE_GROUP` actually emits at the
 * `group` level, pinned so the order and governance lists below cannot drift off the view.
 */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_VALUES: readonly string[] = [
  'Board',
  'Maintainers',
  'Marketing',
  'Other',
  'Technical',
  'Working Group',
];

/**
 * Display order for the participation table's `MEETING_TYPE_GROUP` rows — governance first, the
 * catch-all last. A group the view adds later is unknown here and sorts to the end rather than
 * being dropped.
 */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ORDER: readonly string[] = [
  'Board',
  'Technical',
  'Working Group',
  'Maintainers',
  'Marketing',
  'Other',
];

/**
 * Groups whose detail belongs to the Members tab, which reports them per member against dues.
 * Only the board qualifies today; widening this is one entry, not a code change.
 */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_GROUPS: readonly string[] = ['Board'];

/** The view's own level values. The finer `committee_type` level is not read by this section. */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_LEVELS: readonly string[] = ['all', 'group'];

/**
 * The empty Meeting participation shape — pre-hydration, no foundation selected, and the client's
 * post-error placeholder. A `null` total renders the section's empty state, which is why the
 * server never returns this for a failed read; that error propagates.
 */
export const HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT: HealthMetricsEngagementMeetingParticipation = {
  total: null,
  rows: [],
};

/**
 * Debounce on the org search box. The filter runs over the whole loaded scope, so a keystroke is
 * more expensive than a typical typeahead and deserves the same pause as the other local filters.
 */
export const HEALTH_METRICS_ENGAGEMENT_ORG_SEARCH_DEBOUNCE_MS = 200;

/** Client-side page size for the org table — the whole foundation arrives in one read. */
export const HEALTH_METRICS_ENGAGEMENT_ORG_PAGE_SIZE = 25;

/**
 * Sanity cap on that one read, an order of magnitude above the largest foundation's org count.
 * It bounds a payload the client sorts and searches in memory; hitting it is logged, not silent.
 */
export const HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP = 5000;

/** The org table's cut. "No activity" is the view's own `IS_LAPSED_180D`, not a client-side date sum. */
export const HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'lapsed', label: 'No activity in 180 days' },
] as const;

/**
 * A foundation the view holds no organizations for — a measured empty scope, which is why the
 * counts are zero rather than null. The server never returns it for a failed read; that error
 * propagates.
 */
export const HEALTH_METRICS_ENGAGEMENT_ORG_PARTICIPATION_DEFAULT: HealthMetricsEngagementOrgParticipation = {
  rows: [],
  counts: { orgs: 0, lapsedOrgs: 0 },
};

/**
 * The client's no-read shape: pre-hydration, no foundation selected, and after a failed read.
 * Its counts are `null` because nothing was measured — zeroes here would caption a scope the
 * component never asked the server about.
 */
export const HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED: HealthMetricsEngagementOrgParticipation = {
  rows: [],
  counts: null,
};

/** Client-side page size for the non-member table — the whole foundation arrives in one read. */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PAGE_SIZE = 25;

/**
 * Sanity cap on that one read, an order of magnitude above the largest foundation's non-member
 * count. It bounds a payload the client sorts in memory; hitting it is logged, not silent.
 */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_ROW_CAP = 5000;

/**
 * A foundation the view holds no non-member organizations for — a measured empty scope, which is
 * why the count is zero rather than null. The server never returns it for a failed read; that
 * error propagates.
 */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PARTICIPATION_DEFAULT: HealthMetricsEngagementNonMemberParticipation = {
  rows: [],
  counts: { orgs: 0 },
};

/**
 * The client's no-read shape: pre-hydration, no foundation selected, and after a failed read.
 * Its count is `null` because nothing was measured — a zero here would caption a scope the
 * component never asked the server about.
 */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED: HealthMetricsEngagementNonMemberParticipation = {
  rows: [],
  counts: null,
};
