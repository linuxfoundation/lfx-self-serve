// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_MEMBERS_AT_RISK_BUCKETS,
  HEALTH_METRICS_MEMBERS_BOARD_COHORTS,
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_LEVELS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES,
  HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from '../constants/health-metrics-members.constants';
import type { FilterPillOption } from './dashboard-metric.interface';
import type { FilterOption } from './filter.interface';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `M2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsMembersSectionKey = (typeof HEALTH_METRICS_MEMBERS_SECTIONS)[number]['key'];

/** A read a deep link waits on: a section, or `bridge`, the second read inside `#tiers`. */
export type HealthMetricsMembersDataSectionKey = HealthMetricsMembersSectionKey | 'bridge';

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
  newMemberCount: number | null;
  revenueUsd: number | null;
  isPartialYear: boolean;
}

/** The foundation's revenue across every domain for one period, from the Overview revenue model. */
export interface HealthMetricsMembersFoundationRevenue {
  range: HealthMetricsL2Range;
  totalUsd: number;
}

export interface HealthMetricsMembersTiers {
  /** Newest year first, then `tier_sort_rank`, then tier name; the view re-sorts years for display. */
  rows: HealthMetricsMembersTierYear[];
  /** A period the Overview model has no total for is left out, so its share reads as not available. */
  foundationRevenue: HealthMetricsMembersFoundationRevenue[];
}

/** The Members / Revenue toggle over the hero. */
export type HealthMetricsMembersTiersMode = 'members' | 'revenue';

export interface HealthMetricsMembersTiersModeOption {
  id: HealthMetricsMembersTiersMode;
  label: string;
}

export interface HealthMetricsMembersTiersStatView {
  key: string;
  label: string;
  value: string;
  /** `null` renders no delta; `not available` renders as text. */
  delta: string | null;
  deltaDirection: 'up' | 'down' | 'neutral';
  /** What a measured delta compares against, e.g. `vs 2024`; `null` when there is none to state. */
  baseline: string | null;
  /** Drawn in the design's green, e.g. new members. */
  positive: boolean;
}

/** One year column of the matrix and one bar of the composition chart. */
export interface HealthMetricsMembersTiersYearView {
  year: number;
  isCurrent: boolean;
  isPartial: boolean;
  /** `null` when every tier's count is unmeasured. */
  totalMembers: number | null;
  totalMembersLabel: string;
  totalRevenueLabel: string;
}

export interface HealthMetricsMembersTiersCellView {
  year: number;
  count: number | null;
  /** `—` for a measured zero or an unmeasured count. */
  label: string;
  /** Share of that year's members, 0–100; 0 when the year has none, `null` when the count is unmeasured. */
  sharePct: number | null;
}

export interface HealthMetricsMembersTiersTierView {
  tier: string;
  color: string;
  /** One cell per year column, in the same order. */
  cells: HealthMetricsMembersTiersCellView[];
}

export interface HealthMetricsMembersTiersView {
  /** False when the foundation has no tier rows at all. */
  measured: boolean;
  /** False when the selected period's year has no tier rows. */
  yearMeasured: boolean;
  metaLabel: string;
  headline: HealthMetricsMembersTiersStatView;
  side: HealthMetricsMembersTiersStatView[];
  years: HealthMetricsMembersTiersYearView[];
  tiers: HealthMetricsMembersTiersTierView[];
}

/** One year's tier rows summed; a figure is `null` when no row in the year measures it. */
export interface HealthMetricsMembersTiersYearSummary {
  measured: boolean;
  isPartial: boolean;
  members: number | null;
  newMembers: number | null;
  revenue: number | null;
}

/** `GET /api/analytics/members-bridge` — every year's bridge; the section re-projects it per period client-side. */
export interface HealthMetricsMembersBridgeQuery {
  foundationSlug: string;
}

/** A `MEMBERSHIP_WATERFALL` movement: the four that change the base between its start and end totals. */
export type HealthMetricsMembersMovementType = Exclude<HealthMetricsMembersBridgeStepType, 'start_of_year' | 'today'>;

/** A bridge step: the start-of-year total, a movement, or the closing total the model calls `today`. */
export type HealthMetricsMembersBridgeStepType = (typeof HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES)[number];

/** One `MEMBERSHIP_WATERFALL` row. `null` is unmeasured, never zero. */
export interface HealthMetricsMembersBridgeStep {
  year: number;
  movementType: HealthMetricsMembersBridgeStepType;
  sortOrder: number;
  isPartialYear: boolean;
  memberCount: number | null;
  /** Negative for downgrades and churn; the model's own sign, never re-derived. */
  signedMemberCount: number | null;
  revenueImpactUsd: number | null;
}

export interface HealthMetricsMembersBridge {
  /** Newest year first, then `sort_order`. */
  steps: HealthMetricsMembersBridgeStep[];
}

/** The movements a bar opens as a named list; churn lives in `#churn` instead. */
export type HealthMetricsMembersMovementListType = (typeof HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES)[number];

/** `GET /api/analytics/members-movements` — one page of the organizations behind one bar. */
export interface HealthMetricsMembersMovementsQuery {
  foundationSlug: string;
  year: number;
  movementType: HealthMetricsMembersMovementListType;
  offset: number;
  pageSize: number;
}

/** One `MEMBERSHIP_MOVEMENT_DETAIL` row. Dates are ISO `YYYY-MM-DD`. */
export interface HealthMetricsMembersMovement {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  duesImpactUsd: number | null;
  movementDate: string | null;
  lastEngagedDate: string | null;
}

export interface HealthMetricsMembersMovements {
  rows: HealthMetricsMembersMovement[];
  /** Every organization behind the bar, so the drawer can check it against the bar's count. */
  totalRecords: number;
}

/** A bar's colour: the start and end totals are neutral, gains green, losses red. */
export type HealthMetricsMembersBridgeTone = 'neutral' | 'gain' | 'loss';

/** One bar of the selected year's bridge, positioned as a share of the chart's height. */
export interface HealthMetricsMembersBridgeBarView {
  movementType: HealthMetricsMembersBridgeStepType;
  label: string;
  countLabel: string;
  /** Empty when the model has no dues figure for the step. */
  duesLabel: string;
  tone: HealthMetricsMembersBridgeTone;
  bottomPct: number;
  heightPct: number;
  /** The list the bar opens; `null` for the totals, churn, and an empty movement. */
  listType: HealthMetricsMembersMovementListType | null;
  /** True for a churn bar with members to show, which goes to `#churn`. */
  opensChurn: boolean;
  memberCount: number | null;
  ariaLabel: string;
}

/** `#tiers` bridge, re-projected per period from the every-year response. */
export interface HealthMetricsMembersBridgeView {
  /** Any year has a bridge. */
  measured: boolean;
  /** The selected period's year has a bridge. */
  yearMeasured: boolean;
  year: number;
  heading: string;
  bars: HealthMetricsMembersBridgeBarView[];
  /** Set when start + the signed movements does not equal the end total the model reports. */
  reconcileNote: string | null;
}

/** Fixed copy for one movement list's drawer. */
export interface HealthMetricsMembersMovementDrawerCopy {
  title: string;
  pastTitle: string;
  subtitle: string;
  note: string;
  verb: string;
}

/** One organization in a movement drawer. */
export interface HealthMetricsMembersMovementRowView {
  accountId: string;
  accountName: string;
  detail: string;
  duesLabel: string;
  loss: boolean;
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
  renewalsPage?: number | null;
  boardCohort?: HealthMetricsMembersBoardCohort | null;
  boardPage?: number | null;
  npsAudience?: string | null;
  churnMode?: HealthMetricsMembersChurnMode | null;
  churnPage?: number | null;
}

/** A `MEMBERSHIP_AT_RISK` aging bucket past 60 days; the section leaves out balances under 60 days. */
export type HealthMetricsMembersAtRiskBucket = (typeof HEALTH_METRICS_MEMBERS_AT_RISK_BUCKETS)[number];

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

/** `GET /api/analytics/members-renewals` — a snapshot of now, so it takes no period. */
export interface HealthMetricsMembersRenewalsQuery {
  foundationSlug: string;
  offset: number;
  pageSize: number;
}

/** One renewal still to happen inside the next 90 days, soonest first. Dates are ISO `YYYY-MM-DD`; `null` dues is not recorded, never $0. */
export interface HealthMetricsMembersRenewal {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  renewalDate: string | null;
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
  /** The view's own level flag; the page never compares the share with a threshold. */
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

/** The board hero as the section renders it. */
export interface HealthMetricsMembersBoardSummaryView {
  meetingsLabel: string;
  latestPctLabel: string;
  latestCaption: string;
  isBelowExpectedLevel: boolean;
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

/** One audience surveyed in the period. Scores are `null` when the view flags the sample too small to report. */
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

/** The NPS hero as the section renders it; a withheld score renders the dash and the not-enough caption. */
export interface HealthMetricsMembersNpsSummaryView {
  isWithheld: boolean;
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
  ratePct: number | null;
  rateLabel: string;
  isRateBelowFloor: boolean;
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
  revenueChurnRate: number | null;
  revenueChurnRatePrior: number | null;
  revenueChurnRateChangePp: number | null;
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

/** `GET /api/analytics/members-churn-departures` — one page of the organizations that lapsed in a year. */
export interface HealthMetricsMembersChurnDeparturesQuery {
  foundationSlug: string;
  year: number;
  offset: number;
  pageSize: number;
}

/** One churned `MEMBERSHIP_MOVEMENT_DETAIL` row. Dates are ISO `YYYY-MM-DD`. */
export interface HealthMetricsMembersChurnDeparture {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  duesLostUsd: number | null;
  lapsedDate: string | null;
  lastEngagedDate: string | null;
}

export interface HealthMetricsMembersChurnDepartures {
  rows: HealthMetricsMembersChurnDeparture[];
  /** Every organization that lapsed in the year, so the table can check it against the churn count. */
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

/** One organization in "Who left". */
export interface HealthMetricsMembersChurnDepartureRowView {
  accountId: string;
  accountName: string;
  tierLabel: string;
  duesLabel: string;
  lapsedLabel: string;
  lastEngagedLabel: string;
}
