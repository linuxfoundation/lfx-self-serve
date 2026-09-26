// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE,
  HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX,
  HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_FORECAST_STATUSES,
  HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_NOT_AVAILABLE,
  HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE,
  HEALTH_METRICS_EVENTS_PAST_STATUSES,
  HEALTH_METRICS_EVENTS_SECTIONS,
} from '../constants/health-metrics-events.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { formatCurrency } from './number.utils';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlanceDelta,
  HealthMetricsEventsAtAGlancePeriod,
  HealthMetricsEventsAtAGlanceStatView,
  HealthMetricsEventsAtAGlanceView,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastRowView,
  HealthMetricsEventsForecastStatus,
  HealthMetricsEventsForecastVerdict,
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsPastRowView,
  HealthMetricsEventsPastStatus,
  HealthMetricsEventsPastView,
  HealthMetricsEventsSectionKey,
  HealthMetricsEventsSubNavItem,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';

/** Sub-nav items for the Events tab. The forecast carries a note but, per the design, no badge. */
export function buildHealthMetricsEventsSubNavItems(
  notes: Partial<Record<HealthMetricsEventsSectionKey, string>> = {},
  counts: Partial<Record<HealthMetricsEventsSectionKey, number | null>> = {}
): HealthMetricsEventsSubNavItem[] {
  return HEALTH_METRICS_EVENTS_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    count: counts[section.key] ?? null,
    note: notes[section.key] ?? '',
  }));
}

/** True when goal and forecast differ by an order of magnitude or more — a data-entry problem, not a pace. */
export function isHealthMetricsEventsForecastGoalSuspect(event: HealthMetricsEventsForecastEvent): boolean {
  if (event.goal === null || event.goal <= 0 || event.forecastAvg === null) return false;

  const ratio = event.forecastAvg / event.goal;
  return ratio >= HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO || ratio <= 1 / HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO;
}

/**
 * EVT-01: upper forecast below goal is Action required, central below goal is At risk, else On track.
 * The band narrows as the event nears, so the rule calibrates itself.
 */
export function resolveHealthMetricsEventsForecastStatus(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastStatus {
  // No forecast outranks no goal: there is nothing to show either way, and the contract says No data.
  if (event.forecastAvg === null) return 'no-data';
  if (event.goal === null || event.goal <= 0) return 'no-goal';
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return 'no-data';
  if (event.forecastHigh !== null && event.forecastHigh < event.goal) return 'action';
  if (event.forecastAvg < event.goal) return 'at-risk';

  return 'on-track';
}

/** The callout under the headline. A goal 3× under the forecast reads as stale, not as success. */
export function resolveHealthMetricsEventsForecastVerdict(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastVerdict {
  const base = { forecast: event.forecastAvg, goal: event.goal, gap: 0, ratio: null, daysLeft: event.daysLeft };

  if (event.forecastAvg === null) return { ...base, kind: 'no-data', tone: 'none' };
  if (event.goal === null || event.goal <= 0) return { ...base, kind: 'no-goal', tone: 'none' };

  // Mis-entered goes first, so a 10× gap reads the same as the chip, which withholds it.
  const ratio = event.forecastAvg / event.goal;
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return { ...base, kind: 'goal-suspect', tone: 'watch', ratio };
  if (ratio >= HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO) return { ...base, kind: 'stale', tone: 'watch', ratio };

  // Branch on the raw values, as the chip does, and round only the gap shown.
  const gap = Math.round(Math.abs(event.forecastAvg - event.goal));
  if (event.forecastAvg >= event.goal) return { ...base, kind: 'on-track', tone: 'ok', gap };

  return { ...base, kind: 'short', tone: 'act', gap };
}

/** Sub-nav note: events projected under goal, leaving out the ones whose goal looks mis-entered. */
export function buildHealthMetricsEventsForecastNote(events: HealthMetricsEventsForecastEvent[]): string {
  const missing = events.filter((event) => {
    const status = resolveHealthMetricsEventsForecastStatus(event);
    return status === 'action' || status === 'at-risk';
  }).length;

  return missing > 0 ? `${missing} will miss goal` : '';
}

/** Events a forecast can be drawn for — the selector's pills. */
export function filterHealthMetricsEventsForecastable(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastEvent[] {
  return events.filter((event) => event.forecastAvg !== null);
}

/** Worst pacing first by registrations against goal; events with no usable goal or count go last. */
export function sortHealthMetricsEventsForecastRows(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastEvent[] {
  const pace = (event: HealthMetricsEventsForecastEvent): number =>
    isHealthMetricsEventsForecastGoalSuspect(event) ? Number.POSITIVE_INFINITY : (resolveProgressRatio(event) ?? Number.POSITIVE_INFINITY);

  return [...events].sort((a, b) => pace(a) - pace(b) || a.eventName.localeCompare(b.eventName, 'en-US'));
}

/** The table's rows with every label resolved, so the template formats nothing per render. */
export function buildHealthMetricsEventsForecastRowViews(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastRowView[] {
  return sortHealthMetricsEventsForecastRows(events).map((event) => {
    const status = resolveHealthMetricsEventsForecastStatus(event);
    const ratio = resolveProgressRatio(event);
    const pct = ratio === null ? null : Math.round(ratio * 100);

    return {
      event,
      status,
      statusLabel: HEALTH_METRICS_EVENTS_FORECAST_STATUSES[status].label,
      statusClass: HEALTH_METRICS_EVENTS_FORECAST_STATUSES[status].badgeClass,
      dateLabel: event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—',
      registrationsLabel: formatHealthMetricsEventsCount(event.registrationsNow),
      goalLabel: formatHealthMetricsEventsCount(event.goal),
      progressPct: pct === null ? null : Math.min(pct, 100),
      progressClass: resolveProgressClass(pct),
    };
  });
}

/** Rounded, `en-US`-pinned so the server render and the hydrated one agree; `—` for unmeasured. */
export function formatHealthMetricsEventsCount(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('en-US');
}

/** A pill label, truncated with an ellipsis past the design's length. */
export function truncateHealthMetricsEventsPillName(name: string): string {
  return name.length > HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX ? `${name.slice(0, HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX - 2)}…` : name;
}

/** The format the chart opens on: whichever has registered more people so far. */
export function pickHealthMetricsEventsForecastFormat(formats: HealthMetricsEventsForecastCurveSeries[]): string | null {
  let best: { format: string; registrations: number } | null = null;

  for (const series of formats) {
    const registrations = Math.max(0, ...series.points.map((point) => point.actual ?? 0));
    if (!best || registrations > best.registrations) best = { format: series.format, registrations };
  }

  return best?.format ?? null;
}

/** A closed event's outcome. A miss the model banded as needing attention finished within reach. */
export function resolveHealthMetricsEventsPastStatus(event: HealthMetricsEventsPastEvent): HealthMetricsEventsPastStatus {
  if (event.goal === null) return 'no-goal';
  // An unflagged outcome falls back to final registrations against the goal; with neither, it is unmeasured.
  let met = event.goalMet;
  if (met === null) {
    if (event.registrations === null) return 'unmeasured';
    met = event.registrations >= event.goal;
  }
  if (met) return 'hit';

  return event.paceStatus === HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE ? 'near-miss' : 'missed';
}

/** One period's section: the view's count and registrations, with the goal tally read off the same rows as the chips. */
export function buildHealthMetricsEventsPastView(past: HealthMetricsEventsPast, range: HealthMetricsRange): HealthMetricsEventsPastView {
  const period = past.periods.find((candidate) => candidate.range === range);
  const rows = past.events.filter((event) => event.ranges.some((candidate) => candidate === range)).map(buildPastRowView);

  return {
    eventCount: period?.eventCount ?? null,
    registrations: period?.registrations ?? null,
    goalMetCount: rows.filter((row) => row.status === 'hit').length,
    goalSetCount: rows.filter((row) => row.status !== 'no-goal' && row.status !== 'unmeasured').length,
    hasGoals: rows.some((row) => row.status !== 'no-goal'),
    rows,
  };
}

/** The control line: how many events the period closed; `—` when the period is unmeasured. */
export function formatHealthMetricsEventsPastClosedLabel(eventCount: number | null): string {
  if (eventCount === null) return '—';

  return `${formatHealthMetricsEventsCount(eventCount)} ${eventCount === 1 ? 'event' : 'events'} closed this period`;
}

/** `$0` is a measured result; only an unmeasured revenue reads as not available. */
export function formatHealthMetricsEventsRevenue(value: number | null): string {
  return value === null ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : formatCurrency(value);
}

/** One period's at-a-glance section. For YTD the events total adds the upcoming ones to those held so far. */
export function buildHealthMetricsEventsAtAGlanceView(glance: HealthMetricsEventsAtAGlance, range: HealthMetricsRange): HealthMetricsEventsAtAGlanceView {
  const period = glance.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const upcoming = range === 'YTD' ? glance.upcomingEvents : 0;
  const past = period?.pastEvents ?? null;
  const total = past === null || upcoming === null ? null : past + upcoming;
  // `null` changes means the period is not compared, so its figures carry no delta at all.
  const delta = (value: number | null | undefined, unit: 'pct' | 'pp' = 'pct'): HealthMetricsEventsAtAGlanceDelta =>
    changes ? formatAtAGlanceDelta(value ?? null, unit) : { delta: null, deltaDirection: 'neutral' };
  const warns = (value: number | null | undefined): boolean => value !== null && value !== undefined && value < HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE;
  const stat = (key: string, label: string, value: string, change: HealthMetricsEventsAtAGlanceDelta, warn = false): HealthMetricsEventsAtAGlanceStatView => ({
    key,
    label,
    value,
    ...change,
    warn,
  });

  return {
    measured: period !== null,
    controlLabel: [formatCountPart(total, 'events'), formatCountPart(past, 'past'), formatCountPart(upcoming, 'upcoming')].join(' · '),
    baselineLabel: formatAtAGlanceBaseline(range, changes !== null),
    headline: stat('registrations', 'Total registrations', formatAtAGlanceCount(period?.registrations), delta(changes?.registrations)),
    side: [
      stat('attendees', 'Attendees', formatAtAGlanceCount(period?.attendees), delta(changes?.attendees)),
      stat('show-up-rate', 'Show-up rate', formatShowUpRate(period), delta(changes?.showUpRatePts, 'pp')),
      stat('events', 'Events held', formatAtAGlanceCount(period?.events), delta(changes?.events)),
    ],
    tiles: [
      stat('registrations', 'Registrations', formatAtAGlanceCount(period?.registrations), delta(changes?.registrations)),
      stat('attendees', 'Attendees', formatAtAGlanceCount(period?.attendees), delta(changes?.attendees), warns(changes?.attendees)),
      stat('organizations', 'Organizations', formatAtAGlanceCount(period?.organizations), delta(changes?.organizations)),
      stat('speakers', 'Speakers', formatAtAGlanceCount(period?.speakers), delta(changes?.speakers), warns(changes?.speakers)),
      stat('countries', 'Countries', formatAtAGlanceCount(period?.countries), delta(changes?.countries)),
      { key: 'past-upcoming', label: 'Past / upcoming', value: formatPastUpcoming(past, upcoming), delta: null, deltaDirection: 'neutral', warn: false },
    ],
  };
}

function formatAtAGlanceCount(value: number | null | undefined): string {
  return value === null || value === undefined ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : value.toLocaleString('en-US');
}

function formatCountPart(value: number | null, noun: string): string {
  if (value === null) return `${noun} ${HEALTH_METRICS_EVENTS_NOT_AVAILABLE}`;

  return `${value.toLocaleString('en-US')} ${value === 1 && noun === 'events' ? 'event' : noun}`;
}

function formatShowUpRate(period: HealthMetricsEventsAtAGlancePeriod | null): string {
  return period?.showUpRate === null || period?.showUpRate === undefined ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : `${Math.round(period.showUpRate * 100)}%`;
}

function formatPastUpcoming(past: number | null, upcoming: number | null): string {
  if (past === null || upcoming === null) return HEALTH_METRICS_EVENTS_NOT_AVAILABLE;

  return `${past.toLocaleString('en-US')} / ${upcoming.toLocaleString('en-US')}`;
}

function formatAtAGlanceBaseline(range: HealthMetricsRange, compared: boolean): string {
  if (!compared) return 'no year-over-year comparison for this period';
  if (range === 'YTD') return 'all against the same point last year';

  return `all against ${getYearForRange(range) - 1}`;
}

/** A change as a whole percent (`−25%`) or, for a rate, points at one decimal (`+2.2 pp`); the sign follows the rounded value. */
function formatAtAGlanceDelta(fraction: number | null, unit: 'pct' | 'pp'): HealthMetricsEventsAtAGlanceDelta {
  if (fraction === null) return { delta: HEALTH_METRICS_EVENTS_NOT_AVAILABLE, deltaDirection: 'neutral' };

  const rounded = unit === 'pct' ? Math.round(fraction * 100) : Number((fraction * 100).toFixed(1));
  const magnitude = unit === 'pct' ? `${Math.abs(rounded)}%` : `${Math.abs(rounded).toFixed(1)} pp`;
  if (rounded === 0) return { delta: magnitude, deltaDirection: 'neutral' };

  return { delta: `${rounded > 0 ? '+' : '−'}${magnitude}`, deltaDirection: rounded > 0 ? 'up' : 'down' };
}

function buildPastRowView(event: HealthMetricsEventsPastEvent): HealthMetricsEventsPastRowView {
  const status = resolveHealthMetricsEventsPastStatus(event);

  return {
    event,
    status,
    statusLabel: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].label,
    statusClass: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].badgeClass,
    dateLabel: event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—',
    registrationsLabel: formatHealthMetricsEventsCount(event.registrations),
    goalLabel: formatHealthMetricsEventsCount(event.goal),
    revenueLabel: formatHealthMetricsEventsRevenue(event.revenueUsd),
    progressPct: resolvePastProgressPct(event),
    progressClass: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].progressClass,
  };
}

/** Final registrations against goal, capped at 100; null when either is unmeasured, since null is not zero. */
function resolvePastProgressPct(event: HealthMetricsEventsPastEvent): number | null {
  if (event.goal === null || event.goal <= 0 || event.registrations === null) return null;

  return Math.min(100, Math.round((event.registrations / event.goal) * 100));
}

/** Registrations now against goal; null when either is unmeasured, since null is not zero. */
function resolveProgressRatio(event: HealthMetricsEventsForecastEvent): number | null {
  if (event.goal === null || event.goal <= 0 || event.registrationsNow === null) return null;

  return event.registrationsNow / event.goal;
}

function resolveProgressClass(pct: number | null): string {
  if (pct === null) return 'bg-gray-200';
  if (pct >= 90) return 'bg-emerald-500';

  return pct >= 45 ? 'bg-amber-500' : 'bg-red-400';
}
