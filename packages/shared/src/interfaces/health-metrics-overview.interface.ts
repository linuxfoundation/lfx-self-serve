// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Signal } from '@angular/core';

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

/** One period's newsletter figures; rates are 0–1 shares, growth a fraction of the baseline's subscribers. */
export interface HealthMetricsOverviewNewsletterPeriod {
  subscribers: number | null;
  subscribersGrowth: number | null;
  /** ISO date the growth is measured from. */
  growthBaselineDate: string | null;
  newslettersSent: number | null;
  avgOpenRate: number | null;
  avgClickToOpenRate: number | null;
  highEngagement: number | null;
  mediumEngagement: number | null;
  lowEngagement: number | null;
  /** Each level's 0–1 share of the three, as the view computes it. */
  highEngagementShare: number | null;
  mediumEngagementShare: number | null;
  lowEngagementShare: number | null;
  /** How many newsletters the High / Medium / Low split is based on. */
  newslettersConsidered: number | null;
  mostEngagingName: string | null;
  mostEngagingClickToOpenRate: number | null;
}

/** One sent newsletter with engagement data; both rates are 0–1 shares of its recipients. */
export interface HealthMetricsOverviewNewsletterSend {
  key: string;
  name: string;
  /** ISO date. */
  sentDate: string | null;
  openRate: number | null;
  clickRate: number | null;
}

/** `GET /api/analytics/overview-newsletters` — the summary per period and every newsletter with engagement data. */
export interface HealthMetricsOverviewNewsletters {
  measured: boolean;
  periods: Record<HealthMetricsL2Range, HealthMetricsOverviewNewsletterPeriod | null>;
  newsletters: HealthMetricsOverviewNewsletterSend[];
}

/** Where a card's read stands: loading until the first foundation resolves, then ready or failed. */
export type HealthMetricsOverviewCardStatus = 'loading' | 'failed' | 'ready';

/** An "Explore …" link into a Level 2 tab section; `queryParams` clears the section's filters on arrival. */
export interface HealthMetricsOverviewExploreLink {
  label: string;
  commands: readonly string[];
  /** The section to land on; none opens the page at the top. */
  fragment?: string;
  queryParams: Readonly<Record<string, string | null>>;
  /** Leaves Health Metrics: `queryParams` replace the current ones instead of merging into them. */
  replaceQueryParams?: boolean;
}

/** A card's empty state as shown: an icon tile, a title, then one sentence or a short list of reasons. */
export interface HealthMetricsOverviewEmptyCopy {
  icon: string;
  title: string;
  /** One sentence; empty when the reasons list stands in for it. */
  text: string;
  reasons: readonly string[];
}

/** An empty state's words for one period; in a past year's copy, `{Y}` stands for the year. */
export interface HealthMetricsOverviewEmptyPeriodCopy {
  title: string;
  text: string;
  reasons: readonly string[];
}

/** A card's empty state for YTD and for a past year, word for word from the design. */
export interface HealthMetricsOverviewEmptyStateCopy {
  icon: string;
  ytd: HealthMetricsOverviewEmptyPeriodCopy;
  /** None for a card that shows today's figures whatever the period, so it always speaks of today. */
  past?: HealthMetricsOverviewEmptyPeriodCopy;
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
  /** The label's help tooltip, where the design gives one. */
  tip?: string;
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
  /** Full color for the segment holding the score, the color mixed toward white for the rest. */
  stroke: string;
}

/** A round end cap of the gauge, at -100 or +100, in its segment's color. */
export interface HealthMetricsOverviewGaugeCapView {
  key: string;
  x: string;
  y: string;
  fill: string;
}

/** One "Label: value" part of a card's meta line under its title. */
export interface HealthMetricsOverviewMetaPart {
  label: string;
  value: string;
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
  /** "Latest NPS: Q2 2026 · Audience: Board · Responses: 15 of 22 (68%)". */
  meta: HealthMetricsOverviewMetaPart[];
  scoreLabel: string;
  delta: HealthMetricsOverviewDelta | null;
  segments: HealthMetricsOverviewGaugeSegmentView[];
  caps: HealthMetricsOverviewGaugeCapView[];
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
  /** A measured zero balance; a missing one is unknown, not paid. */
  isPaidInFull: boolean;
  totalLabel: string;
  overdueMembersLabel: string;
  atRiskLabel: string;
  rows: HealthMetricsOverviewBalanceRowView[];
}

/**
 * A count over a bar: the figure, then "Goal: 1,000" or "Received: 185" at the right (`sideLabel`, `sideValue`), and the
 * bar's width and fill. `neutral` is the design's no-goal bar: a white, outlined track with no fill.
 */
export interface HealthMetricsOverviewEventBarView {
  countLabel: string;
  sideLabel: string;
  /** Empty when the side text has no value, as "No goal set" doesn't. */
  sideValue: string;
  widthPct: number;
  barClass: string;
  neutral: boolean;
}

/** The bar's fill carries the status, with no badge; `statusLabel` names it for screen readers, `null` without one. */
export interface HealthMetricsOverviewEventRegistrationsView extends HealthMetricsOverviewEventBarView {
  statusLabel: string | null;
}

/** Accepted speaking proposals as a bar when there are proposals, otherwise the call for proposals' stage. */
export interface HealthMetricsOverviewEventTalksView extends HealthMetricsOverviewEventBarView {
  hasProposals: boolean;
  note: string;
}

export interface HealthMetricsOverviewEventRowView {
  eventId: string;
  name: string;
  meta: string;
  /** Past events read their history, upcoming ones their forecast. */
  isPast: boolean;
  registrations: HealthMetricsOverviewEventRegistrationsView;
  talks: HealthMetricsOverviewEventTalksView;
}

/** The period's events, split into held and upcoming for the stacked bar. */
export interface HealthMetricsOverviewEventsTotalView {
  value: string;
  delta: HealthMetricsOverviewDelta | null;
  pastLabel: string;
  upcomingLabel: string;
  pastPct: number;
  upcomingPct: number;
}

export interface HealthMetricsOverviewSponsorshipView {
  valueLabel: string;
  hasGoal: boolean;
  goalLabel: string;
  widthPct: number;
  barClass: string;
  progressLabel: string;
}

export interface HealthMetricsOverviewEventsView {
  isEmpty: boolean;
  total: HealthMetricsOverviewEventsTotalView;
  sponsorship: HealthMetricsOverviewSponsorshipView;
  listTitle: string;
  listInfo: string;
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

/** One newsletter's point on the rate chart; `x` and the `y`s are percentages of the plot, `y` from the top. */
export interface HealthMetricsOverviewNewsletterPointView {
  key: string;
  xPct: string;
  openYPct: string;
  clickYPct: string;
  /** "Name · Mon D, YYYY · open N%, click N%", the point's tooltip and its screen-reader text. */
  label: string;
  /** Which way the tooltip extends from the point, so one at either end stays inside the card. */
  tipAlign: 'start' | 'center' | 'end';
}

/** A month label under the first newsletter sent in that month. */
export interface HealthMetricsOverviewNewsletterTickView {
  label: string;
  xPct: string;
}

/** The open and click rate lines, in a 600 × 200 viewBox drawn without keeping its aspect ratio. */
export interface HealthMetricsOverviewNewsletterChartView {
  openPath: string;
  openAreaPath: string;
  clickPath: string;
  points: HealthMetricsOverviewNewsletterPointView[];
  ticks: HealthMetricsOverviewNewsletterTickView[];
}

/** One High / Medium / Low row of the subscriber engagement split. */
export interface HealthMetricsOverviewNewsletterEngagementRowView {
  key: 'high' | 'medium' | 'low';
  label: string;
  description: string;
  dotClass: string;
  countLabel: string;
  pctLabel: string;
  /** The segment's share of the bar, as its flex-grow ratio; 0 draws none. */
  widthPct: number;
}

export interface HealthMetricsOverviewNewsletterView {
  isEmpty: boolean;
  kpis: HealthMetricsOverviewKpiView[];
  /** `null` when no newsletter in the period carries engagement data. */
  chart: HealthMetricsOverviewNewsletterChartView | null;
  /** "Based on opens and clicks across the last N newsletters"; empty when the view gives no count. */
  engagementBasis: string;
  engagement: HealthMetricsOverviewNewsletterEngagementRowView[];
  mostEngaging: { name: string; rateLabel: string } | null;
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

/** A trend dialog figure; the predicted one carries its range as a small high and low stack. */
export interface HealthMetricsOverviewTrendKpiView {
  key: string;
  label: string;
  value: string;
  range: { high: string; low: string } | null;
}

/** An axis tick: its label and where it sits, as a percentage of the plot. */
export interface HealthMetricsOverviewTrendTickView {
  label: string;
  pct: string;
}

/** A y-axis tick, which also draws a gridline at its y on the 600×220 canvas. */
export interface HealthMetricsOverviewTrendYTickView extends HealthMetricsOverviewTrendTickView {
  y: string;
}

/** The registration trend dialog: its figures, axis ticks and chart paths on the 600×220 viewBox. */
export interface HealthMetricsOverviewTrendView {
  /** Current, Same point last year, and Predicted (or Final for a past event). */
  kpis: HealthMetricsOverviewTrendKpiView[];
  goalLabel: string;
  /** "Days left", or "Event held" for a past event. */
  daysTitle: string;
  daysLabel: string;
  yTicks: HealthMetricsOverviewTrendYTickView[];
  xTicks: HealthMetricsOverviewTrendTickView[];
  currentPath: string;
  lastYearPath: string;
  predictedPath: string;
  bandPath: string;
  /** `null` once the event is past the chart's window or has no actuals. */
  todayX: string | null;
  /** Where the "Today" label sits, as a percentage of the plot's width. */
  todayPct: string | null;
  /** The registration goal's dashed line; `null` without a goal. */
  goalY: string | null;
}

/** One Overview card's read: the response once it lands, and where the read stands. */
export interface HealthMetricsOverviewCardRead<T> {
  data: Signal<T | null>;
  status: Signal<HealthMetricsOverviewCardStatus>;
}

/** What the events card hands the registration trend dialog; a past event shows its history, with no forecast. */
export interface HealthMetricsOverviewTrendDialogData {
  event: HealthMetricsOverviewEvent;
  isPast: boolean;
}

/** How a KPI strip lays out at its measured width: one row, one stacked column, or a 2 × 2 grid for four items. */
export type HealthMetricsOverviewKpiStripLayout = 'row' | 'stack' | 'grid';
