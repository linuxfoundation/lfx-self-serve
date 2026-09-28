// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsOrganizations,
  HealthMetricsEventsOrganizationsSegmentOption,
  HealthMetricsEventsPast,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthMetricOption,
  HealthMetricsEventsRevenue,
  HealthMetricsEventsSectionKey,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersTabOption,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';

/**
 * The nine Events sections in render order. `key` is the section's URL fragment and the scroll-spy
 * allowlist; the DOM id is `sec-evt-<key>`. Footnotes land with each section's data.
 */
export const HEALTH_METRICS_EVENTS_SECTIONS = [
  {
    key: 'forecast',
    label: 'Registration forecast',
    heading: 'Registration forecast',
    description:
      'The most decision-sensitive view in Events: where registrations will land, while there is still time to act. Plotted against days to event so a small meetup and KubeCon can be read the same way.',
    footnote:
      'The forecast is a projection from historical pacing curves, not a promise — the band is the confidence range. An event with no last-year curve is projected from comparable events, which is why its range is wider.',
    footnoteCaution: false,
  },
  {
    key: 'past',
    label: 'Past events',
    heading: 'Past events',
    description:
      'Final performance for events that have already closed — the record the registration forecast was projecting toward while they were still open.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'kpi',
    label: 'At a glance',
    heading: 'Events at a glance',
    description: 'Reach across every event this period.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'reg',
    label: 'Registrations & growth',
    heading: 'Registrations & growth',
    description: 'Registrations by year, split in-person versus virtual.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'rev',
    label: 'Revenue',
    heading: 'Event revenue',
    description:
      'The two money lines events generate. Registration revenue is what attendees pay; sponsorship is what companies pay. They are driven by different teams and behave differently, so they are never merged into one figure.',
    footnote: '',
    footnoteCaution: false,
    headingBadge: 'Provisional',
  },
  {
    key: 'spon',
    label: 'Sponsorship',
    heading: 'Sponsorship',
    description: 'What companies paid to sponsor events, and what they bought.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'spk',
    label: 'Speakers & proposals',
    heading: 'Speakers & proposals',
    description:
      'The speaking pipeline, kept separate from sponsorship — proposals measure community supply, sponsorship measures revenue. Acceptance rate shows how much choice the programme committee had.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'orgs',
    label: 'Organizations',
    heading: 'Organizations at events',
    description:
      'Which organizations show up, sponsor and speak. This is the events view of an organization — the same company also has a membership, meeting and contribution record in Members.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'geo',
    label: 'Geographic distribution',
    heading: 'Geographic distribution',
    description: 'Where registrations come from — useful for deciding where the next event should be and which regions are under-served.',
    footnote: '',
    footnoteCaution: false,
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX = 'sec-evt-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_EVENTS_DATA_SECTIONS = [
  'kpi',
  'forecast',
  'past',
  'reg',
  'rev',
  'spk',
  'orgs',
] as const satisfies readonly HealthMetricsEventsSectionKey[];

/** Static note under the sub-nav items; stays plain text until the Members tab exists to link to. */
export const HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE = "An organization's event record also appears in Members";

/** Query params the Events sections read; `event` lets a finding link open one event's forecast. */
export const HEALTH_METRICS_EVENTS_QUERY_PARAMS = {
  forecastEvent: 'event',
  orgSegment: 'orgSegment',
  orgSearch: 'orgSearch',
  orgPage: 'orgPage',
} as const;

/** Pace chips, EVT-01. `No data` covers a missing forecast and a goal off by an order of magnitude. */
export const HEALTH_METRICS_EVENTS_FORECAST_STATUSES = {
  'on-track': { label: 'On track', badgeClass: 'bg-emerald-50 text-emerald-700' },
  'at-risk': { label: 'At risk', badgeClass: 'bg-amber-50 text-amber-700' },
  action: { label: 'Action required', badgeClass: 'bg-red-50 text-red-700' },
  'no-goal': { label: 'No goal', badgeClass: 'bg-gray-100 text-gray-600' },
  'no-data': { label: 'No data', badgeClass: 'bg-gray-100 text-gray-500' },
} as const;

/** A forecast this many times its goal reads as a stale goal, not an over-performing event. */
export const HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO = 3;

/** Goal and forecast this far apart, either way, is a data-entry problem: the chip is withheld. */
export const HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO = 10;

/** Event pills truncate past this many characters. */
export const HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX = 34;

/** Chart datasets drawn but left out of the legend: the band's floor and the today marker. */
export const HEALTH_METRICS_EVENTS_FORECAST_HIDDEN_LEGEND_LABELS: readonly string[] = ['Forecast low', 'Today'];

/** Upcoming events read per foundation; one past it tells a full scope from a truncated one. */
export const HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP = 200;

/** Read-failed / no-foundation value: no events, which the section must not caption as measured. */
export const HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED: HealthMetricsEventsForecast = { events: [] };

/** Read-failed / no-event value for the curve: no formats, which the chart renders as no curve. */
export const HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED: HealthMetricsEventsForecastCurve = { eventId: '', formats: [] };

/** Outcome chips for a closed event. A missed goal splits on the model's pace band at close; `unmeasured` has no outcome read. */
export const HEALTH_METRICS_EVENTS_PAST_STATUSES = {
  hit: { label: 'Hit goal', badgeClass: 'bg-emerald-50 text-emerald-700', progressClass: 'bg-emerald-500' },
  'near-miss': { label: 'Just missed', badgeClass: 'bg-amber-50 text-amber-700', progressClass: 'bg-amber-500' },
  missed: { label: 'Missed goal', badgeClass: 'bg-red-50 text-red-700', progressClass: 'bg-red-400' },
  'no-goal': { label: 'No goal set', badgeClass: 'bg-gray-100 text-gray-600', progressClass: 'bg-gray-200' },
  unmeasured: { label: 'Not tracked', badgeClass: 'bg-gray-100 text-gray-600', progressClass: 'bg-gray-200' },
} as const;

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

/** Read-failed / no-foundation value: no periods, and `hasEvents` stays true so a failure never reads as "No events yet". */
export const HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED: HealthMetricsEventsAtAGlance = { periods: [], upcomingEvents: null, hasEvents: true };

/** A year-over-year fall steeper than this flags the Attendees and Speakers tiles. */
export const HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE = -0.3;

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

/** Right-aligned note above the revenue figures while they are provisional. */
export const HEALTH_METRICS_EVENTS_REVENUE_PENDING_NOTE = 'All figures pending validation';

/** Footer note for revenue that stayed in local currency; the marker flags each affected figure, headline included. */
export const HEALTH_METRICS_EVENTS_REVENUE_UNCONVERTED_NOTE =
  'Events are billed in local currency. Figures marked * leave out registration revenue not yet converted to USD, so they are incomplete.';

/** Screen-reader text for the * marker on a figure that leaves out unconverted revenue. */
export const HEALTH_METRICS_EVENTS_REVENUE_UNCONVERTED_SCREEN_READER_TEXT = '(leaves out local-currency amounts not yet converted to USD)';

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

/** Status groups as the view names them, with each group's badge and status-bar fill. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS = {
  accepted: { label: 'Accepted', viewValue: 'Accepted', badgeClass: 'bg-emerald-50 text-emerald-700', barClass: 'bg-emerald-500' },
  'in-review': { label: 'In review', viewValue: 'In review', badgeClass: 'bg-amber-50 text-amber-700', barClass: 'bg-amber-500' },
  declined: { label: 'Declined', viewValue: 'Declined', badgeClass: 'bg-gray-100 text-gray-600', barClass: 'bg-gray-400' },
} as const;

/** Fill for the top-organizations bars. */
export const HEALTH_METRICS_EVENTS_SPEAKERS_ORGANIZATION_BAR_CLASS = 'bg-blue-500';

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

/** Membership pills. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP = {
  member: { label: 'Member', badgeClass: 'bg-emerald-50 text-emerald-700' },
  nonMember: { label: 'Non-member', badgeClass: 'bg-gray-100 text-gray-600' },
} as const;

/** Fill for the registrations mini bar. */
export const HEALTH_METRICS_EVENTS_ORGANIZATIONS_BAR_CLASS = 'bg-blue-500';
