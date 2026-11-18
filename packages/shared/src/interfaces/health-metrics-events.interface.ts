// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_EVENTS_PAST_STATUSES,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS,
} from '../constants/health-metrics-events.constants';
import type { FilterPillOption } from './dashboard-metric.interface';
import type {
  HealthMetricsL2Range,
  HealthMetricsL2SubNavItem,
  HealthMetricsMetricItem,
  HealthMetricsNote,
  HealthMetricsNoteTone,
} from './health-metrics-l2.interface';
import type { HealthMetricsMembersQueryParams } from './health-metrics-members.interface';
import type { HealthMetricsColumnChartView } from './health-metrics-column-chart.interface';
import type { HealthMetricsBarListRow, HealthMetricsCellCompanyLead } from './health-metrics-table.interface';
import type { HealthMetricsNonMembersQueryParams } from './health-metrics-non-members.interface';
import type { UiBadgeTone } from './uikit.interface';

/** Section key from the design's `E2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsEventsSectionKey = (typeof HEALTH_METRICS_EVENTS_SECTIONS)[number]['key'];

/** Events' sub-nav entry, keyed to its own sections. */
export interface HealthMetricsEventsSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsEventsSectionKey;
}

/** One upcoming event's pace; see `resolveHealthMetricsEventsForecastStatus` for the rule. */
export type HealthMetricsEventsForecastStatus = 'on-track' | 'at-risk' | 'action' | 'no-goal' | 'no-data';

/** The forecast verdict's case; `buildHealthMetricsEventsForecastView` writes each case's copy. */
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
  /** Whole days from today to the event, `0` on the event day, `null` once a running event is past its start day. */
  daysLeft: number | null;
  /** True only when every format is a first edition. */
  isNewEvent: boolean;
  /** `null` when unknown, or when the city only says the event is online. */
  city: string | null;
  isVirtual: boolean;
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

/** The forecast verdict: its case, its note's tone, and the figures its copy quotes. */
export interface HealthMetricsEventsForecastVerdict {
  kind: HealthMetricsEventsForecastVerdictKind;
  tone: HealthMetricsNoteTone;
  forecast: number | null;
  goal: number | null;
  /** Registrations over (on track) or under (short) the goal. */
  gap: number;
  /** Forecast over goal, for the stale and goal-suspect copy; null when there is no goal or forecast. */
  ratio: number | null;
  daysLeft: number | null;
}

/** The selected event's metrics row and verdict note. */
export interface HealthMetricsEventsForecastView {
  metrics: HealthMetricsMetricItem[];
  note: HealthMetricsNote;
}

/** One event in the forecast's header select. */
export interface HealthMetricsEventsForecastOption {
  eventId: string;
  label: string;
}

/** The forecast's header select: every upcoming event, soonest first, and the one shown (`null` with none). */
export interface HealthMetricsEventsForecastPicker {
  options: HealthMetricsEventsForecastOption[];
  eventId: string | null;
}

/** An "All upcoming events" row with its labels and goal bar resolved once per response. */
export interface HealthMetricsEventsForecastRowView {
  eventId: string;
  eventName: string;
  /** "{City} · {Mon D, YYYY}", see `formatHealthMetricsEventsPlaceLabel`. */
  placeLabel: string;
  registrationsLabel: string;
  /** "Goal: {N}"; empty with no goal, which reads "No goal set" and draws no bar. */
  goalLabel: string;
  /** Registrations over goal, 0–100. */
  pct: number;
  fillClass: string;
  /** The fill's meaning for a screen reader, e.g. "Needs action"; empty with no goal, which draws no bar. */
  paceLabel: string;
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
  /** `null` when unknown, or when the city only says the event is online. */
  city: string | null;
  isVirtual: boolean;
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

/** A past-events table row with its labels and status pill resolved once per period. */
export interface HealthMetricsEventsPastRowView {
  eventId: string;
  eventName: string;
  /** "{City} · {Mon D, YYYY}", see `formatHealthMetricsEventsPlaceLabel`. */
  placeLabel: string;
  registrationsLabel: string;
  /** " / {goal} (goal)", or " / no goal set". */
  goalSuffix: string;
  revenueLabel: string;
  status: HealthMetricsEventsPastStatus;
  statusLabel: string;
  statusTone: UiBadgeTone;
}

/** The section for one period: its metrics row and the events that closed in it, most recent first. */
export interface HealthMetricsEventsPastView {
  metrics: HealthMetricsMetricItem[];
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
  /** Events in the period; for YTD that is those held so far plus this year's upcoming ones, which its change compares too. */
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
}

/** One comparison-table row: the period's value, the comparison period's, and the change as a badge (`null` reads "—"). */
export interface HealthMetricsEventsAtAGlanceRowView {
  key: string;
  label: string;
  value: string;
  comparison: string;
  change: string | null;
  changeTone: UiBadgeTone;
}

/** The section for one period: its metrics row and the comparison table with its two period headings. */
export interface HealthMetricsEventsAtAGlanceView {
  metrics: HealthMetricsMetricItem[];
  periodHeading: string;
  comparisonHeading: string;
  rows: HealthMetricsEventsAtAGlanceRowView[];
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

/** What Registrations & growth charts, as its header switch picks. */
export type HealthMetricsEventsRegistrationsGrowthMetric = 'registrations' | 'attendees';

/** A header switch option whose id is the metric it picks. */
export interface HealthMetricsEventsRegistrationsGrowthMetricOption extends FilterPillOption {
  id: HealthMetricsEventsRegistrationsGrowthMetric;
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
  /** The model's flag; an upcoming event falls in no period, so only the current-year table lists it, ahead of past events. */
  isPastEvent: boolean;
  /** Whether a past event met its combined goal; `null` when upcoming, with no goal, or with the goal withheld. */
  goalMet: boolean | null;
  /** The periods a past event falls in; empty for an upcoming one. */
  ranges: HealthMetricsL2Range[];
  /** `null` when unknown, or when the city only says the event is online. */
  city: string | null;
  isVirtual: boolean;
}

/** `GET /api/analytics/events-revenue` — each period's headline, every past event in the four periods and every upcoming event. */
export interface HealthMetricsEventsRevenue {
  periods: HealthMetricsEventsRevenuePeriod[];
  /** Past events in the four periods, then upcoming events; each group latest start first. */
  events: HealthMetricsEventsRevenueEvent[];
  /** `false` when only the foundation totals were read, so there is no per-event list to show. */
  eventsMeasured: boolean;
}

/** A revenue-by-event row with its labels resolved once per period. */
export interface HealthMetricsEventsRevenueRowView {
  eventId: string;
  eventName: string;
  /** "{City} · {Mon D, YYYY}", see `formatHealthMetricsEventsPlaceLabel`. */
  placeLabel: string;
  registrationLabel: string;
  /** " / {goal} (goal)", " / no goal set", or the withheld goal's note. */
  registrationGoalSuffix: string;
  sponsorshipLabel: string;
  sponsorshipGoalSuffix: string;
}

/** The section for one period: its metrics row and its events, with whether there is anything to show. */
export interface HealthMetricsEventsRevenueView {
  /** `false` when the read carried no period at all, so the section says so rather than pointing at another period. */
  foundationMeasured: boolean;
  /** `false` when the read carried no figures for the period, so nothing reads as a measured zero. */
  measured: boolean;
  /** `false` when the period lists no event, has no non-zero figure and no unconverted revenue, so it reads as empty. */
  hasRevenue: boolean;
  metrics: HealthMetricsMetricItem[];
  /** Upcoming events soonest first (current-year view only, as they fall in no period), then the period's past events latest first. */
  rows: HealthMetricsEventsRevenueRowView[];
  /** `false` when the foundation has totals but no per-event figures, so an empty list is not read as no events. */
  eventsMeasured: boolean;
}

/** Foundation scope for speakers and proposals; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsSpeakersQuery {
  foundationSlug: string;
}

/** A proposal's review outcome, grouped as the view groups the original CFP statuses. */
export type HealthMetricsEventsSpeakersStatusGroup = keyof typeof HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS;

/** What the switch under the proposals chart lists: the latest proposals, or the companies that submitted the most. */
export type HealthMetricsEventsSpeakersList = 'proposals' | 'companies';

/** A switch option whose id is the list it shows. */
export interface HealthMetricsEventsSpeakersListOption {
  id: HealthMetricsEventsSpeakersList;
  label: string;
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
  /** Empty falls back to the first letter. */
  logoUrl: string;
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
  /** The company's logo; empty falls back to the first letter. */
  logoUrl: string;
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
  /** The latest few per period, most recent first. */
  proposals: HealthMetricsEventsSpeakersProposal[];
}

/** One ranked-list row before formatting; `null` is not available, never zero. */
export interface HealthMetricsEventsRankedRowInput {
  key: string;
  label: string;
  value: number | null;
}

/** One ranked-list row as the design draws it: name and value, no bar. */
export interface HealthMetricsEventsRankedRowView {
  key: string;
  label: string;
  valueLabel: string;
}

/** A recent-proposals row with its labels resolved. The speaker is shown by job title, never by name. */
export interface HealthMetricsEventsSpeakersProposalRowView {
  key: string;
  /** The job title, or the session title when the proposal lists none. */
  title: string;
  /** The session title under a job title; empty when the session title leads. */
  description: string;
  /** "Individual" for a speaker proposing for no company. */
  company: HealthMetricsCellCompanyLead;
  eventName: string;
  dateLabel: string;
  /** "{Event} · {date}", as the drawer's rows read; either part drops when missing. */
  eventLine: string;
  statusLabel: string;
  statusTone: UiBadgeTone;
}

/** The section for one period, with every label ready to render. */
export interface HealthMetricsEventsSpeakersView {
  /** `false` when the read carried no period at all, so the section says so rather than pointing at another period. */
  foundationMeasured: boolean;
  /** `false` when the read carried no figures for the period, so nothing reads as a measured zero. */
  measured: boolean;
  metrics: HealthMetricsMetricItem[];
  /** Every year the view holds, whatever the period. */
  chart: HealthMetricsColumnChartView;
  /** The period's latest proposals, most recent first. */
  proposals: HealthMetricsEventsSpeakersProposalRowView[];
  /** The companies that submitted the most in the period, without the individual speakers. */
  companies: HealthMetricsBarListRow[];
  /** "View all {N} proposals" under the recent proposals; empty when the period lists none. */
  viewAllLabel: string;
}

/** One page of a period's proposals, cut by event and status group, for the All speaker proposals drawer. */
export interface HealthMetricsEventsSpeakerProposalsQuery {
  foundationSlug: string;
  range: HealthMetricsL2Range;
  /** Empty lists every event. */
  eventId: string;
  /** `null` lists every status. */
  status: HealthMetricsEventsSpeakersStatusGroup | null;
  offset: number;
  pageSize: number;
  /** Also list the period's events; the drawer asks once, as the list ignores the filters. */
  includeEvents: boolean;
}

/** An event with proposals in the period, as the drawer's event filter lists it. */
export interface HealthMetricsEventsSpeakerProposalsEvent {
  id: string;
  name: string;
}

/** `GET /api/analytics/events-speaker-proposals` — one page, most recent first. */
export interface HealthMetricsEventsSpeakerProposals {
  rows: HealthMetricsEventsSpeakersProposal[];
  /** Proposals matching the event and status. */
  totalRecords: number;
  /** The period's events, latest start first; `null` unless the request asked for them. */
  events: HealthMetricsEventsSpeakerProposalsEvent[] | null;
}

/** A drawer filter option; an empty id lists everything. */
export interface HealthMetricsEventsSpeakerProposalsFilterOption {
  id: string;
  label: string;
}

/** What the speakers section hands the All speaker proposals drawer as it opens. */
export interface HealthMetricsEventsSpeakerProposalsDrawerData {
  foundationSlug: string;
  range: HealthMetricsL2Range;
}

/** The membership cut over the organizations table. */
export type HealthMetricsEventsOrganizationsSegment = 'all' | 'members' | 'non-members';

/** Query params the Events sections read on arrival and write back; `null` clears one the URL carries. */
export interface HealthMetricsEventsQueryParams {
  event?: string | null;
  orgSegment?: HealthMetricsEventsOrganizationsSegment | null;
  orgSearch?: string | null;
  orgPage?: number | null;
}

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
  memberLabel: string;
  /** `●` for a member, `○` otherwise; decorative, since the label says it. */
  memberGlyph: string;
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
  /** Where the row opens: the Members directory or Non-Members company participation, searched by the organization's name. */
  link: HealthMetricsEventsOrganizationLink;
  /** The name link's accessible name, e.g. `Open Acme Motors in Members`. */
  linkLabel: string;
}

/** A row's in-app target: the name link's `routerLink` / `fragment` / `queryParams`, and what a row click navigates to. */
export interface HealthMetricsEventsOrganizationLink {
  commands: readonly string[];
  fragment: 'list' | 'orgs';
  /** Merged into the current query string; `null` clears a filter the URL already carries. */
  queryParams: Readonly<HealthMetricsMembersQueryParams> | Readonly<HealthMetricsNonMembersQueryParams>;
}

/** Foundation scope for sponsorship; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsSponsorshipQuery {
  foundationSlug: string;
}

/** Packages sold at one tier in a period. */
export interface HealthMetricsEventsSponsorshipTier {
  name: string;
  packages: number;
}

/** One period's sponsorship for the whole foundation. Every `null` is not available, never zero. */
export interface HealthMetricsEventsSponsorshipPeriod {
  range: HealthMetricsL2Range;
  revenueUsd: number | null;
  /** `null` when no goal is set; a goal of zero is no goal. */
  goalUsd: number | null;
  tierPackages: number | null;
  addOns: number | null;
  /** Revenue over the goal as a fraction, as the view models it; `null` without a goal or for a period it does not model. */
  progressToGoal: number | null;
  /** Year-over-year change in revenue as a fraction; `null` for a period the view does not compare. */
  changes: { revenue: number | null } | null;
  /** Tiers with a package sold in the period, in the view's rank order (most packages, then name). */
  tiers: HealthMetricsEventsSponsorshipTier[];
}

/** `GET /api/analytics/events-sponsorship` — each period's sponsorship revenue, goal and packages by tier. */
export interface HealthMetricsEventsSponsorship {
  periods: HealthMetricsEventsSponsorshipPeriod[];
}

/** The section for one period: its metrics row and each tier's packages as bars. */
export interface HealthMetricsEventsSponsorshipView {
  /** `false` when the read carried no period at all. */
  foundationMeasured: boolean;
  /** `false` when the read carried no figures for the period, so nothing reads as a measured zero. */
  measured: boolean;
  metrics: HealthMetricsMetricItem[];
  /** Most sold first, as the view ranks them. */
  tiers: HealthMetricsBarListRow[];
}

/** Foundation scope for geography; every period ships in one read, so the range stays client-side. */
export interface HealthMetricsEventsGeographyQuery {
  foundationSlug: string;
}

/** Registrations from one country in a period. */
export interface HealthMetricsEventsGeographyCountry {
  country: string;
  registrations: number;
}

/** One period's geographic distribution for the whole foundation. Every `null` is not available, never zero. */
export interface HealthMetricsEventsGeographyPeriod {
  range: HealthMetricsL2Range;
  /** Countries represented, from the at-a-glance rollup. */
  countries: number | null;
  /** Year-over-year change in countries as a fraction; `null` for a period the rollup does not compare. */
  changes: { countries: number | null } | null;
  /** The countries with the most registrations in the period, most first. */
  topCountries: HealthMetricsEventsGeographyCountry[];
  /** Countries with a registration in the period, the top list included. */
  rankedCountries: number;
}

/** `GET /api/analytics/events-geography` — each period's countries represented and top countries by registrations. */
export interface HealthMetricsEventsGeography {
  periods: HealthMetricsEventsGeographyPeriod[];
}

/** The section for one period, with every label ready to render. */
export interface HealthMetricsEventsGeographyView {
  /** `false` when the read carried no period at all. */
  foundationMeasured: boolean;
  /** `false` when no country has a registration in the period, so nothing reads as a measured zero. */
  measured: boolean;
  /** e.g. `42 countries`; empty when unmeasured. */
  countriesLabel: string;
  headline: HealthMetricsEventsAtAGlanceStatView;
  topCountries: HealthMetricsEventsRankedRowView[];
}

/** The event dialog Snapshot's period switch. */
export type HealthMetricsEventsSnapshotPeriod = '7d' | '30d' | '90d';

/** One option on the Snapshot's period switch: its label and the days it spans. */
export interface HealthMetricsEventsSnapshotPeriodOption {
  value: HealthMetricsEventsSnapshotPeriod;
  label: string;
  days: number;
}

/** `GET /api/analytics/events-snapshot` query: one event, scoped to the foundation it belongs to. */
export interface HealthMetricsEventsSnapshotQuery {
  foundationSlug: string;
  eventId: string;
}

/**
 * One completed ISO week of an event's registrations: the cumulative levels at its end and the change during it.
 * The newest week's levels run through yesterday, past the week's own end.
 */
export interface HealthMetricsEventsSnapshotWeek {
  /** `YYYY-MM-DD`, a Monday. */
  weekStartDate: string;
  /** `YYYY-MM-DD`, a Sunday. */
  weekEndDate: string;
  registrations: number;
  registrationsDelta: number;
  registrationRevenueUsd: number;
  registrationRevenueDeltaUsd: number;
  /** Whether the week overlaps each trailing period, as the view flags it. */
  inPeriod: Record<HealthMetricsEventsSnapshotPeriod, boolean>;
}

/** One sponsorship package: how many are sold in all, and how many of those in each trailing period. */
export interface HealthMetricsEventsSnapshotPackage {
  tier: string;
  sold: number;
  soldInPeriod: Record<HealthMetricsEventsSnapshotPeriod, number>;
  revenueUsd: number;
}

/** `GET /api/analytics/events-snapshot` — an event's registration weeks and sponsorship packages, for the Snapshot tab. */
export interface HealthMetricsEventsSnapshot {
  /** `YYYY-MM-DD` that the warehouse read as today; every figure runs through the day before. `null` with no rows. */
  today: string | null;
  /** Oldest first. */
  weeks: HealthMetricsEventsSnapshotWeek[];
  /** Packages with at least one sold, priciest per package first. */
  packages: HealthMetricsEventsSnapshotPackage[];
  /** Every sponsorship line, taxes and fees included, as the view counts them. */
  sponsorshipRevenueUsd: number;
  sponsorshipRevenueInPeriodUsd: Record<HealthMetricsEventsSnapshotPeriod, number>;
}
