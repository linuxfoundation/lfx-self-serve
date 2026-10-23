// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2Range } from './health-metrics-l2.interface';

/** Every Overview card read is foundation-wide and carries all four periods, so a period change never re-reads. */
export interface HealthMetricsOverviewQuery {
  foundationSlug: string;
}

/** High / Medium / Low organizations and their 0–1 shares. Every `null` is unmeasured, never zero. */
export interface HealthMetricsOverviewEngagementSplit {
  highCount: number | null;
  mediumCount: number | null;
  lowCount: number | null;
  highPct: number | null;
  mediumPct: number | null;
  lowPct: number | null;
}

/** One period of the participating organizations card. */
export interface HealthMetricsOverviewParticipatingOrgsPeriod {
  activeMembers: number | null;
  newMembers: number | null;
  nonRenewals: number | null;
  nonMembers: number | null;
  /** `null` for a period the view does not split by engagement. */
  memberEngagement: HealthMetricsOverviewEngagementSplit | null;
  nonMemberEngagement: HealthMetricsOverviewEngagementSplit | null;
}

/** `GET /api/analytics/overview-participating-orgs`; `measured` is false when the foundation has no row. */
export interface HealthMetricsOverviewParticipatingOrgs {
  measured: boolean;
  periods: Record<HealthMetricsL2Range, HealthMetricsOverviewParticipatingOrgsPeriod>;
}

/** The Board audience's survey as of one period; `responseRatePct` is 0–1. */
export interface HealthMetricsOverviewNpsPeriod {
  npsScore: number | null;
  /** Points since the previous survey wave, named by `previousSurveyQuarter`. */
  scoreChangePp: number | null;
  previousSurveyQuarter: string | null;
  /** The wave the figures come from, e.g. `Q2 2026`. */
  lastUpdatedQuarter: string | null;
  recipientsCount: number | null;
  responsesCount: number | null;
  responseRatePct: number | null;
  promotersCount: number | null;
  passivesCount: number | null;
  detractorsCount: number | null;
  noResponseCount: number | null;
}

/** `GET /api/analytics/overview-nps`; a `null` period had no Board survey sent. */
export interface HealthMetricsOverviewNps {
  periods: Record<HealthMetricsL2Range, HealthMetricsOverviewNpsPeriod | null>;
}

/** The foundation-wide churn figures. Rates are percentages (0–100); the `ChangePct` fields are fractions. */
export interface HealthMetricsOverviewChurnTotals {
  churnRatePct: number | null;
  churnRatePctPriorYear: number | null;
  /** Percentage points against the year before. */
  churnRateChangePp: number | null;
  membershipsLost: number | null;
  membershipsLostPriorYear: number | null;
  membershipsLostChangePct: number | null;
  valueLostUsd: number | null;
  valueLostUsdPriorYear: number | null;
  valueLostChangePct: number | null;
}

/** One membership tier's churn in a period; `churnRatePct` is 0–100. */
export interface HealthMetricsOverviewChurnTier {
  tier: string;
  label: string;
  churnRatePct: number | null;
  membershipsLost: number | null;
  valueLostUsd: number | null;
}

/** One period of the churn card; `tiers` follow the view's tier rank, then label. */
export interface HealthMetricsOverviewChurnPeriod {
  totals: HealthMetricsOverviewChurnTotals | null;
  tiers: HealthMetricsOverviewChurnTier[];
}

/** `GET /api/analytics/overview-churn`. */
export interface HealthMetricsOverviewChurn {
  periods: Record<HealthMetricsL2Range, HealthMetricsOverviewChurnPeriod>;
}

/** `GET /api/analytics/overview-outstanding-balance` — overdue invoices today; the view has no periods. Shares are 0–1. */
export interface HealthMetricsOverviewOutstandingBalance {
  measured: boolean;
  outstandingUsd: number | null;
  overdueMembers: number | null;
  highRiskUsd: number | null;
  highRiskMembers: number | null;
  highRiskSharePct: number | null;
  mediumRiskUsd: number | null;
  mediumRiskMembers: number | null;
  mediumRiskSharePct: number | null;
}

/** One event on the Overview list. Every `null` is unmeasured, never zero. */
export interface HealthMetricsOverviewEvent {
  eventId: string;
  eventName: string;
  /** `YYYY-MM-DD`. */
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  registrations: number | null;
  /** `null` when no goal is set. */
  registrationsGoal: number | null;
  /** Upcoming only: the view's pace against last year (`high`, `medium` or `low`). */
  compScore: string | null;
  /** Past only: the closed event's goal flag and pace band, as the Events tab's past section reads them. */
  goalMet: boolean | null;
  paceStatus: string | null;
  acceptedTalks: number | null;
  totalProposals: number | null;
  /** The call for proposals' stage, e.g. `In Review`. */
  cfpStatus: string | null;
  /** Past only: the periods the event was held in. */
  ranges: HealthMetricsL2Range[];
}

/** `GET /api/analytics/overview-events` — upcoming events soonest first, past events newest first. */
export interface HealthMetricsOverviewEvents {
  upcoming: HealthMetricsOverviewEvent[];
  past: HealthMetricsOverviewEvent[];
  /** True when the read hit its row cap, so a list may be short. */
  truncated: boolean;
}

/** The board's meetings in one period. Attendance is 0–1; the `ChangePct` fields are fractions. */
export interface HealthMetricsOverviewBoardPeriod {
  meetings: number | null;
  meetingsChangePct: number | null;
  avgAttendancePct: number | null;
  avgAttendanceChangePct: number | null;
}

/** One board member's attendance in a period they were invited to; `attendancePct` is 0–1. */
export interface HealthMetricsOverviewBoardAttendance {
  invited: number;
  attended: number | null;
  attendancePct: number | null;
}

/** One board member; `attendance` holds only the periods they were invited in. */
export interface HealthMetricsOverviewBoardMember {
  key: string;
  name: string;
  jobTitle: string | null;
  organization: string | null;
  logoUrl: string | null;
  /** `YYYY-MM-DD`. */
  lastAttendedDate: string | null;
  attendance: Partial<Record<HealthMetricsL2Range, HealthMetricsOverviewBoardAttendance>>;
}

/** `GET /api/analytics/overview-board`; a `null` period has no board row. */
export interface HealthMetricsOverviewBoard {
  periods: Record<HealthMetricsL2Range, HealthMetricsOverviewBoardPeriod | null>;
  members: HealthMetricsOverviewBoardMember[];
}

/** One period's contributors. */
export interface HealthMetricsOverviewCodePeriod {
  contributors: number | null;
  newContributors: number | null;
}

/** `GET /api/analytics/overview-code` — contributors per period and the all-time roles. */
export interface HealthMetricsOverviewCode {
  measured: boolean;
  periods: Record<HealthMetricsL2Range, HealthMetricsOverviewCodePeriod>;
  committers: number | null;
  maintainers: number | null;
  reviewers: number | null;
}

/** Where a card's read stands: loading until the first foundation resolves, then ready or failed. */
export type HealthMetricsOverviewCardStatus = 'loading' | 'failed' | 'ready';

/** An "Explore …" link into a Level 2 tab section; `queryParams` clears the section's filters on arrival. */
export interface HealthMetricsOverviewExploreLink {
  label: string;
  commands: readonly string[];
  fragment: string;
  queryParams: Readonly<Record<string, string | null>>;
}

/** A card's empty state, word for word from the design. */
export interface HealthMetricsOverviewEmptyCopy {
  icon: string;
  /** Classes for the 44px circle behind the icon and the icon itself. */
  circleClass: string;
  iconClass: string;
  title: string;
  text: string;
}

/** A change against the year before: the arrow follows the figure, the colour whether that is good. */
export interface HealthMetricsOverviewDelta {
  label: string;
  direction: 'up' | 'down';
  good: boolean;
}

/** A labelled KPI figure, with an optional change and a note under it. */
export interface HealthMetricsOverviewKpiView {
  key: string;
  label: string;
  value: string;
  delta: HealthMetricsOverviewDelta | null;
  note: string;
}

/** One ring of the engagement donut, as SVG `stroke-dasharray` / `stroke-dashoffset` values. */
export interface HealthMetricsOverviewDonutSegmentView {
  key: string;
  stroke: string;
  dashArray: string;
  dashOffset: string;
}

/** One High / Medium / Low row beside the donut. */
export interface HealthMetricsOverviewEngagementRowView {
  key: string;
  label: string;
  dotClass: string;
  countLabel: string;
  pctLabel: string;
}

/** One half of the participating organizations card: members or non-members. */
export interface HealthMetricsOverviewOrgsHalfView {
  key: 'members' | 'non-members';
  kpis: HealthMetricsOverviewKpiView[];
  engagementLabel: string;
  /** Empty when the period has no engagement split, so the donut shows its track only. */
  donut: HealthMetricsOverviewDonutSegmentView[];
  lowPctLabel: string;
  rows: HealthMetricsOverviewEngagementRowView[];
  link: HealthMetricsOverviewExploreLink;
}

export interface HealthMetricsOverviewParticipatingOrgsView {
  isEmpty: boolean;
  halves: HealthMetricsOverviewOrgsHalfView[];
}

/** One arc of the NPS gauge; the band the score falls in is drawn solid, the others faint. */
export interface HealthMetricsOverviewGaugeSegmentView {
  key: string;
  path: string;
  stroke: string;
  opacity: number;
}

/** One Promoters / Passives / Detractors row. */
export interface HealthMetricsOverviewNpsRowView {
  key: string;
  label: string;
  range: string;
  dotClass: string;
  countLabel: string;
  pctLabel: string;
}

export interface HealthMetricsOverviewNpsView {
  isEmpty: boolean;
  subtitle: string;
  scoreLabel: string;
  delta: HealthMetricsOverviewDelta | null;
  segments: HealthMetricsOverviewGaugeSegmentView[];
  /** The needle's tip; `null` without a score, so no needle is drawn. */
  needle: { x: string; y: string } | null;
  ariaLabel: string;
  rows: HealthMetricsOverviewNpsRowView[];
  noResponseLabel: string;
}

/** One tier row; `rateWidthPct` and the card's `overallPct` share the 0–100 axis. */
export interface HealthMetricsOverviewChurnTierView {
  key: string;
  label: string;
  rateLabel: string;
  rateWidthPct: number;
  lostLabel: string;
  valueLabel: string;
}

export interface HealthMetricsOverviewChurnView {
  isEmpty: boolean;
  kpis: HealthMetricsOverviewKpiView[];
  tiers: HealthMetricsOverviewChurnTierView[];
  overallPct: number;
  overallLabel: string;
}

/** One risk band of the outstanding balance. */
export interface HealthMetricsOverviewBalanceRowView {
  key: 'high' | 'medium';
  label: string;
  daysLabel: string;
  dotClass: string;
  widthPct: number;
  membersLabel: string;
  amountLabel: string;
}

export interface HealthMetricsOverviewBalanceView {
  isEmpty: boolean;
  totalLabel: string;
  overdueMembersLabel: string;
  atRiskLabel: string;
  rows: HealthMetricsOverviewBalanceRowView[];
}

/** A status pill: the label plus its background and text classes. */
export interface HealthMetricsOverviewBadgeView {
  label: string;
  className: string;
}

/** An event's registrations against its goal; without a goal there is no bar or badge. */
export interface HealthMetricsOverviewEventRegistrationsView {
  countLabel: string;
  hasGoal: boolean;
  goalLabel: string;
  pctLabel: string;
  widthPct: number;
  barClass: string;
  badge: HealthMetricsOverviewBadgeView | null;
}

/** Accepted talks as a bar when there are proposals, otherwise the call for proposals' stage as a note. */
export interface HealthMetricsOverviewEventTalksView {
  hasProposals: boolean;
  acceptedLabel: string;
  totalLabel: string;
  widthPct: number;
  note: string;
}

export interface HealthMetricsOverviewEventRowView {
  eventId: string;
  name: string;
  meta: string;
  /** Only upcoming events open the registration trend. */
  clickable: boolean;
  registrations: HealthMetricsOverviewEventRegistrationsView;
  talks: HealthMetricsOverviewEventTalksView;
}

export interface HealthMetricsOverviewSponsorshipView {
  valueLabel: string;
  hasGoal: boolean;
  goalLabel: string;
  widthPct: number;
  progressLabel: string;
}

export interface HealthMetricsOverviewEventsView {
  isEmpty: boolean;
  total: HealthMetricsOverviewKpiView;
  sponsorship: HealthMetricsOverviewSponsorshipView;
  listTitle: string;
  rows: HealthMetricsOverviewEventRowView[];
}

/** One program bar; `widthPct` is relative to the largest program. */
export interface HealthMetricsOverviewTrainingItemView {
  key: string;
  label: string;
  valueLabel: string;
  widthPct: number;
  shareLabel: string;
}

/** What the training card measures. */
export type HealthMetricsOverviewTrainingMetric = 'enrollments' | 'revenue';

export interface HealthMetricsOverviewTrainingView {
  isEmpty: boolean;
  totalLabel: string;
  metricLabel: string;
  /** `null` when the period models no goal, so the arc shows its track only. */
  goalLabel: string | null;
  trackPath: string;
  progressPath: string;
  ariaLabel: string;
  items: HealthMetricsOverviewTrainingItemView[];
}

/** One all-time role segment and legend entry. */
export interface HealthMetricsOverviewCodeRoleView {
  key: string;
  label: string;
  valueLabel: string;
  widthPct: number;
  colorClass: string;
}

export interface HealthMetricsOverviewCodeView {
  isEmpty: boolean;
  kpis: HealthMetricsOverviewKpiView[];
  roles: HealthMetricsOverviewCodeRoleView[];
}

/** How the board table is sorted; the design opens on the lowest attendance first. */
export type HealthMetricsOverviewBoardSort = 'att-asc' | 'att-desc' | 'name-asc' | 'name-desc';

export interface HealthMetricsOverviewBoardRowView {
  key: string;
  name: string;
  initials: string;
  title: string;
  organization: string;
  organizationInitial: string;
  logoUrl: string | null;
  attendedLabel: string;
  pctLabel: string;
  /** 0–1, for sorting. */
  attendance: number;
  widthPct: number;
  barClass: string;
  lastAttendedLabel: string;
}

export interface HealthMetricsOverviewBoardView {
  isEmpty: boolean;
  kpis: HealthMetricsOverviewKpiView[];
  rows: HealthMetricsOverviewBoardRowView[];
}

/** One line on the registration trend chart, as an SVG path on the 600×220 viewBox. */
export interface HealthMetricsOverviewTrendView {
  kpis: HealthMetricsOverviewKpiView[];
  currentPath: string;
  lastYearPath: string;
  predictedPath: string;
  bandPath: string;
  /** `null` once the event is past the chart's window or has no actuals. */
  todayX: string | null;
}
