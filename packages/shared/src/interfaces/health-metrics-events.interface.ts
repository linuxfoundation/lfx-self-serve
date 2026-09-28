// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_EVENTS_FORECAST_STATUSES,
  HEALTH_METRICS_EVENTS_PAST_STATUSES,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS,
} from '../constants/health-metrics-events.constants';
import type { FilterPillOption } from './dashboard-metric.interface';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `E2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsEventsSectionKey = (typeof HEALTH_METRICS_EVENTS_SECTIONS)[number]['key'];

/** Events' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsEventsSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsEventsSectionKey;
}

/** Pace chip for one upcoming event; see `resolveHealthMetricsEventsForecastStatus` for the rule. */
export type HealthMetricsEventsForecastStatus = keyof typeof HEALTH_METRICS_EVENTS_FORECAST_STATUSES;

/** The forecast callout's case; the component owns each case's copy. */
export type HealthMetricsEventsForecastVerdictKind = 'no-goal' | 'no-data' | 'stale' | 'goal-suspect' | 'on-track' | 'short';

/** Foundation scope for the forecast's event list; the period does not change what it reads. */
export interface HealthMetricsEventsForecastQuery {
  foundationSlug: string;
}

/** One event's pacing curve, still scoped to the foundation so an id alone reads nothing. */
export interface HealthMetricsEventsForecastCurveQuery {
  foundationSlug: string;
  eventId: string;
}

/** One upcoming event's event-wide headline. Every `null` is unmeasured, never zero. */
export interface HealthMetricsEventsForecastEvent {
  eventId: string;
  eventName: string;
  /** `YYYY-MM-DD`. */
  eventStartDate: string | null;
  forecastAvg: number | null;
  forecastLow: number | null;
  forecastHigh: number | null;
  registrationsNow: number | null;
  /** `null` for a first edition, which has no last-year curve to compare against. */
  priorYearSamePoint: number | null;
  /** `null` when no goal is set. */
  goal: number | null;
  /** Whole days from today to the event, `0` on the event day. */
  daysLeft: number | null;
  /** True only when every format is a first edition. */
  isNewEvent: boolean;
}

/** `GET /api/analytics/events-registration-forecast` — every upcoming event's headline. */
export interface HealthMetricsEventsForecast {
  events: HealthMetricsEventsForecastEvent[];
}

/** One day on a format's curve; `actual` is null past today, the forecast series before it may be too. */
export interface HealthMetricsEventsForecastCurvePoint {
  daysToEvent: number;
  actual: number | null;
  forecastAvg: number | null;
  forecastLow: number | null;
  forecastHigh: number | null;
  priorYear: number | null;
}

/** One registration format's curve — formats never share a line, since they need not cover the same days. */
export interface HealthMetricsEventsForecastCurveSeries {
  format: string;
  points: HealthMetricsEventsForecastCurvePoint[];
}

/** `GET /api/analytics/events-registration-forecast-curve` — one event's curve, one series per format. */
export interface HealthMetricsEventsForecastCurve {
  eventId: string;
  formats: HealthMetricsEventsForecastCurveSeries[];
}

/** The forecast callout: its case plus the figures its copy quotes. */
export interface HealthMetricsEventsForecastVerdict {
  kind: HealthMetricsEventsForecastVerdictKind;
  tone: 'none' | 'ok' | 'watch' | 'act';
  forecast: number | null;
  goal: number | null;
  /** Registrations over (on track) or under (short) the goal. */
  gap: number;
  /** Forecast over goal, for the stale and goal-suspect copy; null when there is no goal or forecast. */
  ratio: number | null;
  daysLeft: number | null;
}

/** An upcoming-events table row with its labels and chip resolved once per response. */
export interface HealthMetricsEventsForecastRowView {
  event: HealthMetricsEventsForecastEvent;
  status: HealthMetricsEventsForecastStatus;
  statusLabel: string;
  statusClass: string;
  dateLabel: string;
  registrationsLabel: string;
  goalLabel: string;
  /** 0–100, `null` with no goal to fill against or no measured registration count. */
  progressPct: number | null;
  progressClass: string;
}

/** Outcome chip for one closed event; see `resolveHealthMetricsEventsPastStatus` for the rule. */
export type HealthMetricsEventsPastStatus = keyof typeof HEALTH_METRICS_EVENTS_PAST_STATUSES;

/** Foundation scope for past events; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsPastQuery {
  foundationSlug: string;
}

/** One closed event's final result. Every `null` is unmeasured, never zero. */
export interface HealthMetricsEventsPastEvent {
  eventId: string;
  eventName: string;
  /** `YYYY-MM-DD`. */
  eventStartDate: string | null;
  registrations: number | null;
  /** `null` when no goal is set. */
  goal: number | null;
  /** `null` when no goal is set, or when the view has not flagged the outcome. */
  goalMet: boolean | null;
  /** `0` is a measured result; only `null` is not available. */
  revenueUsd: number | null;
  /** The model's pace band at close: `healthy`, `needs_attention` or `needs_action`. */
  paceStatus: string | null;
  /** The periods this event closed in. */
  ranges: HealthMetricsL2Range[];
}

/** One period's header figures, as the view totals them — never re-summed from the table. */
export interface HealthMetricsEventsPastPeriod {
  range: HealthMetricsL2Range;
  eventCount: number | null;
  registrations: number | null;
}

/** `GET /api/analytics/events-past` — every closed event in the four periods, plus each period's header. */
export interface HealthMetricsEventsPast {
  /** Empty when the foundation has no closed event in any period. */
  periods: HealthMetricsEventsPastPeriod[];
  /** Most recent first. */
  events: HealthMetricsEventsPastEvent[];
}

/** A past-events table row with its labels and chip resolved once per period. */
export interface HealthMetricsEventsPastRowView {
  event: HealthMetricsEventsPastEvent;
  status: HealthMetricsEventsPastStatus;
  statusLabel: string;
  statusClass: string;
  dateLabel: string;
  registrationsLabel: string;
  goalLabel: string;
  revenueLabel: string;
  /** 0–100, `null` with no goal to fill against or no measured registration count. */
  progressPct: number | null;
  progressClass: string;
}

/** The section for one period: the view's header figures and the events that closed in it. */
export interface HealthMetricsEventsPastView {
  eventCount: number | null;
  registrations: number | null;
  /** Listed events whose chip reads "Hit goal" — the X in "Hit goal: X of Y". */
  goalMetCount: number;
  /** Listed events with a goal set and a measured outcome — the Y, so X and Y share the chips' rule. */
  goalSetCount: number;
  /** Whether any listed event has a goal, so goals with no measured outcome never read as unset. */
  hasGoals: boolean;
  rows: HealthMetricsEventsPastRowView[];
}

/** Foundation scope for the at-a-glance strip; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsAtAGlanceQuery {
  foundationSlug: string;
}

/** Year-over-year changes as fractions (−0.25 is −25%). Every `null` is not available, never zero. */
export interface HealthMetricsEventsAtAGlanceChanges {
  registrations: number | null;
  attendees: number | null;
  organizations: number | null;
  speakers: number | null;
  countries: number | null;
  events: number | null;
  /** Percentage points as a fraction (0.022 is +2.2 pp), never a percentage change. */
  showUpRatePts: number | null;
}

/** One period's reach, as the view totals it. Every `null` is unmeasured, never zero. */
export interface HealthMetricsEventsAtAGlancePeriod {
  range: HealthMetricsL2Range;
  registrations: number | null;
  attendees: number | null;
  organizations: number | null;
  speakers: number | null;
  countries: number | null;
  /** Events held in the period; for YTD that is the events held so far. */
  events: number | null;
  pastEvents: number | null;
  /** Attendees over registrations, 0–1; `null` with no registrations, since that rate is undefined. */
  showUpRate: number | null;
  /** `null` for a period the view does not compare with the year before. */
  changes: HealthMetricsEventsAtAGlanceChanges | null;
}

/** `GET /api/analytics/events-at-a-glance` — the foundation's reach in each of the four periods. */
export interface HealthMetricsEventsAtAGlance {
  periods: HealthMetricsEventsAtAGlancePeriod[];
  /** Events from today to the end of the current year; the view does not split it by period. */
  upcomingEvents: number | null;
  /** `false` only when the foundation has never held an event, has none still to come and has no event revenue recorded. */
  hasEvents: boolean;
}

/** Where the at-a-glance read stands; the Events tab owns the read and hands its state to the section. */
export type HealthMetricsEventsAtAGlanceStatus = 'loading' | 'failed' | 'ready';

/** A year-over-year delta label; `null` when the period has no comparison, so none is drawn. */
export interface HealthMetricsEventsAtAGlanceDelta {
  delta: string | null;
  deltaDirection: 'up' | 'down' | 'neutral';
}

/** One figure with its year-over-year delta. */
export interface HealthMetricsEventsAtAGlanceStatView extends HealthMetricsEventsAtAGlanceDelta {
  key: string;
  label: string;
  value: string;
  /** A fall steep enough to flag on the tile. */
  warn: boolean;
}

/** The section for one period, with every label ready to render. */
export interface HealthMetricsEventsAtAGlanceView {
  /** `false` when the read carried no figures for the period, so nothing reads as a measured zero. */
  measured: boolean;
  controlLabel: string;
  baselineLabel: string;
  headline: HealthMetricsEventsAtAGlanceStatView;
  side: HealthMetricsEventsAtAGlanceStatView[];
  tiles: HealthMetricsEventsAtAGlanceStatView[];
}

/** Foundation scope for registrations & growth; the section is not period-scoped, so every year ships. */
export interface HealthMetricsEventsRegistrationsGrowthQuery {
  foundationSlug: string;
}

/** One year's registrations and attendees, split by format. Every `null` is unmeasured, never zero. */
export interface HealthMetricsEventsRegistrationsGrowthYear {
  year: number;
  /** A year still open (the current one, or a later one with early sign-ups), so it reads short against complete years. */
  isPartialYear: boolean;
  totalRegistrations: number | null;
  inPersonRegistrations: number | null;
  virtualRegistrations: number | null;
  totalAttendees: number | null;
  inPersonAttendees: number | null;
  virtualAttendees: number | null;
}

/** `GET /api/analytics/events-registrations-growth` — the foundation's years with events, oldest first. */
export interface HealthMetricsEventsRegistrationsGrowth {
  years: HealthMetricsEventsRegistrationsGrowthYear[];
}

/** Which count the section's toggle shows; it switches the chart and the table together. */
export type HealthMetricsEventsRegistrationsGrowthMetric = 'registrations' | 'attendees';

/** A toggle pill whose id is the metric it selects. */
export interface HealthMetricsEventsRegistrationsGrowthMetricOption extends FilterPillOption {
  id: HealthMetricsEventsRegistrationsGrowthMetric;
}

/** One year of the chart and table; a gap year between the first and last reads as no events recorded. */
export interface HealthMetricsEventsRegistrationsGrowthRowView {
  year: number;
  /** `false` for a gap year, which the table dashes and the chart leaves empty rather than zeroed. */
  recorded: boolean;
  isPartialYear: boolean;
  total: number | null;
  inPerson: number | null;
  virtual: number | null;
  totalLabel: string;
  inPersonLabel: string;
  /** A dash when no virtual count was recorded, per the design. */
  virtualLabel: string;
}

/** The section for one metric, with every year from the first to the last. */
export interface HealthMetricsEventsRegistrationsGrowthView {
  rows: HealthMetricsEventsRegistrationsGrowthRowView[];
  /** Years spanned, gap years included, so the count matches the table. */
  yearCount: number;
  hasPartialYear: boolean;
  /** The pandemic callout, set only when a pandemic year was mostly virtual for the metric. */
  pandemicNote: string | null;
}

/** Foundation scope for event revenue; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsRevenueQuery {
  foundationSlug: string;
}

/** Year-over-year revenue changes as fractions. Every `null` is not available, never zero. */
export interface HealthMetricsEventsRevenueChanges {
  total: number | null;
  registration: number | null;
  sponsorship: number | null;
}

/** One period's headline, in USD as the view totals it. Revenue is signed, since refunds count against it. */
export interface HealthMetricsEventsRevenuePeriod {
  range: HealthMetricsL2Range;
  totalUsd: number | null;
  registrationUsd: number | null;
  sponsorshipUsd: number | null;
  /** 0–1; `null` when the total is zero or part of it could not be converted to USD. */
  registrationShare: number | null;
  sponsorshipShare: number | null;
  /** Some registration revenue in the period stayed in local currency, so the USD figures run short. */
  hasUnconverted: boolean;
  /** `null` for a period the view does not compare with the year before. */
  changes: HealthMetricsEventsRevenueChanges | null;
}

/** One event's revenue against its goals, in USD. Every `null` is unmeasured, never zero. */
export interface HealthMetricsEventsRevenueEvent {
  eventId: string;
  eventName: string;
  /** `YYYY-MM-DD`. */
  eventStartDate: string | null;
  registrationUsd: number | null;
  sponsorshipUsd: number | null;
  /** `null` when no goal is set, or when the goal is withheld. */
  registrationGoal: number | null;
  sponsorshipGoal: number | null;
  /** Some of the event's registration revenue stayed in local currency. */
  hasUnconverted: boolean;
  /** A set goal in a currency with no USD rate, so it cannot sit against a USD figure. */
  registrationGoalWithheld: boolean;
  sponsorshipGoalWithheld: boolean;
  /** The periods the event falls in. */
  ranges: HealthMetricsL2Range[];
}

/** `GET /api/analytics/events-revenue` — each period's headline and every event in the four periods. */
export interface HealthMetricsEventsRevenue {
  periods: HealthMetricsEventsRevenuePeriod[];
  /** Most recent first. */
  events: HealthMetricsEventsRevenueEvent[];
  /** `false` when only the foundation totals were read, so there is no per-event list to show. */
  eventsMeasured: boolean;
}

/** A revenue-by-event row with its labels resolved once per period. */
export interface HealthMetricsEventsRevenueRowView {
  event: HealthMetricsEventsRevenueEvent;
  dateLabel: string;
  registrationLabel: string;
  /** Empty when no goal is set; says so when the goal is withheld for its currency. */
  registrationGoalLabel: string;
  sponsorshipLabel: string;
  sponsorshipGoalLabel: string;
}

/** The section for one period, with every label ready to render. */
export interface HealthMetricsEventsRevenueView {
  /** `false` when the read carried no period at all, so the section says so rather than pointing at another period. */
  foundationMeasured: boolean;
  /** `false` when the read carried no figures for the period, so nothing reads as a measured zero. */
  measured: boolean;
  headline: HealthMetricsEventsAtAGlanceStatView;
  side: HealthMetricsEventsAtAGlanceStatView[];
  rows: HealthMetricsEventsRevenueRowView[];
  /** `false` when the foundation has totals but no per-event figures, so an empty list is not read as no events. */
  eventsMeasured: boolean;
  /** Whether the headline or any listed event is short for unconverted revenue, so the footer note shows. */
  hasUnconverted: boolean;
  /** Whether the period's totals leave out unconverted revenue, so the headline and registration stat are marked. */
  headlineUnconverted: boolean;
}

/** Foundation scope for speakers and proposals; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsSpeakersQuery {
  foundationSlug: string;
}

/** A proposal's review outcome, grouped as the view groups the original CFP statuses. */
export type HealthMetricsEventsSpeakersStatusGroup = keyof typeof HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS;

/** The tabs over the section; each but `all` keeps the proposals in one status group. */
export type HealthMetricsEventsSpeakersTab = 'all' | 'accepted' | 'in-review';

/** A tab pill whose id is the status it keeps. */
export interface HealthMetricsEventsSpeakersTabOption extends FilterPillOption {
  id: HealthMetricsEventsSpeakersTab;
}

/** Year-over-year changes as fractions. Every `null` is not available, never zero. */
export interface HealthMetricsEventsSpeakersChanges {
  speakers: number | null;
}

/** One period's pipeline for the whole foundation. Every `null` is not available, never zero. */
export interface HealthMetricsEventsSpeakersPeriod {
  range: HealthMetricsL2Range;
  submitted: number | null;
  accepted: number | null;
  inReview: number | null;
  declined: number | null;
  speakers: number | null;
  /** 0–1, accepted over submitted. */
  acceptanceRate: number | null;
  /** `null` for a period the view does not compare with the year before. */
  changes: HealthMetricsEventsSpeakersChanges | null;
}

/** Proposals submitted in a period by one organization, or by all individual speakers together. */
export interface HealthMetricsEventsSpeakersPeriodCount {
  range: HealthMetricsL2Range;
  submitted: number | null;
}

/** An organization's place in a period's ranking by proposals submitted. */
export interface HealthMetricsEventsSpeakersOrganizationPeriod extends HealthMetricsEventsSpeakersPeriodCount {
  rank: number;
}

/** An organization ranked in the top few for at least one period. */
export interface HealthMetricsEventsSpeakersOrganization {
  accountId: string;
  accountName: string;
  /** Only the periods it ranks in the top few for. */
  periods: HealthMetricsEventsSpeakersOrganizationPeriod[];
}

/** One recent proposal. The speaker is shown by job title, never by name; the title is personal data, so it is never logged. */
export interface HealthMetricsEventsSpeakersProposal {
  proposalKey: string;
  range: HealthMetricsL2Range;
  /** `null` when the proposal lists none. */
  jobTitle: string | null;
  /** `null` when the proposal carries no organization. */
  organizationName: string | null;
  /** The speaker proposed as an individual, not for an organization. */
  unaffiliated: boolean;
  eventName: string;
  sessionTitle: string;
  /** `YYYY-MM-DD`. */
  submissionDate: string | null;
  /** The original CFP status, e.g. `Waitlisted`. */
  status: string;
  statusGroup: HealthMetricsEventsSpeakersStatusGroup | null;
}

/** `GET /api/analytics/events-speakers` — each period's pipeline, the top organizations and the latest proposals. */
export interface HealthMetricsEventsSpeakers {
  periods: HealthMetricsEventsSpeakersPeriod[];
  organizations: HealthMetricsEventsSpeakersOrganization[];
  /** Proposals from speakers with no organization, kept out of the organization ranking. */
  unaffiliated: HealthMetricsEventsSpeakersPeriodCount[];
  /** The latest few per period and tab, most recent first. */
  proposals: HealthMetricsEventsSpeakersProposal[];
}

/** One bar before scaling; `null` is not available, never zero. */
export interface HealthMetricsEventsSpeakersBarInput {
  key: string;
  label: string;
  value: number | null;
  /** The bar's fill, e.g. `bg-blue-500`. */
  barClass: string;
}

/** One ranked bar, scaled against the longest in its list. */
export interface HealthMetricsEventsSpeakersBarView {
  key: string;
  label: string;
  valueLabel: string;
  /** 0–100. */
  widthPct: number;
  /** The bar's fill, e.g. `bg-blue-500`; safelisted in `tailwind.config.js`. */
  barClass: string;
}

/** One column of the proposals-per-year chart. */
export interface HealthMetricsEventsSpeakersYearView {
  year: number;
  submitted: number | null;
  /** The year is still open, so it will read short against the complete years. */
  isPartialYear: boolean;
  /** For the chart's text equivalent, e.g. `2026 (partial year)`. */
  yearLabel: string;
  /** e.g. `6,283`, or `not available`. */
  submittedLabel: string;
}

/** A recent-proposals row with its labels resolved. */
export interface HealthMetricsEventsSpeakersProposalRowView {
  proposal: HealthMetricsEventsSpeakersProposal;
  organizationLabel: string;
  dateLabel: string;
  statusClass: string;
}

/** The section for one period and tab, with every label ready to render. */
export interface HealthMetricsEventsSpeakersView {
  /** `false` when the read carried no period at all, so the section says so rather than pointing at another period. */
  foundationMeasured: boolean;
  /** `false` when the read carried no figures for the period, so nothing reads as a measured zero. */
  measured: boolean;
  /** The tab's proposal count, e.g. `6,283 proposals`. */
  countLabel: string;
  headline: HealthMetricsEventsAtAGlanceStatView;
  side: HealthMetricsEventsAtAGlanceStatView[];
  statusBars: HealthMetricsEventsSpeakersBarView[];
  organizations: HealthMetricsEventsSpeakersBarView[];
  /** Individual speakers' proposals, e.g. `1,351 proposals submitted`; `null` when there are none. */
  individualLabel: string | null;
  proposals: HealthMetricsEventsSpeakersProposalRowView[];
}

/** The membership cut over the organizations table. */
export type HealthMetricsEventsOrganizationsSegment = 'all' | 'members' | 'non-members';

/** A segment pill whose id is the cut it applies. */
export interface HealthMetricsEventsOrganizationsSegmentOption extends FilterPillOption {
  id: HealthMetricsEventsOrganizationsSegment;
}

/** One page of the organizations active in a period, cut by membership and a name search. */
export interface HealthMetricsEventsOrganizationsQuery {
  foundationSlug: string;
  range: HealthMetricsL2Range;
  segment: HealthMetricsEventsOrganizationsSegment;
  /** Matched anywhere in the organization's name; empty matches every organization. */
  search: string;
  offset: number;
  pageSize: number;
}

/** One organization's event record for the period. Every `null` is not available, never zero. */
export interface HealthMetricsEventsOrganization {
  accountId: string;
  accountName: string;
  logoUrl: string | null;
  isMember: boolean;
  registrations: number | null;
  /** 0–1, registrations over the foundation's top organization for the period. */
  registrationsShare: number | null;
  sponsorshipUsd: number | null;
  proposals: number | null;
  speakers: number | null;
  events: number | null;
}

/** `GET /api/analytics/events-organizations` — one page, ranked by registrations. */
export interface HealthMetricsEventsOrganizations {
  rows: HealthMetricsEventsOrganization[];
  /** Organizations matching the segment and search. */
  totalRecords: number;
  /** Every organization active in the period; `null` when the read was not measured. */
  scopeTotal: number | null;
}

/** An organizations row with every label ready to render. */
export interface HealthMetricsEventsOrganizationRowView {
  accountId: string;
  accountName: string;
  logoUrl: string;
  memberLabel: string;
  memberClass: string;
  registrationsLabel: string;
  /** 0–100. */
  barWidthPct: number;
  /** `—` when the period shows no sponsorship, which the view cannot tell from not tracked. */
  sponsorshipLabel: string;
  /** `—` when the period shows no proposals, for the same reason. */
  proposalsLabel: string;
  speakersLabel: string;
  eventsLabel: string;
}
