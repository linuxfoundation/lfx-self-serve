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

import {
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
  HEALTH_METRICS_EVENTS_PAST_EVENT_CAP,
  HEALTH_METRICS_L2_RANGES,
} from '@lfx-one/shared/constants';

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
    // The model counts days left from yesterday, negative before the event.
    DAYS_LEFT: -41,
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

function pastRow(overrides: Record<string, unknown> = {}) {
  return {
    EVENT_ID: 'past-1',
    EVENT_NAME: 'Acme Summit',
    EVENT_START_DATE: new Date('2026-03-10T00:00:00.000Z'),
    REGISTRATIONS: 900,
    GOAL: 1000,
    HAS_GOAL: true,
    GOAL_MET: false,
    REVENUE_USD: 0,
    PACE_STATUS: 'needs_attention',
    IS_IN_PERIOD_YTD: true,
    SCOPE_PAST_EVENTS_COUNT_YTD: 4,
    SCOPE_REGISTRATIONS_COUNT_YTD: 2400,
    IS_IN_PERIOD_LAST_COMPLETED_YEAR: false,
    SCOPE_PAST_EVENTS_COUNT_LAST_COMPLETED_YEAR: 7,
    SCOPE_REGISTRATIONS_COUNT_LAST_COMPLETED_YEAR: 5100,
    IS_IN_PERIOD_PREV_COMPLETED_YEAR: false,
    SCOPE_PAST_EVENTS_COUNT_PREV_COMPLETED_YEAR: 0,
    SCOPE_REGISTRATIONS_COUNT_PREV_COMPLETED_YEAR: 0,
    IS_IN_PERIOD_3RD_LAST_COMPLETED_YEAR: false,
    SCOPE_PAST_EVENTS_COUNT_3RD_LAST_COMPLETED_YEAR: null,
    SCOPE_REGISTRATIONS_COUNT_3RD_LAST_COMPLETED_YEAR: null,
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
    expect(sql).toContain('BOOLAND_AGG(is_new_event) OVER (PARTITION BY event_id)');
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

  it('counts days left from today, reading 0 on the event day and null when unmeasured', async () => {
    execute.mockResolvedValue({ rows: [eventRow({ EVENT_ID: 'today', DAYS_LEFT: -1 }), eventRow({ EVENT_ID: 'unknown', DAYS_LEFT: null })] });

    const { events } = await new HealthMetricsEventsService().getRegistrationForecast(req, { foundationSlug: 'acme' });

    expect(events.map((event) => event.daysLeft)).toEqual([0, null]);
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

describe('HealthMetricsEventsService.getPastEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [pastRow()] });
  });

  it('binds only the foundation, keeps events in some period, newest first, and reads one past the cap', async () => {
    await new HealthMetricsEventsService().getPastEvents(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('MARKETING_EVENT_PAST_EVENTS');
    expect(sql).toContain('is_all_projects = TRUE');
    expect(sql).toContain('is_in_period_3rd_last_completed_year OR is_in_period_prev_completed_year OR is_in_period_last_completed_year OR is_in_period_ytd');
    expect(sql).toContain('scope_registrations_count_3rd_last_completed_year');
    expect(sql).toContain('ORDER BY event_start_date DESC');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_EVENTS_PAST_EVENT_CAP + 1}`);
  });

  it('maps an event with the periods it closed in, keeping $0 revenue as measured', async () => {
    const { events } = await new HealthMetricsEventsService().getPastEvents(req, { foundationSlug: 'acme' });

    expect(events).toEqual([
      {
        eventId: 'past-1',
        eventName: 'Acme Summit',
        eventStartDate: '2026-03-10',
        registrations: 900,
        goal: 1000,
        goalMet: false,
        revenueUsd: 0,
        paceStatus: 'needs_attention',
        ranges: ['YTD'],
      },
    ]);
  });

  it('reads the period headers off the view, keeping a null header unmeasured', async () => {
    const { periods } = await new HealthMetricsEventsService().getPastEvents(req, { foundationSlug: 'acme' });

    expect(periods).toEqual([
      { range: 'COMPLETED_YEAR_3', eventCount: null, registrations: null },
      { range: 'COMPLETED_YEAR_2', eventCount: 0, registrations: 0 },
      { range: 'COMPLETED_YEAR', eventCount: 7, registrations: 5100 },
      { range: 'YTD', eventCount: 4, registrations: 2400 },
    ]);
  });

  it('clears goal, outcome and pace when the view flags no goal, and drops an event with no id', async () => {
    execute.mockResolvedValue({
      rows: [pastRow({ HAS_GOAL: false, GOAL: 0, GOAL_MET: false, PACE_STATUS: null, REVENUE_USD: null }), pastRow({ EVENT_ID: null })],
    });

    const { events } = await new HealthMetricsEventsService().getPastEvents(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ goal: null, goalMet: null, paceStatus: null, revenueUsd: null });
  });

  it('returns measured zeros for every period when the foundation has no closed events', async () => {
    execute.mockResolvedValue({ rows: [] });

    const past = await new HealthMetricsEventsService().getPastEvents(req, { foundationSlug: 'acme' });

    expect(past.events).toEqual([]);
    expect(past.periods).toEqual(HEALTH_METRICS_L2_RANGES.map((range) => ({ range, eventCount: 0, registrations: 0 })));
  });

  it('warns and truncates when the read hits the cap', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: HEALTH_METRICS_EVENTS_PAST_EVENT_CAP + 1 }, (_, i) => pastRow({ EVENT_ID: `past-${i}` })) });

    const { events } = await new HealthMetricsEventsService().getPastEvents(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(HEALTH_METRICS_EVENTS_PAST_EVENT_CAP);
    expect(warning).toHaveBeenCalledWith(req, 'get_events_past', expect.any(String), expect.objectContaining({ foundation_slug: 'acme' }));
  });
});

function glanceRow(overrides: Record<string, unknown> = {}) {
  return {
    UPCOMING_EVENTS_COUNT_CURRENT_YEAR: 3,
    REGISTRATIONS_COUNT_YTD: 2000,
    ATTENDEES_COUNT_YTD: 1500,
    ORGANIZATIONS_COUNT_YTD: 400,
    SPEAKERS_COUNT_YTD: 90,
    COUNTRIES_COUNT_YTD: 30,
    EVENTS_COUNT_YTD: 4,
    PAST_EVENTS_COUNT_YTD: 4,
    SHOW_UP_RATE_YTD: 0.75,
    REGISTRATIONS_CHANGE_PCT_YTD: -0.1,
    ATTENDEES_CHANGE_PCT_YTD: -0.35,
    ORGANIZATIONS_CHANGE_PCT_YTD: 0,
    SPEAKERS_CHANGE_PCT_YTD: null,
    COUNTRIES_CHANGE_PCT_YTD: 0.2,
    EVENTS_CHANGE_PCT_YTD: 0.5,
    SHOW_UP_RATE_CHANGE_PTS_YTD: -0.02,
    EVENTS_COUNT_LAST_COMPLETED_YEAR: 6,
    EVENTS_COUNT_PREV_COMPLETED_YEAR: 5,
    SHOW_UP_RATE_PREV_COMPLETED_YEAR: null,
    EVENTS_COUNT_3RD_LAST_COMPLETED_YEAR: 0,
    ...overrides,
  };
}

describe('HealthMetricsEventsService.getAtAGlance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [glanceRow()] });
  });

  it('binds only the foundation and reads its rollup row, asking for change columns only where the view has them', async () => {
    await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('MARKETING_EVENT_AT_A_GLANCE');
    expect(sql).toContain('is_all_projects = TRUE');
    expect(sql).toContain('show_up_rate_change_pts_last_completed_year');
    expect(sql).toContain('past_events_count_3rd_last_completed_year');
    expect(sql).not.toContain('change_pct_prev_completed_year');
    expect(sql).not.toContain('past_events_change_pct');
  });

  it('maps a compared period, keeping a null change not available and a zero change measured', async () => {
    const { periods, upcomingEvents, hasEvents } = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    expect(upcomingEvents).toBe(3);
    expect(hasEvents).toBe(true);
    expect(periods.find((period) => period.range === 'YTD')).toEqual({
      range: 'YTD',
      registrations: 2000,
      attendees: 1500,
      organizations: 400,
      speakers: 90,
      countries: 30,
      events: 4,
      pastEvents: 4,
      showUpRate: 0.75,
      changes: { registrations: -0.1, attendees: -0.35, organizations: 0, speakers: null, countries: 0.2, events: 0.5, showUpRatePts: -0.02 },
    });
  });

  it('leaves an uncompared period without changes and keeps its unmeasured show-up rate null', async () => {
    const { periods } = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });
    const period = periods.find((candidate) => candidate.range === 'COMPLETED_YEAR_2');

    expect(period).toMatchObject({ events: 5, showUpRate: null, changes: null });
    expect(periods.map((candidate) => candidate.range)).toEqual(HEALTH_METRICS_L2_RANGES);
  });

  it('reads a foundation with no rollup row and nothing upcoming as having held no event', async () => {
    execute.mockResolvedValue({ rows: [] });

    const glance = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    expect(glance.hasEvents).toBe(false);
    expect(glance.upcomingEvents).toBe(0);
    expect(glance.periods.map((period) => period.events)).toEqual([0, 0, 0, 0]);
  });

  it('reads only measured zeros everywhere as no events, never an unmeasured count', async () => {
    const none = { UPCOMING_EVENTS_COUNT_CURRENT_YEAR: 0, EVENTS_COUNT_YTD: 0, EVENTS_COUNT_LAST_COMPLETED_YEAR: 0, EVENTS_COUNT_PREV_COMPLETED_YEAR: 0 };
    execute
      .mockResolvedValueOnce({ rows: [glanceRow(none)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [glanceRow({ ...none, EVENTS_COUNT_3RD_LAST_COMPLETED_YEAR: null })] });
    const service = new HealthMetricsEventsService();

    expect((await service.getAtAGlance(req, { foundationSlug: 'acme' })).hasEvents).toBe(false);
    expect((await service.getAtAGlance(req, { foundationSlug: 'acme' })).hasEvents).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['no rollup row', { rows: [] }],
    [
      'an all-zero rollup row',
      {
        rows: [
          glanceRow({
            UPCOMING_EVENTS_COUNT_CURRENT_YEAR: 0,
            EVENTS_COUNT_YTD: 0,
            EVENTS_COUNT_LAST_COMPLETED_YEAR: 0,
            EVENTS_COUNT_PREV_COMPLETED_YEAR: 0,
            EVENTS_COUNT_3RD_LAST_COMPLETED_YEAR: 0,
          }),
        ],
      },
    ],
  ])('keeps the tab for %s when the forecast holds an event past this year', async (_case, rollup) => {
    execute.mockResolvedValueOnce(rollup).mockResolvedValueOnce({ rows: [{ HAS_EVENT: 1 }] });

    const glance = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[1];
    expect(glance.hasEvents).toBe(true);
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('MARKETING_EVENT_REGISTRATION_FORECAST');
    expect(sql).toContain('event_start_date >= CURRENT_DATE()');
  });

  it('skips the upcoming check for a foundation whose rollup already shows events', async () => {
    await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
