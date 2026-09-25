// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, isMissingObjectError, warning } = vi.hoisted(() => ({
  execute: vi.fn(),
  isMissingObjectError: vi.fn(() => false),
  warning: vi.fn(),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = isMissingObjectError;
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning, error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED, HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP, HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';

import { HealthMetricsEventsService, isSupportedEventsRange } from './health-metrics-events.service';

import type { Request } from 'express';

/** The logger only reads request metadata off this, so a bare cast is enough for the service call. */
const req = {} as Request;

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    EVENT_ID: 'evt-1',
    EVENT_NAME: 'Acme Summit',
    EVENT_START_DATE: new Date('2026-11-04T00:00:00.000Z'),
    FORECAST_AVG: 812.4,
    FORECAST_LOW: 700,
    FORECAST_HIGH: 900,
    REGISTRATIONS_NOW: 410,
    PRIOR_YEAR_SAME_POINT: 380,
    GOAL: 1000,
    // The model counts days left like `days_to_event`, negative before the event.
    DAYS_LEFT: -40,
    IS_NEW_EVENT: false,
    ...overrides,
  };
}

function curveRow(overrides: Record<string, unknown> = {}) {
  return {
    DAYS_TO_EVENT: -41,
    EVENT_REGISTRATION_TYPE: 'In Person',
    PRED_TYPE: 'known',
    FORECAST_AVG: 400,
    FORECAST_LOW: 400,
    FORECAST_HIGH: 400,
    PRIOR_YEAR: 370,
    ...overrides,
  };
}

describe('isSupportedEventsRange', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isSupportedEventsRange)).toBe(true);
    expect(isSupportedEventsRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedEventsRange('toString')).toBe(false);
  });
});

describe('HealthMetricsEventsService.getRegistrationForecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [eventRow()] });
  });

  it('binds only the foundation, keeps upcoming events, and reads one past the cap', async () => {
    await new HealthMetricsEventsService().getRegistrationForecast(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('is_all_projects = TRUE');
    expect(sql).toContain('event_start_date >= CURRENT_DATE()');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP + 1}`);
    expect(sql).toContain('QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id');
    expect(sql).not.toContain('GROUP BY');
  });

  it('maps a row to the event headline', async () => {
    const response = await new HealthMetricsEventsService().getRegistrationForecast(req, { foundationSlug: 'acme' });

    expect(response.events).toEqual([
      {
        eventId: 'evt-1',
        eventName: 'Acme Summit',
        eventStartDate: '2026-11-04',
        forecastAvg: 812.4,
        forecastLow: 700,
        forecastHigh: 900,
        registrationsNow: 410,
        priorYearSamePoint: 380,
        goal: 1000,
        daysLeft: 40,
        isNewEvent: false,
      },
    ]);
  });

  it('keeps nulls as unmeasured and drops an event with no id', async () => {
    execute.mockResolvedValue({ rows: [eventRow({ GOAL: null, FORECAST_AVG: null, EVENT_NAME: null, IS_NEW_EVENT: null }), eventRow({ EVENT_ID: null })] });

    const { events } = await new HealthMetricsEventsService().getRegistrationForecast(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventName: 'evt-1', goal: null, forecastAvg: null, isNewEvent: false });
  });

  it('warns and truncates when the read hits the cap', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP + 1 }, (_, i) => eventRow({ EVENT_ID: `evt-${i}` })) });

    const { events } = await new HealthMetricsEventsService().getRegistrationForecast(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP);
    expect(warning).toHaveBeenCalledWith(req, 'get_events_registration_forecast', expect.any(String), expect.objectContaining({ foundation_slug: 'acme' }));
  });
});

describe('HealthMetricsEventsService.getRegistrationForecastCurve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds foundation then event, and splits the curve by format without summing', async () => {
    execute.mockResolvedValue({
      rows: [curveRow(), curveRow({ EVENT_REGISTRATION_TYPE: 'Virtual', FORECAST_AVG: 90, PRIOR_YEAR: null })],
    });

    const curve = await new HealthMetricsEventsService().getRegistrationForecastCurve(req, { foundationSlug: 'acme', eventId: 'evt-1' });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme', 'evt-1']);
    expect(sql).toContain('pred_type');
    expect(sql).not.toContain('GROUP BY');
    expect(curve.eventId).toBe('evt-1');
    expect(curve.formats.map((series) => series.format)).toEqual(['In Person', 'Virtual']);
    expect(curve.formats[1].points[0]).toMatchObject({ actual: 90, priorYear: null });
  });

  it('draws known days as this year and predicted days as the forecast, joined at the last known day', async () => {
    execute.mockResolvedValue({
      rows: [
        curveRow({ DAYS_TO_EVENT: -41 }),
        curveRow({ DAYS_TO_EVENT: -40, FORECAST_AVG: 410, FORECAST_LOW: 410, FORECAST_HIGH: 410 }),
        curveRow({ DAYS_TO_EVENT: -20, PRED_TYPE: 'predicted', FORECAST_AVG: 600, FORECAST_LOW: 500, FORECAST_HIGH: 700 }),
      ],
    });

    const { formats } = await new HealthMetricsEventsService().getRegistrationForecastCurve(req, { foundationSlug: 'acme', eventId: 'evt-1' });

    expect(formats[0].points).toEqual([
      { daysToEvent: -41, actual: 400, forecastAvg: null, forecastLow: null, forecastHigh: null, priorYear: 370 },
      { daysToEvent: -40, actual: 410, forecastAvg: 410, forecastLow: 410, forecastHigh: 410, priorYear: 370 },
      { daysToEvent: -20, actual: null, forecastAvg: 600, forecastLow: 500, forecastHigh: 700, priorYear: 370 },
    ]);
  });

  it('returns the unmeasured curve when the event has no rows', async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(new HealthMetricsEventsService().getRegistrationForecastCurve(req, { foundationSlug: 'acme', eventId: 'evt-9' })).resolves.toBe(
      HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED
    );
  });
});
