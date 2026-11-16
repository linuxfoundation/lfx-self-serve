// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES,
  HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_REP_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_TABS,
} from '../constants/health-metrics-engagement.constants';
import type { HealthMetricsRange } from './dashboard-metric.interface';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem, HealthMetricsMetricItem } from './health-metrics-l2.interface';
import type { HealthMetricsLineChartView } from './health-metrics-line-chart.interface';
import type { HealthMetricsMembersReservedTier } from './health-metrics-members.interface';
import type { HealthMetricsBarFillRule } from './health-metrics-table.interface';

/** Section key from the design's `L2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsEngagementSectionKey = (typeof HEALTH_METRICS_ENGAGEMENT_SECTIONS)[number]['key'];

/** Group-type cut shared by the group-attendance and attendance-trend filter segments. */
export type HealthMetricsEngagementGroupTypeFilter = (typeof HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS)[number]['key'];

export type HealthMetricsTabKey = (typeof HEALTH_METRICS_TABS)[number]['key'];

/** Attendance-bar tone: grey at zero, amber or red below the rule's threshold, blue otherwise. */
export type HealthMetricsEngagementAttendanceTone = 'empty' | 'low' | 'critical' | 'ok';

/** A group level's attendance rule: a 0-1 share below `threshold` takes `tone`. */
export interface HealthMetricsEngagementAttendanceRule {
  threshold: number;
  tone: Extract<HealthMetricsEngagementAttendanceTone, 'low' | 'critical'>;
}

/** One entry in the Health Metrics tab bar. */
export interface HealthMetricsTab {
  key: HealthMetricsTabKey;
  label: string;
  /** Router path segment relative to `foundation/health-metrics`; `''` is the Overview. */
  route: string;
}

/** Engagement's sub-nav entry, keyed to its own sections. */
export interface HealthMetricsEngagementSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsEngagementSectionKey;
}

/** Inputs to the sub-nav notes (the design's `counts()`); a zero drops its note. */
export interface HealthMetricsEngagementSubNavCounts {
  dormantGroups: number;
  lowAttendanceGroups: number;
  lapsedOrgs: number;
  neverAttendedReps: number;
}

/** What `#committees` reports for its sub-nav note. */
export type HealthMetricsEngagementGroupNoteCounts = Pick<HealthMetricsEngagementSubNavCounts, 'dormantGroups' | 'lowAttendanceGroups'>;

/** What `#orgs` reports for its sub-nav note. */
export type HealthMetricsEngagementOrgNoteCounts = Pick<HealthMetricsEngagementSubNavCounts, 'lapsedOrgs'>;

/** What `#reps` reports for its sub-nav note. */
export type HealthMetricsEngagementRepNoteCounts = Pick<HealthMetricsEngagementSubNavCounts, 'neverAttendedReps'>;

/** One group's numbers for a single period. Every period ships on every row, so the period pill
 * re-reads rather than re-deriving. */
export interface HealthMetricsEngagementGroupPeriod {
  range: HealthMetricsRange;
  /** `null` when the view carries no column value for this row/period — unmeasured, not zero. */
  meetingsHeld: number | null;
  invitedCount: number | null;
  attendedCount: number | null;
  /** 0-1 share of invited seats filled; `null` means no invited population at all. */
  attendancePct: number | null;
  /** The view's own `IS_DORMANT_<period>` — not re-derived client-side. */
  dormant: boolean;
}

/** A row of the Group attendance table. `periods` is ordered oldest → current and carries every period, so a
 * period change re-renders without a second read. */
export interface HealthMetricsEngagementGroupRow {
  committeeId: string;
  committeeName: string;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  groupTypeLabel: string | null;
  /** The view's `MEETING_TYPE_GROUP`, which tells a board apart from the other governance groups. */
  meetingTypeGroup: string | null;
  /** ISO date of the group's last meeting, or `null` if it has never met. */
  lastMetDate: string | null;
  periods: HealthMetricsEngagementGroupPeriod[];
}

/** The kind of group a row is, shown under its name with an icon. */
export interface HealthMetricsEngagementGroupKind {
  label: string;
  icon: string;
}

/** One Group attendance row, ready to render for the selected period. */
export interface HealthMetricsEngagementGroupRowView {
  key: string;
  name: string;
  kind: HealthMetricsEngagementGroupKind;
  /** The period's meeting count, or "—" when the group held none. */
  meetings: string;
  /** Pre-rendered so the template stays free of `DatePipe`, which would shift the date-only value. */
  lastMetLabel: string;
  dormant: boolean;
  /** The rounded attendance, e.g. `42%`; the bar reads "—" when `attendancePct` is `null`. */
  attendanceLabel: string;
  attendancePct: number | null;
}

/** `#committees` scope counts, aggregated over the whole project scope, not the page or the selected
 * type chip; the dormant and low-attendance counts feed its sub-nav note. */
export interface HealthMetricsEngagementGroupCounts {
  groups: number;
  dormantGroups: number;
  /** Not dormant, rated (enough meetings to state a rate) and below the low-attendance threshold. */
  lowAttendanceGroups: number;
}

/** One group type's own counts, independent of whichever chip is selected. */
export interface HealthMetricsEngagementGroupTypeCount extends Omit<HealthMetricsEngagementGroupCounts, 'lowAttendanceGroups'> {
  groupType: HealthMetricsEngagementGroupTypeFilter;
}

/** One page of Group attendance, already sorted dormant-first by the view's `SORT_RANK_<period>`. */
export interface HealthMetricsEngagementGroupAttendance {
  rows: HealthMetricsEngagementGroupRow[];
  /** Rows matching the selected type chip — the paginator's total. */
  totalRecords: number;
  /** `null` when the all-projects scope has no rows at all — distinct from a real zero. */
  counts: HealthMetricsEngagementGroupCounts | null;
  /**
   * One entry per group type, `all` included; empty whenever `counts` is `null`. The chips show labels only and the
   * caption reads `totalRecords`, so nothing renders these yet.
   */
  typeCounts: HealthMetricsEngagementGroupTypeCount[];
}

/** Wire query for `GET /api/analytics/engagement-group-attendance`. */
export interface HealthMetricsEngagementGroupQuery {
  foundationSlug: string;
  /** Absent or `null` is the all-projects scope, which drops the predicate. The client no longer
   * sends it; the server keeps the optional filter. */
  projectSlug?: string | null;
  groupType: HealthMetricsEngagementGroupTypeFilter;
  range: HealthMetricsRange;
  /** 1-based. */
  page: number;
  size: number;
}

/**
 * A participation row's level in the view's own hierarchy. `all` is the foundation-wide roll-up the
 * hero reads; `group` is one meeting-type group. The finer `committee_type` level is not read yet.
 */
export type HealthMetricsEngagementParticipationLevel = 'all' | 'group';

/** One participation row's numbers for a single period. Every period ships on every row. */
export interface HealthMetricsEngagementParticipationPeriod {
  range: HealthMetricsRange;
  /** `null` when the view carries no column value for this row/period — unmeasured, not zero. */
  meetingsHeld: number | null;
  invitedCount: number | null;
  attendedCount: number | null;
  /** 0-1 share of invited seats filled; `null` means no invited population at all. */
  attendancePct: number | null;
  activeGroups: number | null;
  neverAttended: number | null;
  /** Point change vs the previous comparable period; `null` when the view holds no prior period. */
  attendanceChangePp: number | null;
  /** Fractional change in meetings held vs the previous period; `null` when there is no prior. */
  meetingsChangePct: number | null;
}

/** The roll-up row or one meeting-type row of the Meeting participation section. */
export interface HealthMetricsEngagementParticipationRow {
  level: HealthMetricsEngagementParticipationLevel;
  /** The view's `MEETING_TYPE_GROUP`; `null` on the roll-up row. */
  group: string | null;
  label: string;
  /** `null` when the view carries no column value for this row — unmeasured, not zero. */
  totalGroups: number | null;
  /** True for the rows whose detail belongs to the Members tab rather than this page. */
  governance: boolean;
  periods: HealthMetricsEngagementParticipationPeriod[];
}

/** `GET /api/analytics/engagement-meeting-participation` — the hero's roll-up plus the type table. */
export interface HealthMetricsEngagementMeetingParticipation {
  /** `null` when the foundation has no roll-up row, which renders the section's empty state. */
  total: HealthMetricsEngagementParticipationRow | null;
  rows: HealthMetricsEngagementParticipationRow[];
}

/** Wire query for `GET /api/analytics/engagement-meeting-participation`. */
export interface HealthMetricsEngagementParticipationQuery {
  foundationSlug: string;
  /** Absent or `null` reads the view's all-projects roll-up rows. The client no longer sends it;
   * the server keeps the optional filter. */
  projectSlug?: string | null;
  range: HealthMetricsRange;
}

/** One month of the trailing twelve-month attendance trend, as the view reports it. */
export interface HealthMetricsEngagementAttendanceMonth {
  /** ISO date of the month's first day. */
  monthStartDate: string;
  meetingsHeld: number | null;
  invited: number | null;
  attended: number | null;
  /** 0-1 fraction; `null` in a month with no invited population. */
  attendancePct: number | null;
  /** The view's change against the previous month, as a 0-1 fraction of a point. */
  attendanceChangePp: number | null;
}

/** `GET /api/analytics/engagement-attendance-trend` — the trailing twelve months, oldest first. */
export interface HealthMetricsEngagementAttendanceTrend {
  months: HealthMetricsEngagementAttendanceMonth[];
}

/** Wire query for `GET /api/analytics/engagement-attendance-trend`. The trend always covers the last
 * twelve months, so the period selector never reaches the wire. */
export interface HealthMetricsEngagementAttendanceTrendQuery {
  foundationSlug: string;
  /** Absent or `null` reads the view's all-projects roll-up rows. The client no longer sends it;
   * the server keeps the optional filter. */
  projectSlug?: string | null;
}

/** One chart point. `rate` is a percent (0-100), `null` for a gap in the line. */
export interface HealthMetricsEngagementAttendanceTrendPointView {
  monthStartDate: string;
  /** Axis label, e.g. `Oct 25`. */
  label: string;
  /** Long label for the tooltip and the screen-reader table, e.g. `October 2025 (to date)`. */
  monthLabel: string;
  rate: number | null;
  rateLabel: string;
  meetingsLabel: string;
  /** The current month, still collecting meetings: plotted, but kept out of the headline and stats. */
  isInProgress: boolean;
}

/** Which body the Attendance trend renders: nothing rated, a single rated month, or a line. */
export type HealthMetricsEngagementAttendanceTrendState = 'empty' | 'insufficient' | 'trend';

/** The Attendance trend headline, side stats and low-confidence note. */
export interface HealthMetricsEngagementAttendanceTrendSummaryView {
  state: HealthMetricsEngagementAttendanceTrendState;
  /** Months with a reportable rate, the month in progress included. */
  ratedMonths: number;
  latestLabel: string;
  /** The month the headline describes, e.g. `September 2026`. */
  latestCaption: string;
  deltaLabel: string;
  deltaDirection: 'up' | 'down' | 'neutral';
  rangeChangeLabel: string;
  rangeHighLabel: string;
  rangeLowLabel: string;
  isLowConfidence: boolean;
  lowConfidenceNote: string;
}

/** One Meeting participation row, ready to render for the selected period. */
export interface HealthMetricsEngagementParticipationRowView {
  key: string;
  /** The meeting type's short name, e.g. `Board`. */
  name: string;
  icon: string;
  /** The governance row's pointer to Members; empty on every other row. */
  description: string;
  /** Rows whose detail is on the Members tab; the others scroll to Group attendance. */
  governance: boolean;
  meetings: string;
  /** The rounded attendance, e.g. `42%`; the bar reads "—" when `attendancePct` is `null`. */
  attendanceLabel: string;
  attendancePct: number | null;
  fillRule: HealthMetricsBarFillRule;
}

/** Which cut of the org table is showing: everyone, or only orgs lapsed past the dormancy window. */
export type HealthMetricsEngagementOrgFilter = (typeof HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS)[number]['key'];

/** One organization's numbers for a single period. Every period ships on every row, so the period
 * pill re-projects client-side and costs no request. */
export interface HealthMetricsEngagementOrgPeriod {
  range: HealthMetricsRange;
  /** Meetings held across the scope in this period — the "No data" threshold reads this. `null` is
   * unmeasured, not zero. */
  meetingsHeld: number | null;
  /** Meetings that concerned this org at all (invited or attended) — the attendance denominator. */
  meetingsTotal: number | null;
  invitedCount: number | null;
  attendedCount: number | null;
  /** 0-1 share of the org's meetings it turned up to; `null` when no meeting concerned it. */
  attendancePct: number | null;
  /** Mean representatives per attended meeting; `null` when it attended none. */
  avgReps: number | null;
  /** The view's `SORT_RANK_<period>`, best-first. Per period, so the pill re-sorts the loaded rows. */
  sortRank: number | null;
}

/** A row of the Organization participation table. */
export interface HealthMetricsEngagementOrgRow {
  accountId: string;
  accountName: string;
  /** The view's own tier string, rendered as-is — it reads `Non-Member` on real rows. */
  membershipTier: string;
  isMember: boolean;
  /** All-time, not per period: ISO date the org was last seen in any meeting. */
  lastEngagedDate: string | null;
  daysSinceLastEngaged: number | null;
  /** The view's `IS_LAPSED_180D`, so no date comparison happens client-side. */
  lapsed: boolean;
  /** The account's logo from the account mapping; empty shows the name's first letter. */
  logoUrl: string;
  periods: HealthMetricsEngagementOrgPeriod[];
}

/** One Company participation row, ready to render for the selected period. */
export interface HealthMetricsEngagementOrgRowView {
  key: string;
  name: string;
  logoUrl: string;
  /** The tier name, "Non-member", or "—" for a member with no tier. */
  membership: string;
  isMember: boolean;
  /** Draws the tier icon before a Diamond, Platinum, Gold or Silver membership. */
  tier: HealthMetricsMembersReservedTier | null;
  /** `12 of 27 (44%)` for the selected period; "—" when no meeting concerned the company. */
  attendedLabel: string;
  /** The bar's rounded share; `null` draws no bar. */
  attendedPct: number | null;
  attendedFillClass: string;
  avgRepsLabel: string;
  /** Pre-rendered so the template stays free of `DatePipe`, which would shift the date-only value. */
  lastEngagedLabel: string;
}

/** `#orgs` scope counts; the lapsed count feeds its sub-nav note. Both are period-agnostic, denormalized onto every row. */
export interface HealthMetricsEngagementOrgCounts {
  orgs: number;
  lapsedOrgs: number;
}

/** `GET /api/analytics/engagement-org-participation` — every org, every period, one read. */
export interface HealthMetricsEngagementOrgParticipation {
  rows: HealthMetricsEngagementOrgRow[];
  /** `null` when the view reports no scope count on rows that exist — unmeasured, not zero. */
  counts: HealthMetricsEngagementOrgCounts | null;
}

/** Wire query for `GET /api/analytics/engagement-org-participation`. Search, the lapsed cut and the
 * period all resolve client-side, so none of them reaches the wire. */
export interface HealthMetricsEngagementOrgQuery {
  foundationSlug: string;
  /** Absent or `null` reads the view's all-projects roll-up rows. The client no longer sends it;
   * the server keeps the optional filter. */
  projectSlug?: string | null;
}

/** One non-member organization's numbers for a single period. Every period ships on every row, so
 * the period pill re-projects client-side and costs no request. */
export interface HealthMetricsEngagementNonMemberPeriod {
  range: HealthMetricsRange;
  /** Meetings this org turned up to in the period; `0` is measured, not missing. `null` when the
   * view carries no column value for this row/period — unmeasured, not zero. */
  meetingsAttended: number | null;
  /** Distinct people it sent across those meetings. */
  distinctPeople: number | null;
  /** The view's `SORT_RANK_<period>`, best-first. Per period, so the pill re-sorts the loaded rows. */
  sortRank: number | null;
}

/** A row of the Non-member participation table. */
export interface HealthMetricsEngagementNonMemberRow {
  accountId: string;
  accountName: string;
  /** The account's logo from the account mapping; empty shows the name's first letter. */
  logoUrl: string;
  periods: HealthMetricsEngagementNonMemberPeriod[];
}

/** One Non-member participation row, ready to render for the selected period. */
export interface HealthMetricsEngagementNonMemberRowView {
  key: string;
  name: string;
  logoUrl: string;
  meetings: string;
  people: string;
}

/** The `#nonmem` scope count for one period: companies that attended a meeting in it. */
export interface HealthMetricsEngagementNonMemberPeriodCounts {
  range: HealthMetricsRange;
  orgs: number;
}

/** `GET /api/analytics/engagement-non-member-participation` — every org, every period, one read. */
export interface HealthMetricsEngagementNonMemberParticipation {
  rows: HealthMetricsEngagementNonMemberRow[];
  /** `null` when the view reports no scope count on rows that exist — unmeasured, not zero. */
  counts: HealthMetricsEngagementNonMemberPeriodCounts[] | null;
}

/** Wire query for `GET /api/analytics/engagement-non-member-participation`. The view carries no
 * project key, so the section is foundation-scoped and the period resolves client-side. */
export interface HealthMetricsEngagementNonMemberQuery {
  foundationSlug: string;
}

/** Which cut of the representatives table is showing. Every cut reads the selected period's own
 * flags, so the pill re-filters the loaded rows rather than re-reading. */
export type HealthMetricsEngagementRepFilter = (typeof HEALTH_METRICS_ENGAGEMENT_REP_FILTERS)[number]['key'];

/** One representative's numbers for a single period. Every period ships on every row, so the
 * period pill re-projects client-side and costs no request. */
export interface HealthMetricsEngagementRepPeriod {
  range: HealthMetricsRange;
  /** `null` when the view carries no column value for this row/period — unmeasured, not zero. */
  meetingsInvited: number | null;
  meetingsAttended: number | null;
  /** The view's `HAS_NEVER_ATTENDED_<period>`: invited in this period, never attended all-time. */
  neverAttended: boolean;
  /** The view's `IS_LAPSED_<period>`: invited in it, attended none of it, and last seen before it. */
  lapsed: boolean;
  /** The view's `SORT_RANK_<period>`, best-first: never attended, then lapsed, then the rest. */
  sortRank: number | null;
}

/**
 * A row of the Representatives table — one person per group per project, the grain the view
 * publishes. Rows cover every period, so a row only belongs to the visible table when it was
 * invited in the selected one.
 */
export interface HealthMetricsEngagementRepRow {
  /** The view's `_KEY`: a surrogate over (foundation, project, person, group), so unique per row. */
  key: string;
  personName: string;
  /** True when the view could not resolve the person, so the name is not a trustworthy identity. */
  identityUnresolved: boolean;
  /** The row's company, shown under the name with the job title; not a second identity. */
  accountName: string;
  jobTitle: string | null;
  committeeName: string;
  /** All-time, not per period: ISO date this person last attended this group under this project. */
  lastAttendedDate: string | null;
  periods: HealthMetricsEngagementRepPeriod[];
}

/** One Representatives row, ready to render for the selected period. */
export interface HealthMetricsEngagementRepRowView {
  key: string;
  /** Name, or the unresolved-identity placeholder. */
  displayName: string;
  unresolved: boolean;
  /** `{Company}・{Job title}`, the company alone without a title (always so for an unresolved identity), or empty. */
  description: string;
  committeeName: string;
  /** `2 / 6` — attended over invited for the selected period. */
  attendedLabel: string;
  /** Invited in the period and never attended, which shows the count as a danger badge. */
  neverAttended: boolean;
  /** Pre-rendered so the template stays free of `DatePipe`; "—" for a rep who never attended. */
  lastAttendedLabel: string;
}

/** Scope counts for one period. Unlike the org counts, this view's are period-suffixed, so the
 * sub-nav note follows the period. */
export interface HealthMetricsEngagementRepPeriodCounts {
  range: HealthMetricsRange;
  reps: number;
  neverAttendedReps: number;
}

/** `GET /api/analytics/engagement-representatives` — every representative, every period, one read. */
export interface HealthMetricsEngagementRepresentatives {
  rows: HealthMetricsEngagementRepRow[];
  /** `null` when the view reports no scope counts on rows that exist — unmeasured, not zero. */
  counts: HealthMetricsEngagementRepPeriodCounts[] | null;
}

/** Wire query for `GET /api/analytics/engagement-representatives`. Search, the filter cut and the
 * period all resolve client-side, so none of them reaches the wire. */
export interface HealthMetricsEngagementRepQuery {
  foundationSlug: string;
  /** Absent or `null` reads the all-projects rows and deduped counts. The client no longer sends
   * it; the server keeps the optional filter. */
  projectSlug?: string | null;
}

/** Query params the Engagement sections read on arrival and write back; `null` clears one the URL carries. */
export interface HealthMetricsEngagementQueryParams {
  groupType?: HealthMetricsEngagementGroupTypeFilter | null;
  groupPage?: number | null;
  orgFilter?: HealthMetricsEngagementOrgFilter | null;
  repFilter?: HealthMetricsEngagementRepFilter | null;
  nlMode?: HealthMetricsEngagementNewsletterMode | null;
  nlFilter?: HealthMetricsEngagementRecipientFilter | null;
}

/** The newsletter chart's toggle: each newsletter's rates, or its recipients and unique opens. */
export type HealthMetricsEngagementNewsletterMode = (typeof HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_MODES)[number]['key'];

/** Wire query for `GET /api/analytics/engagement-newsletter-performance`; the period resolves client-side. */
export interface HealthMetricsEngagementNewsletterQuery {
  foundationSlug: string;
}

/** The summary view's figures for one period. Rates are 0–1 shares of each newsletter's recipients. */
export interface HealthMetricsEngagementNewsletterPeriod {
  subscribers: number | null;
  subscribersGrowth: number | null;
  growthBaselineDate: string | null;
  newslettersSent: number | null;
  avgOpenRate: number | null;
  avgClickRate: number | null;
  avgClickToOpenRate: number | null;
  avgDeliveryRate: number | null;
}

/** One newsletter sent. One without engagement data carries its recipients only; every other figure is `null`. */
export interface HealthMetricsEngagementNewsletter {
  key: string;
  name: string;
  sentDate: string | null;
  hasEngagementData: boolean;
  recipients: number | null;
  failed: number | null;
  uniqueOpens: number | null;
  totalOpens: number | null;
  uniqueClicks: number | null;
  totalClicks: number | null;
  openRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
}

/** `GET /api/analytics/engagement-newsletter-performance` — every period's summary and every newsletter, latest first. */
export interface HealthMetricsEngagementNewsletterPerformance {
  /** `false` when the foundation has no summary row at all. */
  measured: boolean;
  periods: Record<HealthMetricsL2Range, HealthMetricsEngagementNewsletterPeriod | null>;
  newsletters: HealthMetricsEngagementNewsletter[];
}

/** One table row, with every cell already labelled; "—" stands in where the newsletter has no engagement data. */
export interface HealthMetricsEngagementNewsletterRowView {
  key: string;
  name: string;
  sentLabel: string;
  recipientsLabel: string;
  failedLabel: string;
  uniqueOpensLabel: string;
  totalOpensLabel: string;
  openRateLabel: string;
  /** The open-rate bar's fill, 0–100; `null` draws no bar. */
  openRatePct: number | null;
  uniqueClicksLabel: string;
  totalClicksLabel: string;
  clickRateLabel: string;
  clickToOpenLabel: string;
}

/** One newsletter on the chart. Rates are percentages (0–100); a figure the newsletter lacks is `null`. */
export interface HealthMetricsEngagementNewsletterPointView {
  key: string;
  /** The x-axis label: the send's month. */
  tick: string;
  /** "Name · Oct 26, 2026", the tooltip's title. */
  title: string;
  openPct: number | null;
  clickPct: number | null;
  clickToOpenPct: number | null;
  recipients: number | null;
  uniqueOpens: number | null;
}

/** Newsletter performance for the selected period. */
export interface HealthMetricsEngagementNewsletterView {
  isEmpty: boolean;
  /** Subscribers, newsletters sent, and the average open and click rates, with their context underneath. */
  metrics: HealthMetricsMetricItem[];
  /** Latest first, as the view ranks them. */
  rows: HealthMetricsEngagementNewsletterRowView[];
  /** Oldest first: every newsletter for the audience chart, only those with engagement data for the rates chart. */
  audiencePoints: HealthMetricsEngagementNewsletterPointView[];
  ratePoints: HealthMetricsEngagementNewsletterPointView[];
}

/** One entry of the newsletter chart's legend: a line swatch in the series colour. */
export interface HealthMetricsEngagementNewsletterLegendItem {
  key: string;
  label: string;
  color: string;
}

/** The newsletter chart for the selected mode, and its legend. */
export interface HealthMetricsEngagementNewsletterChartView {
  chart: HealthMetricsLineChartView;
  legend: HealthMetricsEngagementNewsletterLegendItem[];
}

/** The recipient table's cut: everyone, or one engagement segment. */
export type HealthMetricsEngagementRecipientFilter = (typeof HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS)[number]['key'];

/** Wire query for `GET /api/analytics/engagement-newsletter-recipients`. Search and the cut resolve client-side. */
export interface HealthMetricsEngagementRecipientQuery {
  foundationSlug: string;
}

/** One recipient of the latest newsletter. Times are UTC ISO strings; a figure the view lacks is `null`. */
export interface HealthMetricsEngagementRecipient {
  /** The view's engagement rank, unique within the newsletter; 1 is the most engaged. */
  rank: number;
  name: string | null;
  organization: string | null;
  /** `Delivered`, `Failed` or `Pending`, as the view reports it; a pending one counts as not opened. */
  deliveryStatus: string | null;
  /** `opened`, `not-opened` or `failed`. A recipient who clicked without a recorded open is `not-opened`. */
  segment: string | null;
  clicked: boolean;
  opens: number | null;
  lastOpenedAt: string | null;
  clicks: number | null;
  lastClickedAt: string | null;
}

/** The newsletter the recipients received. */
export interface HealthMetricsEngagementRecipientNewsletter {
  key: string;
  name: string;
  sentDate: string | null;
}

/** `GET /api/analytics/engagement-newsletter-recipients` — every recipient of the foundation's latest newsletter, most engaged first. */
export interface HealthMetricsEngagementNewsletterRecipients {
  /** `null` when the foundation has sent no newsletter. */
  newsletter: HealthMetricsEngagementRecipientNewsletter | null;
  recipients: HealthMetricsEngagementRecipient[];
  /** The read hit its cap, so only the most engaged recipients came back and every count covers just those. */
  truncated: boolean;
}

/** One recipient row, every cell labelled; a failed delivery reads "—" for engagement, opens and clicks. */
export interface HealthMetricsEngagementRecipientRowView {
  rank: number;
  nameLabel: string;
  /** The avatar's name, empty without one so the avatar shows its glyph rather than the "—" the text shows. */
  avatarName: string;
  /** The recipient's company, under the name; empty without one. */
  description: string;
  deliveryLabel: string;
  deliveryTone: HealthMetricsEngagementRecipientTone;
  /** Empty for a failed delivery, which shows "—" instead of a badge. */
  engagementLabel: string;
  engagementTone: HealthMetricsEngagementRecipientTone;
  opensLabel: string;
  /** "Last opened 3d", or empty without a time or for a failed delivery. */
  opensDescription: string;
  clicksLabel: string;
  clicksDescription: string;
}

/** A recipient badge's colour role. */
export type HealthMetricsEngagementRecipientTone = 'success' | 'danger' | 'neutral' | 'accent';
