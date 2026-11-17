// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2Blank, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsBarFillRule } from '../interfaces/health-metrics-table.interface';
import type {
  HealthMetricsEngagementAttendanceRule,
  HealthMetricsEngagementAttendanceTone,
  HealthMetricsEngagementAttendanceTrend,
  HealthMetricsEngagementGroupAttendance,
  HealthMetricsEngagementGroupKind,
  HealthMetricsEngagementGroupTypeFilter,
  HealthMetricsEngagementMeetingParticipation,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterRecipients,
  HealthMetricsEngagementNonMemberParticipation,
  HealthMetricsEngagementOrgParticipation,
  HealthMetricsEngagementQueryParams,
  HealthMetricsEngagementRecipientFilter,
  HealthMetricsEngagementRepresentatives,
  HealthMetricsEngagementSectionKey,
} from '../interfaces/health-metrics-engagement.interface';
import { HEALTH_METRICS_L2_EMPTY_SOURCES, HEALTH_METRICS_L2_RANGES } from './health-metrics-l2.constants';
import { HEALTH_METRICS_VALUE_BAR_FILL } from './health-metrics-table.constants';

/** Health Metrics tab bar, in render order; every tab routes to its Level 2 page. */
export const HEALTH_METRICS_TABS = [
  { key: 'overview', label: 'Overview', route: '' },
  { key: 'engagement', label: 'Engagement', route: 'engagement' },
  { key: 'events', label: 'Events', route: 'events' },
  { key: 'members', label: 'Members', route: 'members' },
  { key: 'non-members', label: 'Non-Members', route: 'non-members' },
  { key: 'training', label: 'Training', route: 'training' },
] as const;

/** The query-param keys the sections and the Overview deep links share, tied to the typed param shape. */
export const HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS = {
  groupType: 'groupType',
  groupPage: 'groupPage',
  orgFilter: 'orgFilter',
  repFilter: 'repFilter',
  nlMode: 'nlMode',
  nlFilter: 'nlFilter',
} as const satisfies { [K in keyof HealthMetricsEngagementQueryParams]-?: K };

/**
 * The Engagement sections in render order. `key` is the section's URL fragment and the
 * scroll-spy allowlist; the DOM id is `sec-eng-<key>`. Copy is verbatim from the design and carries
 * the product reasoning — it is not placeholder text.
 */
export const HEALTH_METRICS_ENGAGEMENT_SECTIONS = [
  {
    key: 'participation',
    empty: { icon: 'fa-light fa-users-rectangle', source: HEALTH_METRICS_L2_EMPTY_SOURCES.board },
    label: 'Meeting participation',
    heading: 'Meeting participation',
    description: "How many meetings each type held, and how well they're attended.",
  },
  {
    key: 'committees',
    empty: { icon: 'fa-light fa-users-rectangle', source: HEALTH_METRICS_L2_EMPTY_SOURCES.board },
    label: 'Group attendance',
    heading: 'Group attendance',
    description: 'Spot the groups that struggle to get people to show up.',
  },
  {
    key: 'trend',
    empty: { icon: 'fa-light fa-users-rectangle', source: HEALTH_METRICS_L2_EMPTY_SOURCES.board },
    label: 'Attendance trend',
    heading: 'Attendance trend',
    description: 'Whether people show up more or less over time.',
  },
  {
    key: 'orgs',
    empty: { icon: 'fa-light fa-building', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Company participation',
    heading: 'Company participation',
    description: 'See which member companies show up, and which have gone quiet.',
  },
  {
    key: 'reps',
    empty: { icon: 'fa-light fa-chart-simple', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Representatives',
    heading: 'Representatives',
    description: 'Who represents each member, and which seats sit empty.',
  },
  {
    key: 'nonmem',
    empty: { icon: 'fa-light fa-building', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Non-member participation',
    heading: 'Non-member participation',
    description: 'Companies that join meetings without being members.',
  },
  {
    key: 'newsletters',
    empty: { icon: 'fa-light fa-paper-plane', source: HEALTH_METRICS_L2_EMPTY_SOURCES.newsletter },
    label: 'Newsletter performance',
    heading: 'Newsletter performance',
    description: 'How many people open and click each newsletter.',
  },
  {
    key: 'recipients',
    // Always the foundation's latest newsletter, whatever the period, so its empty state never names a past year.
    empty: { icon: 'fa-light fa-envelope-open-text', source: HEALTH_METRICS_L2_EMPTY_SOURCES.newsletter, snapshot: true },
    label: 'Newsletter recipient engagement',
    heading: 'Newsletter recipient engagement',
    description: 'Who read and clicked the latest newsletter.',
  },
] as const satisfies readonly HealthMetricsL2Section[];

/** The tab's blank card, shown in place of every section when none has data for the period. */
export const HEALTH_METRICS_ENGAGEMENT_BLANK: HealthMetricsL2Blank = {
  icon: 'fa-light fa-users',
  noun: 'engagement',
  lead: 'Engagement fills in as members take part in meetings, events, code, surveys and newsletters.',
  reasons: ['Members may not be linked to the foundation yet', 'New activity can take 24–48 hours to appear', 'Your Program Manager can help connect its data'],
  pastActivity: 'member activity',
};

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

/** Attendance below this share (0-1) is Needs attention for a group (ENG-03), and colours amber. */
export const HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD = 0.5;

/** A board must sit near full attendance (ENG-01): below 90% is Needs action, and colours red. */
export const HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_THRESHOLD = 0.9;

/** The rule every group without a level of its own follows. */
export const HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_RULE: HealthMetricsEngagementAttendanceRule = {
  threshold: HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD,
  tone: 'low',
};

export const HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE: HealthMetricsEngagementAttendanceRule = {
  threshold: HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_THRESHOLD,
  tone: 'critical',
};

/** Fewer points than this cannot express a direction, so the trend chart is suppressed entirely. */
export const HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS = 2;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX = 'sec-eng-';

/** Absolute router path the Health Metrics tab bar resolves its tab links against. */
export const HEALTH_METRICS_BASE_PATH = '/foundation/health-metrics';

/** The four periods `ENGAGEMENT_GROUP_ATTENDANCE` carries as column suffixes — the shared Level 2 set. */
export const HEALTH_METRICS_ENGAGEMENT_RANGES = HEALTH_METRICS_L2_RANGES;

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
export const HEALTH_METRICS_ENGAGEMENT_GROUP_PAGE_SIZE = 10;

/** What each group is, shown under its name. Governance splits into the board and its oversight committees. */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS = {
  board: { label: 'Board', icon: 'fa-light fa-gavel' },
  oversight: { label: 'Oversight committee', icon: 'fa-light fa-shield-check' },
  workingGroup: { label: 'Working group', icon: 'fa-light fa-users-gear' },
  sigTag: { label: 'SIG / TAG', icon: 'fa-light fa-comments' },
  other: { label: 'Other', icon: 'fa-light fa-layer-group' },
} as const satisfies Record<string, HealthMetricsEngagementGroupKind>;

/** The Dormant badge's tooltip. */
export const HEALTH_METRICS_ENGAGEMENT_DORMANT_TIP = {
  title: 'Dormant',
  text: 'This group has not held a meeting in the selected period, so there is no attendance to measure.',
} as const;

/**
 * The empty Group attendance shape — an unsupported range, the pre-hydration render, a read with no
 * foundation selected, and the client's post-error placeholder behind `loadFailed`. `counts` is
 * `null` because none of these states measured anything; the server uses this same shape for a real
 * foundation whose unfiltered scope has zero rows. The server never returns it for a failed read;
 * that error propagates.
 */
export const HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED: HealthMetricsEngagementGroupAttendance = {
  rows: [],
  totalRecords: 0,
  counts: null,
  typeCounts: [],
};

/** The warning the design puts above the Non-member participation table. */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_CAUTION =
  'Company matching is under validation, known members have previously appeared as non-members. Treat this list as provisional.';

/** The Membership cell's text for a company that is not a member. */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_LABEL = 'Non-member';

/** Attendance-bar fill per tone — grey at zero, amber or red below the rule's threshold, blue otherwise. */
export const HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS: Record<HealthMetricsEngagementAttendanceTone, string> = {
  empty: 'bg-gray-300',
  low: 'bg-amber-500',
  critical: 'bg-red-500',
  ok: 'bg-blue-500',
};

/**
 * Sections whose read can still change the pane's height, so a deep link is released only once
 * every one of them has settled. A section joins this list only once its component emits
 * `reading`/`settled` and the container binds both.
 */
export const HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS = [
  'participation',
  'committees',
  'trend',
  'orgs',
  'reps',
  'nonmem',
  'newsletters',
  'recipients',
] as const satisfies readonly HealthMetricsEngagementSectionKey[];

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

/** Each meeting type's icon; a type the view adds later takes `Other`'s. */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ICONS: Readonly<Record<string, string>> = {
  Board: 'fa-light fa-user-check',
  Technical: 'fa-light fa-code',
  'Working Group': 'fa-light fa-users-gear',
  Maintainers: 'fa-light fa-gear',
  Marketing: 'fa-light fa-chart-line-up',
  Other: 'fa-light fa-calendar-days',
};

/** The governance row's description, which leads to Members board attendance. */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_DESCRIPTION = 'Board & voting-member attendance';

/** A board must sit near full attendance, so its bar turns danger below 90% rather than following the default rule. */
export const HEALTH_METRICS_ENGAGEMENT_BOARD_BAR_FILL: HealthMetricsBarFillRule = {
  zeroClass: HEALTH_METRICS_VALUE_BAR_FILL.zeroClass,
  thresholds: [{ below: Math.round(HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_THRESHOLD * 100), fillClass: 'bg-red-500' }],
  defaultClass: HEALTH_METRICS_VALUE_BAR_FILL.defaultClass,
};

/** The board row's bar rule; every other meeting type follows the default. */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_BAR_FILLS: Readonly<Record<string, HealthMetricsBarFillRule>> = {
  Board: HEALTH_METRICS_ENGAGEMENT_BOARD_BAR_FILL,
};

/** The view's own level values. The finer `committee_type` level is not read by this section. */
export const HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_LEVELS: readonly string[] = ['all', 'group'];

/**
 * The empty Meeting participation shape — pre-hydration, no foundation selected, and the client's
 * post-error placeholder. A `null` total renders the section's empty state, which is why the
 * server never returns this for a failed read; that error propagates.
 */
export const HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED: HealthMetricsEngagementMeetingParticipation = {
  total: null,
  rows: [],
};

/**
 * The Attendance trend's empty shape: the server's answer for a scope the view has no months for,
 * and the client's no-read state (pre-hydration, no foundation selected, or a failed read).
 */
export const HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED: HealthMetricsEngagementAttendanceTrend = {
  months: [],
};

/** Fewer rated months in the year than this draws the line under a low-confidence note. */
export const HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_MIN_MONTHS = 6;

/**
 * Debounce shared by the org and representatives search boxes. Either filter runs over the whole
 * loaded scope, so a keystroke is more expensive than a typical typeahead and deserves the same
 * pause as the other local filters.
 */
export const HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS = 200;

/** Client-side page size for the org table — the whole foundation arrives in one read. */
export const HEALTH_METRICS_ENGAGEMENT_ORG_PAGE_SIZE = 10;

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
 * The client's no-read shape: pre-hydration, no foundation selected, and after a failed read.
 * Its counts are `null` because nothing was measured — zeroes here would report a scope the
 * component never asked the server about.
 */
export const HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED: HealthMetricsEngagementOrgParticipation = {
  rows: [],
  counts: null,
};

/** Client-side page size for the non-member table — the whole foundation arrives in one read. */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PAGE_SIZE = 10;

/**
 * Sanity cap on that one read, an order of magnitude above the largest foundation's non-member
 * count. It bounds a payload the client sorts in memory; hitting it is logged, not silent.
 */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_ROW_CAP = 5000;

/**
 * The client's no-read shape: pre-hydration, no foundation selected, and after a failed read.
 * Its count is `null` because nothing was measured — a zero here would report a scope the
 * component never asked the server about.
 */
export const HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED: HealthMetricsEngagementNonMemberParticipation = {
  rows: [],
  counts: null,
};

/** Client-side page size for the representatives table — the whole foundation arrives in one read. */
export const HEALTH_METRICS_ENGAGEMENT_REP_PAGE_SIZE = 10;

/**
 * Sanity cap on that one read. Higher than the org and non-member caps because this view's grain is
 * one row per person per group *per project*, so it multiplies out further than either of those.
 */
export const HEALTH_METRICS_ENGAGEMENT_REP_ROW_CAP = 20000;

/**
 * The representatives table's cuts, all three scoped to the people invited in the selected period —
 * the population the view's own scope count covers. "Never attended" is `HAS_NEVER_ATTENDED_<period>`
 * and "Lapsed" is `IS_LAPSED_<period>`, so neither cut is a client-side date comparison.
 */
export const HEALTH_METRICS_ENGAGEMENT_REP_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'never', label: 'Never attended' },
  { key: 'lapsed', label: 'Lapsed' },
] as const;

/** Shown in place of a name the view flags as an unresolved identity. */
export const HEALTH_METRICS_ENGAGEMENT_UNRESOLVED_IDENTITY_LABEL = 'Unresolved identity';

/**
 * The client's no-read shape: pre-hydration, no foundation selected, and after a failed read.
 * Its counts are `null` because nothing was measured — zeroes here would report a scope the
 * component never asked the server about.
 */
export const HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED: HealthMetricsEngagementRepresentatives = {
  rows: [],
  counts: null,
};

/** The design's toggle on Newsletter performance: what the chart plots for each newsletter. */
export const HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES = [
  { key: 'rates', label: 'Open & click rate' },
  { key: 'audience', label: 'Audience' },
] as const;

/** Most newsletters one read returns; a foundation sending weekly stays far below it. */
export const HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_ROW_CAP = 1000;

/** Rows per page in the Newsletter performance table. */
export const HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_PAGE_SIZE = 10;

/** Nothing measured: the pre-hydration render, no foundation selected, and the client's placeholder after a failed read. */
export const HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_UNMEASURED: HealthMetricsEngagementNewsletterPerformance = {
  measured: false,
  periods: { YTD: null, COMPLETED_YEAR: null, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null },
  newsletters: [],
};

/** The newsletter views the Overview card and the Engagement newsletter sections read. */
export const HEALTH_METRICS_NEWSLETTER_VIEWS = {
  summary: 'ANALYTICS.PLATINUM_LFX_ONE.NEWSLETTER_ENGAGEMENT_SUMMARY',
  byNewsletter: 'ANALYTICS.PLATINUM_LFX_ONE.NEWSLETTER_ENGAGEMENT_BY_NEWSLETTER',
  recipients: 'ANALYTICS.PLATINUM_LFX_ONE.NEWSLETTER_RECIPIENT_ENGAGEMENT',
} as const;

/** The design's recipient cuts; `clicked` cuts across segments, since a click can come without a recorded open. */
export const HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS = [
  { key: 'all', label: 'All status' },
  { key: 'opened', label: 'Opened' },
  { key: 'clicked', label: 'Clicked' },
  { key: 'not-opened', label: 'Not opened' },
  { key: 'failed', label: 'Failed' },
] as const;

/** Most recipients one read returns; past it the table is cut and a warning logged. */
export const HEALTH_METRICS_ENGAGEMENT_RECIPIENT_ROW_CAP = 20_000;

/** Rows per page in the recipient table. */
export const HEALTH_METRICS_ENGAGEMENT_RECIPIENT_PAGE_SIZE = 10;

/** The recipient status counts, each with its dot and header tooltip; the counts cover the loaded recipients. */
export const HEALTH_METRICS_ENGAGEMENT_RECIPIENT_METRICS = [
  {
    key: 'opened',
    label: 'Opened',
    dotClass: 'bg-blue-500',
    tip: 'Recipients who opened the newsletter at least once. Some mail clients block tracking, so this is a floor.',
  },
  { key: 'clicked', label: 'Clicked', dotClass: 'bg-violet-500', tip: 'Recipients who clicked at least one link in the newsletter.' },
  { key: 'not-opened', label: 'Not opened', dotClass: 'bg-gray-400', tip: 'Recipients who received the newsletter but have no recorded open.' },
  {
    key: 'failed',
    label: 'Failed',
    dotClass: 'bg-red-500',
    tip: 'Recipients the newsletter could not be delivered to, for example because of a bounced or invalid address.',
  },
] as const satisfies readonly { key: HealthMetricsEngagementRecipientFilter; label: string; dotClass: string; tip: string }[];

/** No newsletter: the pre-hydration render, no foundation selected, and the client's placeholder after a failed read. */
export const HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED: HealthMetricsEngagementNewsletterRecipients = {
  newsletter: null,
  recipients: [],
  truncated: false,
};
