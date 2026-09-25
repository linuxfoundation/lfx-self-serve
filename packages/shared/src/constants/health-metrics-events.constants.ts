// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsSectionKey,
} from '../interfaces/health-metrics-events.interface';

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
export const HEALTH_METRICS_EVENTS_DATA_SECTIONS = ['forecast'] as const satisfies readonly HealthMetricsEventsSectionKey[];

/** Static note under the sub-nav items; stays plain text until the Members tab exists to link to. */
export const HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE = "An organization's event record also appears in Members";

/** Query params the Events sections read; `event` lets a finding link open one event's forecast. */
export const HEALTH_METRICS_EVENTS_QUERY_PARAMS = {
  forecastEvent: 'event',
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

export const HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED: HealthMetricsEventsForecastCurve = { eventId: '', formats: [] };
