// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
  HEALTH_METRICS_EVENTS_PAST_EVENT_CAP,
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_L2_RANGES,
} from '@lfx-one/shared/constants';

import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurveQuery,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastQuery,
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsPastPeriod,
  HealthMetricsEventsPastQuery,
  HealthMetricsL2Range,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const REGISTRATION_FORECAST_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATION_FORECAST';
const PAST_EVENTS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_PAST_EVENTS';

/** Label for a curve row the view left without a registration type. */
const UNTYPED_FORMAT_LABEL = 'All formats';

/** True when the Events views carry columns for the range; for a controller to check before binding. */
export function isSupportedEventsRange(range: string): range is HealthMetricsL2Range {
  return Object.prototype.hasOwnProperty.call(HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, range);
}

interface ForecastEventRow {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  FORECAST_AVG: number | null;
  FORECAST_LOW: number | null;
  FORECAST_HIGH: number | null;
  REGISTRATIONS_NOW: number | null;
  PRIOR_YEAR_SAME_POINT: number | null;
  GOAL: number | null;
  DAYS_LEFT: number | null;
  IS_NEW_EVENT: boolean | null;
}

interface ForecastCurveRow {
  DAYS_TO_EVENT: number | null;
  EVENT_REGISTRATION_TYPE: string | null;
  PRED_TYPE: string | null;
  FORECAST_AVG: number | null;
  FORECAST_LOW: number | null;
  FORECAST_HIGH: number | null;
  PRIOR_YEAR: number | null;
}

/** Per-period columns (`IS_IN_PERIOD_<SUFFIX>`, `SCOPE_*_<SUFFIX>`) are read by name off the suffix map. */
interface PastEventRow {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  REGISTRATIONS: number | null;
  GOAL: number | null;
  HAS_GOAL: boolean | null;
  GOAL_MET: boolean | null;
  REVENUE_USD: number | null;
  PACE_STATUS: string | null;
  [periodColumn: string]: unknown;
}

/** The Events tab's view reads, one method per section, each through `executeSnowflakeViewRead`. */
export class HealthMetricsEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Every upcoming event's event-wide headline. The headline columns repeat on every curve row, so
   * one modeled row per event is read; the model is a snapshot of now, so no period applies.
   */
  public async getRegistrationForecast(req: Request, query: HealthMetricsEventsForecastQuery): Promise<HealthMetricsEventsForecast> {
    // The start-date filter keeps an event whose day has passed out even before the model drops it.
    // First edition is flagged per format, so an event is new only when all of its formats are.
    const sql = `
      SELECT
        event_id,
        event_name,
        event_start_date,
        event_forecast_registrations_avg AS forecast_avg,
        event_forecast_registrations_low AS forecast_low,
        event_forecast_registrations_high AS forecast_high,
        final_current_cumulative_registrations AS registrations_now,
        event_registrations_prior_year_same_point AS prior_year_same_point,
        event_registrations_goal AS goal,
        days_left,
        BOOLAND_AGG(is_new_event) OVER (PARTITION BY event_id) AS is_new_event
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_start_date >= CURRENT_DATE()
      QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY event_registration_type ASC NULLS LAST, pred_type ASC, days_to_event ASC) = 1
      ORDER BY event_start_date ASC, event_name ASC NULLS LAST, event_id ASC
      LIMIT ${HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<ForecastEventRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: REGISTRATION_FORECAST_VIEW,
      operation: 'get_events_registration_forecast',
      clientMessage: 'The registration forecast is unavailable right now.',
    });

    // Reading one past the cap is what separates a scope of exactly the cap from a truncated one.
    if (result.rows.length > HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP) {
      logger.warning(req, 'get_events_registration_forecast', 'Upcoming event rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
      });
    }

    const events = result.rows
      .slice(0, HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP)
      .map(mapForecastEvent)
      .filter((event): event is HealthMetricsEventsForecastEvent => event !== null);

    return { events };
  }

  /**
   * One event's pacing curve, one series per registration format — In Person and Virtual need not
   * cover the same days, so summing them per day would understate any day one side has no row.
   */
  public async getRegistrationForecastCurve(req: Request, query: HealthMetricsEventsForecastCurveQuery): Promise<HealthMetricsEventsForecastCurve> {
    // One event under the all-projects cut is one row per format, `pred_type` and day, so no roll-up.
    const sql = `
      SELECT
        days_to_event,
        event_registration_type,
        pred_type,
        cumulative_avg_predicted_registrations AS forecast_avg,
        cumulative_low_predicted_registrations AS forecast_low,
        cumulative_high_predicted_registrations AS forecast_high,
        prior_event_cumulative_registrations AS prior_year
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_id = ?
        AND event_start_date >= CURRENT_DATE()
      ORDER BY event_registration_type ASC NULLS LAST, days_to_event ASC
    `;

    const result = await executeSnowflakeViewRead<ForecastCurveRow>(this.snowflakeService, req, sql, [query.foundationSlug, query.eventId], {
      view: REGISTRATION_FORECAST_VIEW,
      operation: 'get_events_registration_forecast_curve',
      clientMessage: 'The registration forecast curve is unavailable right now.',
    });

    if (result.rows.length === 0) return HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED;

    return { eventId: query.eventId, formats: groupCurveRows(result.rows) };
  }

  /**
   * Every closed event in the four periods, with each period's header totals. The headers repeat on
   * every row, so they come off the first; the client picks the period, so one read serves all four.
   */
  public async getPastEvents(req: Request, query: HealthMetricsEventsPastQuery): Promise<HealthMetricsEventsPast> {
    // Suffixes come from a constant map, never from the request, so interpolating them is safe.
    const suffixes = HEALTH_METRICS_L2_RANGES.map((range) => HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]);
    const periodColumns = suffixes
      .map((suffix) => `is_in_period_${suffix}, scope_past_events_count_${suffix}, scope_registrations_count_${suffix}`)
      .join(',\n        ');
    const inAnyPeriod = suffixes.map((suffix) => `is_in_period_${suffix}`).join(' OR ');

    const sql = `
      SELECT
        event_id,
        event_name,
        event_start_date,
        registrations_count AS registrations,
        event_registrations_goal AS goal,
        has_registrations_goal AS has_goal,
        is_registrations_goal_met AS goal_met,
        total_event_revenue_usd AS revenue_usd,
        pace_status,
        ${periodColumns}
      FROM ${PAST_EVENTS_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND (${inAnyPeriod})
      ORDER BY event_start_date DESC NULLS LAST, event_name ASC NULLS LAST, event_id ASC
      LIMIT ${HEALTH_METRICS_EVENTS_PAST_EVENT_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<PastEventRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: PAST_EVENTS_VIEW,
      operation: 'get_events_past',
      clientMessage: 'Past events are unavailable right now.',
    });

    // A read that succeeds with no rows is a measured zero in every period, not an unmeasured one.
    if (result.rows.length === 0) {
      return { periods: HEALTH_METRICS_L2_RANGES.map((range) => ({ range, eventCount: 0, registrations: 0 })), events: [] };
    }

    if (result.rows.length > HEALTH_METRICS_EVENTS_PAST_EVENT_CAP) {
      logger.warning(req, 'get_events_past', 'Past event rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_EVENTS_PAST_EVENT_CAP,
      });
    }

    const events = result.rows
      .slice(0, HEALTH_METRICS_EVENTS_PAST_EVENT_CAP)
      .map(mapPastEvent)
      .filter((event): event is HealthMetricsEventsPastEvent => event !== null);

    return { periods: HEALTH_METRICS_L2_RANGES.map((range) => mapPastPeriod(result.rows[0], range)), events };
  }
}

function mapPastEvent(row: PastEventRow): HealthMetricsEventsPastEvent | null {
  if (!row.EVENT_ID) return null;

  // The view's own flag decides "no goal", so a zero or negative goal never reads as missed.
  const hasGoal = row.HAS_GOAL === true;

  return {
    eventId: row.EVENT_ID,
    eventName: row.EVENT_NAME ?? row.EVENT_ID,
    eventStartDate: toIsoDate(row.EVENT_START_DATE),
    registrations: toNullableNumber(row.REGISTRATIONS),
    goal: hasGoal ? toNullableNumber(row.GOAL) : null,
    goalMet: hasGoal && row.GOAL_MET !== null ? row.GOAL_MET === true : null,
    revenueUsd: toNullableNumber(row.REVENUE_USD),
    paceStatus: hasGoal ? row.PACE_STATUS : null,
    ranges: HEALTH_METRICS_L2_RANGES.filter((range) => row[periodColumn('IS_IN_PERIOD', range)] === true),
  };
}

function mapPastPeriod(row: PastEventRow, range: HealthMetricsL2Range): HealthMetricsEventsPastPeriod {
  return {
    range,
    eventCount: toNullableNumber(row[periodColumn('SCOPE_PAST_EVENTS_COUNT', range)]),
    registrations: toNullableNumber(row[periodColumn('SCOPE_REGISTRATIONS_COUNT', range)]),
  };
}

/** Snowflake returns unquoted identifiers upper-cased. */
function periodColumn(prefix: string, range: HealthMetricsL2Range): string {
  return `${prefix}_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]}`.toUpperCase();
}

function mapForecastEvent(row: ForecastEventRow): HealthMetricsEventsForecastEvent | null {
  // An event with no id cannot be selected or deep-linked, so it is dropped rather than shown.
  if (!row.EVENT_ID) return null;

  return {
    eventId: row.EVENT_ID,
    eventName: row.EVENT_NAME ?? row.EVENT_ID,
    eventStartDate: toIsoDate(row.EVENT_START_DATE),
    forecastAvg: toNullableNumber(row.FORECAST_AVG),
    forecastLow: toNullableNumber(row.FORECAST_LOW),
    forecastHigh: toNullableNumber(row.FORECAST_HIGH),
    registrationsNow: toNullableNumber(row.REGISTRATIONS_NOW),
    priorYearSamePoint: toNullableNumber(row.PRIOR_YEAR_SAME_POINT),
    goal: toNullableNumber(row.GOAL),
    daysLeft: toDaysLeft(row.DAYS_LEFT),
    isNewEvent: row.IS_NEW_EVENT === true,
  };
}

function groupCurveRows(rows: ForecastCurveRow[]): HealthMetricsEventsForecastCurveSeries[] {
  const byFormat = new Map<string, HealthMetricsEventsForecastCurveSeries>();

  for (const row of rows) {
    if (row.DAYS_TO_EVENT === null) continue;

    const format = row.EVENT_REGISTRATION_TYPE ?? UNTYPED_FORMAT_LABEL;
    const series = byFormat.get(format) ?? { format, points: [] };
    // The model marks a measured day `known`; every later day is `predicted`.
    const known = row.PRED_TYPE === 'known';
    series.points.push({
      daysToEvent: Number(row.DAYS_TO_EVENT),
      actual: known ? toNullableNumber(row.FORECAST_AVG) : null,
      forecastAvg: known ? null : toNullableNumber(row.FORECAST_AVG),
      forecastLow: known ? null : toNullableNumber(row.FORECAST_LOW),
      forecastHigh: known ? null : toNullableNumber(row.FORECAST_HIGH),
      priorYear: toNullableNumber(row.PRIOR_YEAR),
    });
    byFormat.set(format, series);
  }

  const series = [...byFormat.values()];
  series.forEach(joinForecastToToday);
  return series;
}

/** Starts the forecast and its band at the last measured day, so the dashed line meets the solid one. */
function joinForecastToToday(series: HealthMetricsEventsForecastCurveSeries): void {
  const todayIndex = series.points.map((point) => point.actual !== null).lastIndexOf(true);
  if (todayIndex < 0 || todayIndex === series.points.length - 1) return;

  const today = series.points[todayIndex];

  today.forecastAvg = today.actual;
  today.forecastLow = today.actual;
  today.forecastHigh = today.actual;
}

/** The model counts days left from yesterday, negative before the event; the UI shows the count from today. */
function toDaysLeft(value: unknown): number | null {
  const daysLeft = toNullableNumber(value);
  return daysLeft === null ? null : Math.max(0, Math.abs(daysLeft) - 1);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
