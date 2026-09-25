// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
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
  HealthMetricsL2Range,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const REGISTRATION_FORECAST_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATION_FORECAST';

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
  ACTUAL: number | null;
  FORECAST_AVG: number | null;
  FORECAST_LOW: number | null;
  FORECAST_HIGH: number | null;
  PRIOR_YEAR: number | null;
}

/** The Events tab's view reads, one method per section, each through `executeSnowflakeViewRead`. */
export class HealthMetricsEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Every upcoming event's event-wide headline. The headline columns repeat on every curve row, so
   * one group per event reads them once; the model is a snapshot of now, so no period applies.
   */
  public async getRegistrationForecast(req: Request, query: HealthMetricsEventsForecastQuery): Promise<HealthMetricsEventsForecast> {
    // The start-date filter keeps an event whose day has passed out even before the model drops it.
    const sql = `
      SELECT
        event_id,
        event_name,
        event_start_date,
        MAX(event_forecast_registrations_avg) AS forecast_avg,
        MAX(event_forecast_registrations_low) AS forecast_low,
        MAX(event_forecast_registrations_high) AS forecast_high,
        MAX(final_current_cumulative_registrations) AS registrations_now,
        MAX(event_registrations_prior_year_same_point) AS prior_year_same_point,
        MAX(event_registrations_goal) AS goal,
        MAX(days_left) AS days_left,
        BOOLOR_AGG(is_new_event) AS is_new_event
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_start_date >= CURRENT_DATE()
      GROUP BY event_id, event_name, event_start_date
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
    // `days_to_event` counts up to 0 on the event day, so today is `-days_left`: measured at or
    // before it, projected from it on. MAX deduplicates rows that repeat one day's values.
    const sql = `
      SELECT
        days_to_event,
        event_registration_type,
        MAX(CASE WHEN days_to_event <= -days_left THEN cumulative_avg_predicted_registrations END) AS actual,
        MAX(CASE WHEN days_to_event >= -days_left THEN cumulative_avg_predicted_registrations END) AS forecast_avg,
        MAX(CASE WHEN days_to_event >= -days_left THEN cumulative_low_predicted_registrations END) AS forecast_low,
        MAX(CASE WHEN days_to_event >= -days_left THEN cumulative_high_predicted_registrations END) AS forecast_high,
        MAX(prior_event_cumulative_registrations) AS prior_year
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_id = ?
        AND event_start_date >= CURRENT_DATE()
      GROUP BY days_to_event, event_registration_type
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
    daysLeft: toNullableNumber(row.DAYS_LEFT),
    isNewEvent: row.IS_NEW_EVENT === true,
  };
}

function groupCurveRows(rows: ForecastCurveRow[]): HealthMetricsEventsForecastCurveSeries[] {
  const byFormat = new Map<string, HealthMetricsEventsForecastCurveSeries>();

  for (const row of rows) {
    if (row.DAYS_TO_EVENT === null) continue;

    const format = row.EVENT_REGISTRATION_TYPE ?? UNTYPED_FORMAT_LABEL;
    const series = byFormat.get(format) ?? { format, points: [] };
    series.points.push({
      daysToEvent: Number(row.DAYS_TO_EVENT),
      actual: toNullableNumber(row.ACTUAL),
      forecastAvg: toNullableNumber(row.FORECAST_AVG),
      forecastLow: toNullableNumber(row.FORECAST_LOW),
      forecastHigh: toNullableNumber(row.FORECAST_HIGH),
      priorYear: toNullableNumber(row.PRIOR_YEAR),
    });
    byFormat.set(format, series);
  }

  return [...byFormat.values()];
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
