// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_MEMBERS_AT_RISK_BUCKETS,
  HEALTH_METRICS_MEMBERS_AT_RISK_CHURN_RISKS,
  HEALTH_METRICS_MEMBERS_BOARD_COHORTS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_LEVELS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES,
  HEALTH_METRICS_MEMBERS_RESERVED_TIERS,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from '../constants/health-metrics-members.constants';
import type { FilterPillOption } from './dashboard-metric.interface';
import type { FilterOption } from './filter.interface';
import type { HealthMetricsEngagementAttendanceTone } from './health-metrics-engagement.interface';
import type { HealthMetricsChartTipView, HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';
import type { HealthMetricsOverviewKpiView } from './health-metrics-overview.interface';

/** Section key from the design's `M2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsMembersSectionKey = (typeof HEALTH_METRICS_MEMBERS_SECTIONS)[number]['key'];

/** A read a deep link waits on: one per section. */
export type HealthMetricsMembersDataSectionKey = HealthMetricsMembersSectionKey;

/** Members' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsMembersSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsMembersSectionKey;
}

/** `GET /api/analytics/members-tiers` — every year's tier rows; the section is re-projected per period client-side. */
export interface HealthMetricsMembersTiersQuery {
  foundationSlug: string;
}

/** One `MEMBERSHIP_TIER_YEAR` row: a tier's figures for one year. `null` is unmeasured, never zero. */
export interface HealthMetricsMembersTierYear {
  year: number;
  tier: string;
  sortRank: number;
  memberCount: number | null;
  revenueUsd: number | null;
}

export interface HealthMetricsMembersTiers {
  /** Newest year first, then `tier_sort_rank`, then tier name. */
  rows: HealthMetricsMembersTierYear[];
}

/** Diamond, Platinum, Gold or Silver: the tiers with a colour and an icon of their own. */
export type HealthMetricsMembersReservedTier = (typeof HEALTH_METRICS_MEMBERS_RESERVED_TIERS)[number];

/** A tier icon's fill, and the CSS mask that cuts it to shape. */
export interface HealthMetricsMembersTierIcon {
  background: string;
  mask: string;
  radius: string;
}

/** A palette colour for the other tiers, and the reserved tier it could be mistaken for. */
export interface HealthMetricsMembersBreakdownPaletteEntry {
  color: string;
  resembles: HealthMetricsMembersReservedTier | null;
}

export type HealthMetricsMembersBreakdownViewMode = 'chart' | 'table';

export interface HealthMetricsMembersBreakdownViewOption {
  value: HealthMetricsMembersBreakdownViewMode;
  /** The tooltip and screen-reader name of the icon-only option. */
  label: string;
  icon: string;
}

/** One stacked segment, positioned as a share of the chart's height. */
export interface HealthMetricsMembersBreakdownSegmentView {
  key: string;
  color: string;
  bottomPct: number;
  heightPct: number;
}

/** One year's column: its stack, the labels under it and its popup. */
export interface HealthMetricsMembersBreakdownColumnView {
  year: number;
  /** e.g. `2026 YTD` for the running year. */
  label: string;
  membersLabel: string;
  /** Bottom to top. */
  segments: HealthMetricsMembersBreakdownSegmentView[];
  tip: HealthMetricsChartTipView;
  /** The popup's figures in a sentence, for a screen reader on the focused column. */
  ariaLabel: string;
}

export interface HealthMetricsMembersBreakdownLegendItemView {
  label: string;
  color: string;
  /** A divider before the item, setting the grey tiers apart. */
  divided: boolean;
}

export type HealthMetricsMembersBreakdownRowKind = 'tier' | 'total' | 'change';

export interface HealthMetricsMembersBreakdownCellView {
  label: string;
  /** A change row's direction; `null` for any other cell and for a change with nothing to compare. */
  tone: 'up' | 'down' | null;
}

/** One row of the table view: a tier, a total, or the change under a total. */
export interface HealthMetricsMembersBreakdownRowView {
  key: string;
  label: string;
  kind: HealthMetricsMembersBreakdownRowKind;
  icon: HealthMetricsMembersReservedTier | null;
  /** One per year, in the columns' order. */
  cells: HealthMetricsMembersBreakdownCellView[];
}

/** The breakdown table's class strings, by row kind where they differ. */
export interface HealthMetricsMembersBreakdownTableClasses {
  label: Record<HealthMetricsMembersBreakdownRowKind, string>;
  cell: Record<HealthMetricsMembersBreakdownRowKind, string>;
  lastCell: Record<HealthMetricsMembersBreakdownRowKind, string>;
  change: Record<'up' | 'down', string>;
  cellBase: string;
  rowRule: string;
  cellRule: string;
  totalRule: string;
}

/** A table row as drawn: its rules, and each cell's type and fill as classes. */
export interface HealthMetricsMembersBreakdownTableRow {
  key: string;
  label: string;
  icon: HealthMetricsMembersReservedTier | null;
  rowClass: string;
  labelClass: string;
  cells: { label: string; cellClass: string }[];
}

/** `#breakdown`, built over the loaded years; only the metrics row follows the selected period. */
export interface HealthMetricsMembersBreakdownView {
  /** False when no year in the chart has a tier row. */
  measured: boolean;
  kpis: HealthMetricsOverviewKpiView[];
  /** The y axis, top to bottom. */
  yTicks: string[];
  columns: HealthMetricsMembersBreakdownColumnView[];
  legend: HealthMetricsMembersBreakdownLegendItemView[];
  rows: HealthMetricsMembersBreakdownRowView[];
  /** The selected year's members, for the sub-nav badge; `null` when unmeasured. */
  count: number | null;
}

/** `GET /api/analytics/members-growth` — every year's months at once, so the view switch never re-reads. */
export interface HealthMetricsMembersGrowthQuery {
  foundationSlug: string;
}

/** One `MEMBERSHIP_GROWTH_MONTHLY` row: new members from January through the month. `null` is unmeasured. */
export interface HealthMetricsMembersGrowthMonth {
  year: number;
  /** 1 to 12. */
  month: number;
  cumulative: number | null;
}

export interface HealthMetricsMembersGrowth {
  /** Newest year first, then month. */
  months: HealthMetricsMembersGrowthMonth[];
}

/** A month's point on a year's line, in percent of the plot box, with its value drawn above it. */
export interface HealthMetricsMembersGrowthPointView {
  month: number;
  leftPct: number;
  topPct: number;
  label: string;
}

/** One year's line, as an SVG path over the plot's viewBox; only the period's year is solid. */
export interface HealthMetricsMembersGrowthLineView {
  year: number;
  color: string;
  dashed: boolean;
  d: string;
  points: HealthMetricsMembersGrowthPointView[];
}

/** A month's hover and focus target, centred on it and spanning the month spacing, with its popup. */
export interface HealthMetricsMembersGrowthColumnView {
  month: number;
  label: string;
  leftPct: number;
  widthPct: number;
  tip: HealthMetricsChartTipView;
  ariaLabel: string;
}

/** `#growth`: cumulative new members by month, one line per year. */
export interface HealthMetricsMembersGrowthView {
  /** False when no year has a measured month. */
  measured: boolean;
  /** The y axis's top label; the bottom is 0. */
  yMax: string;
  /** Oldest year first, so the newest draws on top; the legend reads in the same order. */
  lines: HealthMetricsMembersGrowthLineView[];
  columns: HealthMetricsMembersGrowthColumnView[];
  ariaLabel: string;
}

/** A `MEMBERSHIP_DIRECTORY` NPS category, and the values the directory's NPS filter accepts. */
export type HealthMetricsMembersNpsCategory = (typeof HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES)[number];

/** The model's own engagement band; the page never re-bands the score. */
export type HealthMetricsMembersEngagementLevel = (typeof HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_LEVELS)[number];

/** `GET /api/analytics/members-directory` — one page of the foundation's members. Empty filters match all. */
export interface HealthMetricsMembersDirectoryQuery {
  foundationSlug: string;
  /** Picks the period columns for the activity counts. */
  range: HealthMetricsL2Range;
  tier: string;
  nps: HealthMetricsMembersNpsCategory | '';
  search: string;
  offset: number;
  pageSize: number;
}

/** One `MEMBERSHIP_DIRECTORY` row. Dates are ISO `YYYY-MM-DD`; `null` is not tracked, never zero. */
export interface HealthMetricsMembersDirectoryMember {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  annualDuesUsd: number | null;
  engagementLevel: HealthMetricsMembersEngagementLevel | null;
  engagementScore: number | null;
  npsCategory: HealthMetricsMembersNpsCategory | null;
  isAtRisk: boolean;
  renewalDate: string | null;
  renewalDuesUsd: number | null;
  lastEngagedDate: string | null;
  /** The selected period's activity. */
  contributionCount: number | null;
  sponsorshipUsd: number | null;
  trainingEnrollmentCount: number | null;
  eventRegistrationCount: number | null;
}

export interface HealthMetricsMembersDirectory {
  rows: HealthMetricsMembersDirectoryMember[];
  /** Members matching the filters and search. */
  totalRecords: number;
  /** Every member of the foundation; the sub-nav badge and the unfiltered count. */
  scopeTotal: number;
  /** At-risk members across the whole foundation, whatever the filters. */
  atRiskCount: number;
}

/** `GET /api/analytics/members-directory-tiers` — read once per foundation, not per page. */
export interface HealthMetricsMembersDirectoryTiersQuery {
  foundationSlug: string;
}

export interface HealthMetricsMembersDirectoryTiers {
  /** Tiers present in the foundation, highest-paying first, for the tier filter. */
  tiers: string[];
}

/** A tier filter option; `disabled` marks the notice shown when the tier read failed. */
export interface HealthMetricsMembersDirectoryTierOption extends FilterOption<string> {
  disabled?: boolean;
}

/** One member row as the directory table renders it. */
export interface HealthMetricsMembersDirectoryRowView {
  accountId: string;
  accountName: string;
  npsLabel: string | null;
  npsClass: string;
  isAtRisk: boolean;
  tierLabel: string;
  duesLabel: string;
  engagementLabel: string;
  engagementDotClass: string;
  scoreLabel: string;
  renewsLabel: string;
  renewalDuesLabel: string;
  lastEngagedLabel: string;
  activity: HealthMetricsMembersDirectoryCellView[];
}

/** An activity cell; `tracked` false renders the not-tracked dash, never 0. */
export interface HealthMetricsMembersDirectoryCellView {
  key: string;
  label: string;
  tracked: boolean;
}

/** Each section's filter and page state in the URL; `null` clears a param the URL already carries. */
export interface HealthMetricsMembersQueryParams {
  memTier?: string | null;
  memNps?: HealthMetricsMembersNpsCategory | null;
  memSearch?: string | null;
  memPage?: number | null;
  riskBucket?: HealthMetricsMembersAtRiskBucket | null;
  riskPage?: number | null;
  renewalsWindow?: HealthMetricsMembersRenewalsWindow | null;
  renewalsPage?: number | null;
  boardCohort?: HealthMetricsMembersBoardCohort | null;
  boardPage?: number | null;
  npsAudience?: string | null;
  churnMode?: HealthMetricsMembersChurnMode | null;
  churnPage?: number | null;
}

/** A `MEMBERSHIP_AT_RISK` aging bucket past 60 days; the section leaves out balances under 60 days. */
export type HealthMetricsMembersAtRiskBucket = (typeof HEALTH_METRICS_MEMBERS_AT_RISK_BUCKETS)[number];

/** `MEMBERSHIP_AT_RISK`'s `churn_risk` bands. */
export type HealthMetricsMembersChurnRisk = (typeof HEALTH_METRICS_MEMBERS_AT_RISK_CHURN_RISKS)[number];

/** The bucket pill: one aging bucket, or `all` for both. */
export type HealthMetricsMembersAtRiskFilter = HealthMetricsMembersAtRiskBucket | 'all';

/** `GET /api/analytics/members-at-risk` — a snapshot of now, so it takes no period. */
export interface HealthMetricsMembersAtRiskQuery {
  foundationSlug: string;
  bucket: HealthMetricsMembersAtRiskFilter;
  offset: number;
  pageSize: number;
}

/** One at-risk member, in the view's own `sort_rank` order. Dates are ISO `YYYY-MM-DD`. */
export interface HealthMetricsMembersAtRiskMember {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  outstandingBalanceUsd: number | null;
  daysOverdue: number | null;
  lastEngagedDate: string | null;
  /** The model's own risk band for the member; `null` when unset. */
  churnRisk: HealthMetricsMembersChurnRisk | null;
  agingBucket: HealthMetricsMembersAtRiskBucket | null;
}

/**
 * The hero, summed over every member 60+ days overdue whatever the bucket pill; with a bucket picked it exceeds the
 * table's total. `null` is a total the model left unset for a foundation with members at risk, never a zero.
 */
export interface HealthMetricsMembersAtRiskSummary {
  outstandingBalanceUsd: number | null;
  highRiskBalanceUsd: number | null;
  mediumRiskBalanceUsd: number | null;
  memberCount: number | null;
}

/** One aging bar; always both buckets, whatever the selected pill. `null` is an unset model total, as in the summary. */
export interface HealthMetricsMembersAtRiskAging {
  bucket: HealthMetricsMembersAtRiskBucket;
  memberCount: number | null;
  balanceUsd: number | null;
}

export interface HealthMetricsMembersAtRisk {
  rows: HealthMetricsMembersAtRiskMember[];
  /** Members in the selected bucket. */
  totalRecords: number;
  summary: HealthMetricsMembersAtRiskSummary;
  aging: HealthMetricsMembersAtRiskAging[];
}

/** A bucket pill; `all` is "All at risk". */
export interface HealthMetricsMembersAtRiskFilterOption extends FilterPillOption {
  id: HealthMetricsMembersAtRiskFilter;
}

/** The hero as the section renders it. */
export interface HealthMetricsMembersAtRiskSummaryView {
  outstandingLabel: string;
  highRiskLabel: string;
  mediumRiskLabel: string;
  memberCountLabel: string;
}

/** One aging bar as the section renders it; `widthPct` is against the larger bucket's balance. */
export interface HealthMetricsMembersAtRiskAgingView {
  bucket: HealthMetricsMembersAtRiskBucket;
  label: string;
  balanceLabel: string;
  widthPct: number;
}

/** One at-risk row as the table renders it. */
export interface HealthMetricsMembersAtRiskRowView {
  accountId: string;
  accountName: string;
  tierLabel: string;
  overdueLabel: string;
  ageLabel: string;
  lastEngagedLabel: string;
}

/** A `MEMBERSHIP_RENEWALS` window, each backed by the model's own `is_renewing_*` flag and foundation totals. */
export type HealthMetricsMembersRenewalsWindow = (typeof HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS)[number];

/** A window pill. */
export interface HealthMetricsMembersRenewalsWindowOption extends FilterPillOption {
  id: HealthMetricsMembersRenewalsWindow;
}

/** `GET /api/analytics/members-renewals` — a snapshot of now, so it takes no period, only a window. */
export interface HealthMetricsMembersRenewalsQuery {
  foundationSlug: string;
  window: HealthMetricsMembersRenewalsWindow;
  offset: number;
  pageSize: number;
}

/** One renewal inside the window, soonest first. Dates are ISO `YYYY-MM-DD`; `null` dues is not recorded, never $0. */
export interface HealthMetricsMembersRenewal {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  renewalDate: string | null;
  daysUntilRenewal: number | null;
  /** Already renewed; the model's window totals still count it. */
  hasRenewed: boolean;
  duesUsd: number | null;
  /** The renewal plus a concurrent risk signal (MEM-02); every other row carries no status. */
  hasOutstandingBalance: boolean;
}

/** The hero over every renewal in the window. `valueUsd` sums the known dues; `withoutDuesCount` renewals have none on record. */
export interface HealthMetricsMembersRenewalsSummary {
  renewalCount: number | null;
  valueUsd: number | null;
  withoutDuesCount: number | null;
}

export interface HealthMetricsMembersRenewals {
  rows: HealthMetricsMembersRenewal[];
  totalRecords: number;
  summary: HealthMetricsMembersRenewalsSummary;
}

/** The renewals hero as the section renders it; `coverageNote` is empty when every renewal has dues. */
export interface HealthMetricsMembersRenewalsSummaryView {
  valueLabel: string;
  renewalCountLabel: string;
  coverageNote: string;
}

/** One renewal row as the table renders it. */
export interface HealthMetricsMembersRenewalRowView {
  accountId: string;
  accountName: string;
  tierLabel: string;
  renewalDateLabel: string;
  duesLabel: string;
  hasOutstandingBalance: boolean;
  hasRenewed: boolean;
}

/** `MEMBERSHIP_BOARD_ATTENDANCE`'s `attendance_cohort` values. */
export type HealthMetricsMembersBoardCohort = (typeof HEALTH_METRICS_MEMBERS_BOARD_COHORTS)[number];

/** The Board / Voting members toggle. */
export interface HealthMetricsMembersBoardCohortOption extends FilterPillOption {
  id: HealthMetricsMembersBoardCohort;
}

/** `GET /api/analytics/members-board-attendance` — one cohort's meetings in the period, one page at a time. */
export interface HealthMetricsMembersBoardAttendanceQuery {
  foundationSlug: string;
  range: HealthMetricsL2Range;
  cohort: HealthMetricsMembersBoardCohort;
  offset: number;
  pageSize: number;
}

/** One cohort's period figures as the view carries them; every field is `null` when the period held no meeting. */
export interface HealthMetricsMembersBoardCohortSummary {
  /** 0–1 share of the invited who attended the latest meeting in the period. */
  latestAttendancePct: number | null;
  latestAttendedCount: number | null;
  latestInvitedCount: number | null;
  meetingsInRangeCount: number | null;
  neverAttendedCount: number | null;
  /** The view's level flag (one 90% line for both cohorts); read only when the share is missing. */
  isBelowExpectedLevel: boolean | null;
}

/** One meeting occurrence of the cohort. `meetingDate` is ISO `YYYY-MM-DD`; `attendancePct` is 0–1. */
export interface HealthMetricsMembersBoardMeeting {
  meetingId: string;
  committeeName: string | null;
  meetingDate: string | null;
  attendedCount: number | null;
  invitedCount: number | null;
  attendancePct: number | null;
  /** The view's latest meeting in the period — the one the hero reports. */
  isLatestMeeting: boolean;
}

/** `cohorts` carries both cohorts so the hero can show the other one; `null` when the foundation has no row for it. */
export interface HealthMetricsMembersBoardAttendance {
  cohorts: Record<HealthMetricsMembersBoardCohort, HealthMetricsMembersBoardCohortSummary | null>;
  /** The selected cohort's latest meetings in the period, oldest first, for the chart. */
  trend: HealthMetricsMembersBoardMeeting[];
  /** One page of the selected cohort's meetings in the period, newest first. */
  rows: HealthMetricsMembersBoardMeeting[];
  totalRecords: number;
}

/** The latest meeting against its cohort's rule: below it (red or amber), or not. */
export type HealthMetricsMembersBoardLatestTone = Extract<HealthMetricsEngagementAttendanceTone, 'low' | 'critical' | 'ok'>;

/** The board hero as the section renders it. */
export interface HealthMetricsMembersBoardSummaryView {
  meetingsLabel: string;
  latestPctLabel: string;
  latestCaption: string;
  isBelowExpectedLevel: boolean;
  latestTone: HealthMetricsMembersBoardLatestTone;
  latestTextClass: string;
  otherCohortLabel: string;
  otherCohortPctLabel: string;
  attendedInvitedLabel: string;
  neverAttendedLabel: string;
  neverAttendedCount: number;
}

/** One meeting row as the table renders it; `ratePct` is a whole percent, `null` when unmeasured. */
export interface HealthMetricsMembersBoardMeetingRowView {
  meetingId: string;
  committeeName: string;
  dateLabel: string;
  attendedLabel: string;
  ratePct: number | null;
  rateLabel: string;
  rateFillClass: string;
}

/** One bar of the trend chart, oldest first; `pct` is a whole percent, `null` when unmeasured. */
export interface HealthMetricsMembersBoardTrendBarView {
  meetingId: string;
  label: string;
  dateLabel: string;
  committeeName: string;
  pct: number | null;
  pctLabel: string;
  isLatest: boolean;
}

/** `GET /api/analytics/members-nps` — one audience's survey figures for a period; `null` picks the first audience. */
export interface HealthMetricsMembersNpsQuery {
  foundationSlug: string;
  range: HealthMetricsL2Range;
  audience: string | null;
}

/** One audience surveyed in the period; `isSampleTooSmall` is the view's 40% response-rate line, read only without a rate. */
export interface HealthMetricsMembersNpsAudience {
  audience: string;
  npsScore: number | null;
  /** Points since the audience's previous survey wave. */
  scoreChangePp: number | null;
  recipientsCount: number | null;
  responsesCount: number | null;
  /** 0–1 share of recipients who responded. */
  responseRatePct: number | null;
  promotersCount: number | null;
  passivesCount: number | null;
  detractorsCount: number | null;
  noResponseCount: number | null;
  isSampleTooSmall: boolean;
  /** The survey wave the figures come from, e.g. `Q2 2026`. */
  lastUpdatedQuarter: string | null;
}

/** One survey wave of the selected audience; `quarterStartDate` is ISO `YYYY-MM-DD`, `responseRatePct` 0–1. */
export interface HealthMetricsMembersNpsQuarter {
  quarterStartDate: string;
  quarterLabel: string | null;
  npsScore: number | null;
  responseRatePct: number | null;
  isSampleTooSmall: boolean;
}

/** Audiences in toggle order, the one the figures belong to, and its waves up to the period's end, oldest first. */
export interface HealthMetricsMembersNps {
  audiences: HealthMetricsMembersNpsAudience[];
  selectedAudience: string | null;
  trend: HealthMetricsMembersNpsQuarter[];
}

/** The audience toggle over the hero; the id is the view's audience name. */
export interface HealthMetricsMembersNpsAudienceOption extends FilterPillOption {
  id: string;
}

/** The note under the response distribution; `lead` is the bolded opening, when there is one. */
export interface HealthMetricsMembersNpsFooterView {
  isBelowFloor: boolean;
  lead: string | null;
  text: string;
}

/** The NPS hero as the section renders it; a missing score renders the dash and the not-enough caption. */
export interface HealthMetricsMembersNpsSummaryView {
  isUnscored: boolean;
  /** A score on a flagged sample or a below-floor rate, rendered in amber. */
  isLowConfidence: boolean;
  scoreLabel: string;
  /** `null` renders no change. */
  changeLabel: string | null;
  changeDirection: 'up' | 'down' | 'neutral';
  caption: string;
  respondedLabel: string;
  rateLabel: string;
  isRateBelowFloor: boolean;
  /** The low-confidence banner, when the view flags the sample too small. */
  lowSampleNote: string | null;
  lastUpdatedLabel: string;
  surveyedLabel: string;
  footer: HealthMetricsMembersNpsFooterView;
}

/** One segment of the response distribution; `widthPct` is its share of everyone surveyed. */
export interface HealthMetricsMembersNpsSegmentView {
  key: string;
  label: string;
  countLabel: string;
  widthPct: number;
  colorClass: string;
}

/** One wave of the trend chart; `ratePct` is a whole percent, `null` when unmeasured. */
export interface HealthMetricsMembersNpsTrendPointView {
  quarterStartDate: string;
  label: string;
  score: number | null;
  scoreLabel: string;
  /** The score as the tooltip and screen-reader table read it, noting a low-response wave. */
  scoreDescription: string;
  ratePct: number | null;
  rateLabel: string;
  isRateBelowFloor: boolean;
  /** A score on a flagged sample or a below-floor rate, drawn as an amber bar. */
  isLowConfidence: boolean;
}

/** The sentence under the trend: a score rising on a falling rate, a rate below the floor, or a rate holding. */
export interface HealthMetricsMembersNpsTrendNote {
  kind: 'diverging' | 'below-floor' | 'holding';
  scoreChangeLabel: string;
  fromRateLabel: string;
  toRateLabel: string;
}

/** `GET /api/analytics/members-churn` — every year's churn; the section re-projects it per period client-side. */
export interface HealthMetricsMembersChurnQuery {
  foundationSlug: string;
}

/** One all-tiers `MEMBERSHIP_CHURN` row. Rates are percentages (0–100); `null` is unmeasured, never zero. */
export interface HealthMetricsMembersChurnYear {
  year: number;
  isPartialYear: boolean;
  lostCount: number | null;
  openingCount: number | null;
  duesLostUsd: number | null;
  duesLostPriorUsd: number | null;
  /** Share of the opening dues that did not renew (`dues_lost_usd / opening_arr_usd`), not the view's net rate. */
  revenueNotRenewedRate: number | null;
  logoChurnRate: number | null;
}

/** One tier's `MEMBERSHIP_CHURN` row for a year. Rates are percentages (0–100). */
export interface HealthMetricsMembersChurnTier {
  year: number;
  tier: string;
  tierSortRank: number;
  lostCount: number | null;
  churnRate: number | null;
  duesLostUsd: number | null;
  shareOfLossPct: number | null;
}

export interface HealthMetricsMembersChurn {
  /** Newest year first. */
  years: HealthMetricsMembersChurnYear[];
  /** Newest year first, then `tier_sort_rank`. */
  tiers: HealthMetricsMembersChurnTier[];
}

/** `GET /api/analytics/members-churn-departures` — one page of the memberships lost in a year. */
export interface HealthMetricsMembersChurnDeparturesQuery {
  foundationSlug: string;
  year: number;
  offset: number;
  pageSize: number;
}

/** One lost membership from `MEMBERSHIP_CHURNED_MEMBERS`, keyed by its term; dates are ISO `YYYY-MM-DD`. */
export interface HealthMetricsMembersChurnDeparture {
  /** An organization can lose two memberships in a year, so rows are keyed by the lost term, not the account. */
  key: string;
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  duesLostUsd: number | null;
  lapsedDate: string | null;
  lastEngagedDate: string | null;
}

export interface HealthMetricsMembersChurnDepartures {
  rows: HealthMetricsMembersChurnDeparture[];
  /** Every membership lost in the year, so the table can check it against the churn count. */
  totalRecords: number;
}

/** The toggle over the hero: revenue churn leads, logo churn counts each loss once. */
export type HealthMetricsMembersChurnMode = 'revenue' | 'logo';

export interface HealthMetricsMembersChurnModeOption extends FilterPillOption {
  id: HealthMetricsMembersChurnMode;
}

/** One figure beside the hero; `note` is the muted aside after the value. */
export interface HealthMetricsMembersChurnSideView {
  key: string;
  label: string;
  value: string;
  note: string | null;
  isLoss: boolean;
}

/** One tier of "Where the loss sits"; `shareWidthPct` keeps a visible stub for a tiny share. */
export interface HealthMetricsMembersChurnTierRowView {
  tier: string;
  lostLabel: string;
  rateLabel: string;
  isHighRate: boolean;
  duesLabel: string;
  shareLabel: string;
  shareWidthPct: number;
}

/** The note under the tier table, set only when the tier that lost most members is not the one that lost most dues. */
export interface HealthMetricsMembersChurnInversionView {
  /** Bolded, e.g. "Silver lost 83 memberships". */
  countLead: string;
  /** Bolded, e.g. "Gold lost the money". */
  duesLead: string;
  text: string;
}

/** One year of the churn trend, oldest first; `value` is the mode's rate, `null` when unmeasured. */
export interface HealthMetricsMembersChurnTrendPointView {
  year: number;
  label: string;
  value: number | null;
  valueLabel: string;
  isSelected: boolean;
}

/** `#churn`, re-projected per period and mode from the every-year response. */
export interface HealthMetricsMembersChurnView {
  /** Any year has churn figures. */
  measured: boolean;
  /** The selected period's year has churn figures. */
  yearMeasured: boolean;
  year: number;
  /** The year lost at least one membership. */
  hasChurn: boolean;
  lostCount: number;
  metaLabel: string;
  heroLabel: string;
  /** `null` renders no change: the prior year is not in the read. */
  changeLabel: string | null;
  /** A rise in churn is bad, so it renders red. */
  changeTone: 'bad' | 'good' | 'neutral';
  caption: string;
  sides: HealthMetricsMembersChurnSideView[];
  tiers: HealthMetricsMembersChurnTierRowView[];
  inversion: HealthMetricsMembersChurnInversionView | null;
  trendTitle: string;
  trendSubtitle: string;
  trend: HealthMetricsMembersChurnTrendPointView[];
  /** The selected year's churn rose on the year before, so its bar warns. */
  trendRose: boolean;
}

/** One lost membership in "Who left"; an organization appears once per lost term. */
export interface HealthMetricsMembersChurnDepartureRowView {
  key: string;
  accountId: string;
  accountName: string;
  tierLabel: string;
  duesLabel: string;
  lapsedLabel: string;
  lastEngagedLabel: string;
}
