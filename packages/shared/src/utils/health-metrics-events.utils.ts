// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX,
  HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_FORECAST_STATUSES,
  HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_SECTIONS,
} from '../constants/health-metrics-events.constants';
import { formatIsoDateLabel } from './date-time.utils';

import type {
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastRowView,
  HealthMetricsEventsForecastStatus,
  HealthMetricsEventsForecastVerdict,
  HealthMetricsEventsSectionKey,
  HealthMetricsEventsSubNavItem,
} from '../interfaces/health-metrics-events.interface';

/** Sub-nav items for the Events tab. The forecast carries a note but, per the design, no badge. */
export function buildHealthMetricsEventsSubNavItems(notes: Partial<Record<HealthMetricsEventsSectionKey, string>> = {}): HealthMetricsEventsSubNavItem[] {
  return HEALTH_METRICS_EVENTS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: null, note: notes[section.key] ?? '' }));
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
  if (event.goal === null || event.goal <= 0) return 'no-goal';
  if (event.forecastAvg === null || isHealthMetricsEventsForecastGoalSuspect(event)) return 'no-data';
  if (event.forecastHigh !== null && event.forecastHigh < event.goal) return 'action';
  if (event.forecastAvg < event.goal) return 'at-risk';

  return 'on-track';
}

/** The callout under the headline. A goal 3× under the forecast reads as stale, not as success. */
export function resolveHealthMetricsEventsForecastVerdict(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastVerdict {
  const base = { forecast: event.forecastAvg, goal: event.goal, gap: 0, ratio: null, daysLeft: event.daysLeft };

  if (event.goal === null || event.goal <= 0) return { ...base, kind: 'no-goal', tone: 'none' };
  if (event.forecastAvg === null) return { ...base, kind: 'no-data', tone: 'none' };

  const ratio = event.forecastAvg / event.goal;
  if (ratio >= HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO) return { ...base, kind: 'stale', tone: 'watch', ratio };
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return { ...base, kind: 'goal-suspect', tone: 'watch', ratio };

  const gap = Math.round(event.forecastAvg - event.goal);
  if (gap >= 0) return { ...base, kind: 'on-track', tone: 'ok', gap };

  return { ...base, kind: 'short', tone: 'act', gap: -gap };
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

/** Worst pacing first by registrations against goal; events with no usable goal go last. */
export function sortHealthMetricsEventsForecastRows(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastEvent[] {
  const pace = (event: HealthMetricsEventsForecastEvent): number =>
    event.goal === null || event.goal <= 0 || isHealthMetricsEventsForecastGoalSuspect(event)
      ? Number.POSITIVE_INFINITY
      : (event.registrationsNow ?? 0) / event.goal;

  return [...events].sort((a, b) => pace(a) - pace(b) || a.eventName.localeCompare(b.eventName));
}

/** The table's rows with every label resolved, so the template formats nothing per render. */
export function buildHealthMetricsEventsForecastRowViews(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastRowView[] {
  return sortHealthMetricsEventsForecastRows(events).map((event) => {
    const status = resolveHealthMetricsEventsForecastStatus(event);
    const pct = event.goal !== null && event.goal > 0 ? Math.round(((event.registrationsNow ?? 0) / event.goal) * 100) : null;

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

function resolveProgressClass(pct: number | null): string {
  if (pct === null) return 'bg-gray-200';
  if (pct >= 90) return 'bg-emerald-500';

  return pct >= 45 ? 'bg-amber-500' : 'bg-red-400';
}
