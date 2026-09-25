// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_EVENTS_FORECAST_STATUSES, HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import type { HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

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
  /** Forecast over goal, for the stale-goal copy. */
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
  /** 0–100, `null` with no goal to fill against. */
  progressPct: number | null;
  progressClass: string;
}
