// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_EMPTY_SOURCES } from './health-metrics-l2.constants';
import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsGeography,
  HealthMetricsEventsOrganizations,
  HealthMetricsEventsOrganizationsSegmentOption,
  HealthMetricsEventsPast,
  HealthMetricsEventsQueryParams,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthMetricOption,
  HealthMetricsEventsRevenue,
  HealthMetricsEventsSectionKey,
  HealthMetricsEventsSnapshot,
  HealthMetricsEventsSnapshotPeriodOption,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersTabOption,
  HealthMetricsEventsSponsorship,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsL2Blank, HealthMetricsL2Range, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type { UiBadgeTone } from '../interfaces/uikit.interface';

/**
 * The nine Events sections in render order. `key` is the section's URL fragment and the scroll-spy
 * allowlist; the DOM id is `sec-evt-<key>`.
 */
export const HEALTH_METRICS_EVENTS_SECTIONS = [
  {
    key: 'forecast',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Registration forecast',
    heading: 'Registration forecast',
    description: 'Will each upcoming event reach its registration goal?',
  },
  {
    key: 'past',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Past events',
    heading: 'Past events',
    description: 'How closed events ended against their goals.',
  },
  {
    key: 'kpi',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'At a glance',
    heading: 'Events at a glance',
    description: "How this year's events compare with last year.",
  },
  {
    key: 'reg',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event, snapshot: true },
    label: 'Registrations & growth',
    heading: 'Registrations & growth',
    description: 'How turnout has changed year to year, in person and online.',
  },
  {
    key: 'rev',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Revenue',
    heading: 'Event revenue',
    description: 'Ticket and sponsor income per event, against goal.',
    provisional: true,
  },
  {
    key: 'spon',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Sponsorship',
    heading: 'Sponsorship',
    description: 'How much sponsors paid, and which packages sold best.',
    provisional: true,
  },
  {
    key: 'spk',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Speakers & proposals',
    heading: 'Speakers & proposals',
    description: 'How many talks were submitted, and how many got in.',
  },
  {
    key: 'orgs',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Companies',
    heading: 'Companies at events',
    description: 'Which companies attend, sponsor and speak most.',
  },
  {
    key: 'geo',
    empty: { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event },
    label: 'Geographic distribution',
    heading: 'Geographic distribution',
    description: 'Where in the world registrations come from.',
  },
] as const satisfies readonly HealthMetricsL2Section[];

/** The tab's blank card, shown in place of every section when none has data for the period. */
export const HEALTH_METRICS_EVENTS_BLANK: HealthMetricsL2Blank = {
  icon: 'fa-light fa-ticket',
  noun: 'event',
  lead: 'Event results appear once the foundation has events on the calendar.',
  reasons: [
    'No event has been scheduled for the foundation yet',
    'Events run under another foundation are counted there',
    'Your LF Events contact can help plan one',
  ],
  pastActivity: 'event activity',
};

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX = 'sec-evt-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_EVENTS_DATA_SECTIONS = [
  'kpi',
  'forecast',
  'past',
  'reg',
  'rev',
  'spon',
  'spk',
  'orgs',
  'geo',
] as const satisfies readonly HealthMetricsEventsSectionKey[];

/** Query params the Events sections read; `event` lets a finding link open one event's forecast. */
export const HEALTH_METRICS_EVENTS_QUERY_PARAMS = {
  forecastEvent: 'event',
  orgSegment: 'orgSegment',
  orgSearch: 'orgSearch',
  orgPage: 'orgPage',
} as const satisfies Record<string, keyof HealthMetricsEventsQueryParams>;

/**
 * The goal bar by the forecast against the goal (EVT-01): its fill, gray with no forecast, and the words a screen reader
 * hears in place of the colour.
 */
export const HEALTH_METRICS_EVENTS_FORECAST_PACES = {
  action: { fillClass: 'bg-red-400', label: 'Needs action' },
  atRisk: { fillClass: 'bg-amber-400', label: 'Needs attention' },
  onTrack: { fillClass: 'bg-emerald-500', label: 'On track' },
  none: { fillClass: 'bg-gray-400', label: 'No forecast' },
} as const;

/** A forecast this many times its goal reads as a stale goal, not an over-performing event. */
export const HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO = 3;

/** Goal and forecast this far apart, either way, is a data-entry problem: the verdict, sort and sub-nav count withhold the pace. */
export const HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO = 10;

/** Words in an event's city or location that dbt reads as a virtual event; such a city names no place. */
export const HEALTH_METRICS_EVENTS_VIRTUAL_PLACE_TERMS: readonly string[] = ['online', 'virtual'];

/** Rows per page of the forecast's upcoming events, past events and revenue by event. */
export const HEALTH_METRICS_EVENTS_TABLE_PAGE_SIZE = 10;

/** The at-a-glance tooltip on Participating companies. */
export const HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPANIES_TIP = 'Companies that sent at least one registrant to an event this period.';

/** Upcoming events read per foundation; one past it tells a full scope from a truncated one. */
export const HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP = 200;

/** Read-failed / no-foundation value: no events, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED: HealthMetricsEventsForecast = { events: [] };

/** Read-failed / no-event value for the curve: no formats, which the chart renders as no curve. */
export const HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED: HealthMetricsEventsForecastCurve = { eventId: '', formats: [] };

/** Status pills for a closed event, as design-system badges. A missed goal splits on the model's pace band at close; `unmeasured` has no outcome read. */
export const HEALTH_METRICS_EVENTS_PAST_STATUSES = {
  hit: { label: 'Goal reached', tone: 'success' },
  'near-miss': { label: 'Just missed', tone: 'warning' },
  missed: { label: 'Goal missed', tone: 'danger' },
  'no-goal': { label: 'No goal set', tone: 'neutral' },
  unmeasured: { label: 'Not tracked', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: UiBadgeTone }>;

/** The model's pace band for an event that finished within reach of its goal. */
export const HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE = 'needs_attention';

/**
 * Closed events read per foundation across the four periods; one past it flags a truncated read.
 * The largest foundation reads under 100, so a truncated read would only drop the oldest rows.
 */
export const HEALTH_METRICS_EVENTS_PAST_EVENT_CAP = 500;

/** Read-failed / no-foundation value: no periods and no events, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_PAST_UNMEASURED: HealthMetricsEventsPast = { periods: [], events: [] };

/** The periods the at-a-glance view compares with the year before; the two oldest carry no change columns. */
export const HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPARED_RANGES: readonly HealthMetricsL2Range[] = ['YTD', 'COMPLETED_YEAR'];

/** Read-failed / no-foundation value: no periods, and `hasEvents` stays true so a failure never reads as a foundation without events. */
export const HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED: HealthMetricsEventsAtAGlance = { periods: [], upcomingEvents: null, hasEvents: true };

/** Years read per foundation; one past it flags a truncated read. The longest history spans under ten. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP = 100;

/** Read-failed / no-foundation value: no years, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED: HealthMetricsEventsRegistrationsGrowth = { years: [] };

/** The toggle over the chart and table; the first option is the default. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS: readonly HealthMetricsEventsRegistrationsGrowthMetricOption[] = [
  { id: 'registrations', label: 'Registrations' },
  { id: 'attendees', label: 'Attendees' },
];

/** Lower bound of the plausible year window; earlier years are dropped as bad data, so one stray row cannot fill decades of gap years. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR = 2000;

/** Upper bound of that window, as years past the current UTC year. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD = 5;

/** Years whose virtual peak the pandemic callout explains; the callout's year label is built from them. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_YEARS: readonly number[] = [2020, 2021];

/** Share of a pandemic year's total that must be virtual before the callout calls it a virtual peak. */
export const HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_VIRTUAL_SHARE = 0.5;

/** Event rows read per foundation, in-period events first; one more is read so a dropped in-period event is flagged. */
export const HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP = 500;

/** Read-failed / no-foundation value: no periods and no events, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED: HealthMetricsEventsRevenue = { periods: [], events: [], eventsMeasured: false };

/** The periods the revenue view compares with the year before; the oldest carries no change columns. */
export const HEALTH_METRICS_EVENTS_REVENUE_COMPARED_RANGES: readonly HealthMetricsL2Range[] = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2'];

/** Stands in for a goal set in a currency with no USD rate, so it never reads as no goal. */
export const HEALTH_METRICS_EVENTS_REVENUE_GOAL_WITHHELD = 'goal not in USD';

/** Read-failed / no-foundation value: no periods, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED: HealthMetricsEventsSpeakers = { periods: [], organizations: [], unaffiliated: [], proposals: [] };

/** The periods the speakers view compares with the year before; the two oldest carry no change columns. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_COMPARED_RANGES: readonly HealthMetricsL2Range[] = ['YTD', 'COMPLETED_YEAR'];

/** Organizations ranked per period; individual speakers sit on their own line, outside the ranking. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS = 5;

/** Recent proposals listed per period and tab. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS = 10;

/** Status groups as the view names them, with each group's badge. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS = {
  accepted: { label: 'Accepted', viewValue: 'Accepted', badgeClass: 'bg-emerald-50 text-emerald-700' },
  'in-review': { label: 'In review', viewValue: 'In review', badgeClass: 'bg-amber-50 text-amber-700' },
  declined: { label: 'Declined', viewValue: 'Declined', badgeClass: 'bg-gray-100 text-gray-600' },
} as const;

/** Badge for a proposal whose status the view left ungrouped. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_UNGROUPED_BADGE_CLASS = 'bg-gray-100 text-gray-600';

/** The tabs over the section; the first is the default. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS: readonly HealthMetricsEventsSpeakersTabOption[] = [
  { id: 'all', label: 'All proposals' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'in-review', label: 'In review' },
];

/** Shown for any figure the view did not measure, so a gap never reads as zero. */
export const HEALTH_METRICS_EVENTS_NOT_AVAILABLE = 'not available';

/** Read-failed / no-foundation value: no rows and no scope total, so nothing reads as zero organizations. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED: HealthMetricsEventsOrganizations = { rows: [], totalRecords: 0, scopeTotal: null };

/** The segment pills over the table; the first is the default. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS: readonly HealthMetricsEventsOrganizationsSegmentOption[] = [
  { id: 'all', label: 'All' },
  { id: 'members', label: 'Members' },
  { id: 'non-members', label: 'Non-members' },
];

/** Rows per page; the server caps a request at `HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE`. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_PAGE_SIZE = 25;

export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE = 100;

/** Search text past this length is cut before it is bound. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_SEARCH_LENGTH = 100;

export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEARCH_DEBOUNCE_MS = 200;

/** Membership as the design's text status: a filled dot for a member, a hollow one otherwise. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP = {
  member: { label: 'Member', glyph: '●', textClass: 'text-emerald-600' },
  nonMember: { label: 'Non-member', glyph: '○', textClass: 'text-gray-400' },
} as const;

/** Fill for the registrations mini bar. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_BAR_CLASS = 'bg-blue-300';

/** Read-failed / no-foundation value: no periods, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_SPONSORSHIP_UNMEASURED: HealthMetricsEventsSponsorship = { periods: [] };

/** Periods the sponsorship view models progress to goal for; the older years carry none. */
export const HEALTH_METRICS_EVENTS_SPONSORSHIP_PROGRESS_RANGES: readonly HealthMetricsL2Range[] = ['YTD', 'COMPLETED_YEAR'];

/** Stands in for a goal that is not set, so it never reads as a goal of zero. */
export const HEALTH_METRICS_EVENTS_SPONSORSHIP_GOAL_NOT_SET = 'not set';

/** Fill for the progress-to-goal bar. */
export const HEALTH_METRICS_EVENTS_SPONSORSHIP_BAR_CLASS = 'bg-blue-500';

/** Read-failed / no-foundation value: no periods, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_GEOGRAPHY_UNMEASURED: HealthMetricsEventsGeography = { periods: [] };

/** Countries ranked in the list. */
export const HEALTH_METRICS_EVENTS_GEOGRAPHY_TOP_COUNTRIES = 5;

/** The event dialog Snapshot's periods, as the design orders them. */
export const HEALTH_METRICS_EVENTS_SNAPSHOT_PERIODS: readonly HealthMetricsEventsSnapshotPeriodOption[] = [
  { value: '7d', label: '7d', days: 7 },
  { value: '30d', label: '30d', days: 30 },
  { value: '90d', label: '90d', days: 90 },
];

/** An event the snapshot views hold nothing for: no weeks, no packages and no revenue. */
export const HEALTH_METRICS_EVENTS_SNAPSHOT_UNMEASURED: HealthMetricsEventsSnapshot = {
  today: null,
  weeks: [],
  packages: [],
  sponsorshipRevenueUsd: 0,
  sponsorshipRevenueInPeriodUsd: { '7d': 0, '30d': 0, '90d': 0 },
};
