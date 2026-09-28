// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, isMissingObjectError, loggerError, warning } = vi.hoisted(() => ({
  execute: vi.fn(),
  loggerError: vi.fn(),
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
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning, error: loggerError, debug: vi.fn(), info: vi.fn() },
}));
// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular and cannot load outside a test bed.
vi.mock('@lfx-one/shared/utils', () => ({}));

import {
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE,
  HEALTH_METRICS_EVENTS_PAST_EVENT_CAP,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP,
  HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP,
  HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS,
  HEALTH_METRICS_L2_RANGES,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

import { HealthMetricsEventsService, isSupportedEventsRange } from './health-metrics-events.service';

import type { HealthMetricsEventsOrganizationsQuery } from '@lfx-one/shared/interfaces';
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

  it('reads a foundation with no rollup row and no event ever held or to come as having none', async () => {
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [glanceRow({ ...none, EVENTS_COUNT_3RD_LAST_COMPLETED_YEAR: null })] });
    const service = new HealthMetricsEventsService();

    expect((await service.getAtAGlance(req, { foundationSlug: 'acme' })).hasEvents).toBe(false);
    expect((await service.getAtAGlance(req, { foundationSlug: 'acme' })).hasEvents).toBe(true);
    expect(execute).toHaveBeenCalledTimes(6);
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
  ])('keeps the tab for %s when an older event exists, without reading the forecast', async (_case, rollup) => {
    execute.mockResolvedValueOnce(rollup).mockResolvedValueOnce({ rows: [{ HAS_EVENT: 1 }] });

    const glance = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[1];
    expect(glance.hasEvents).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(binds).toEqual(['acme']);
    // Past events carry no period filter, so an event older than the four periods still counts.
    expect(sql).toMatch(/FROM ANALYTICS\.PLATINUM_LFX_ONE\.MARKETING_EVENT_PAST_EVENTS\s+WHERE foundation_slug = \?\s+AND is_all_projects = TRUE\s+LIMIT 1/);
  });

  it('keeps the tab when the only event is still to come, reading the forecast after past events', async () => {
    execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ HAS_EVENT: 1 }] });

    const glance = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[2];
    expect(glance.hasEvents).toBe(true);
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATION_FORECAST');
    expect(sql).toContain('event_start_date >= CURRENT_DATE()');
  });

  it('keeps the tab for a foundation with revenue rows but no event in the events views', async () => {
    execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ HAS_EVENT: 1 }] });

    const glance = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[3];
    expect(glance.hasEvents).toBe(true);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(binds).toEqual(['acme']);
    expect(sql).toMatch(/FROM ANALYTICS\.PLATINUM_LFX_ONE\.MARKETING_EVENT_REVENUE\s+WHERE foundation_slug = \?\s+LIMIT 1/);
  });

  it('keeps the tab when only the overview records event revenue, so the fallback headline shows', async () => {
    execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ HAS_EVENT: 1 }] });

    const glance = await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[4];
    expect(glance.hasEvents).toBe(true);
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.HEALTH_OVERVIEW_REVENUE');
    expect(sql).toContain("LOWER(revenue_domain) = 'events'");
    // The overview zero-fills every foundation, so a zero row must not keep the tab.
    expect(sql).toContain('revenue_usd_ytd <> 0');
    expect(sql).toContain('revenue_usd_3rd_last_completed_year <> 0');
  });

  it('logs a missing view under the one view the failed read names', async () => {
    const missing = new Error('Object does not exist');
    isMissingObjectError.mockReturnValueOnce(true);
    execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(missing);

    await expect(new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' })).rejects.toBe(missing);

    expect(loggerError).toHaveBeenCalledWith(req, 'get_events_at_a_glance_missing_object', expect.any(Number), missing, {
      snowflake_expected_missing_object: 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATION_FORECAST',
    });
  });

  it('skips the event check for a foundation whose rollup already shows events', async () => {
    await new HealthMetricsEventsService().getAtAGlance(req, { foundationSlug: 'acme' });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

function growthRow(overrides: Record<string, unknown> = {}) {
  return {
    YEAR: 2025,
    IS_PARTIAL_YEAR: false,
    TOTAL_REGISTRATIONS: 1200,
    IN_PERSON_REGISTRATIONS: 1000,
    VIRTUAL_REGISTRATIONS: 200,
    TOTAL_ATTENDEES: 900,
    IN_PERSON_ATTENDEES: 800,
    VIRTUAL_ATTENDEES: 0,
    ...overrides,
  };
}

describe('HealthMetricsEventsService.getRegistrationsGrowth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [growthRow()] });
  });

  it('binds only the foundation, reads the all-projects rollup oldest first, and one past the cap', async () => {
    await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('MARKETING_EVENT_REGISTRATIONS_GROWTH');
    expect(sql).toContain('is_all_projects = TRUE');
    expect(sql).toContain('ORDER BY year ASC');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP + 1}`);
  });

  it('maps a year, keeping a zero count as measured', async () => {
    const { years } = await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' });

    expect(years).toEqual([
      {
        year: 2025,
        isPartialYear: false,
        totalRegistrations: 1200,
        inPersonRegistrations: 1000,
        virtualRegistrations: 200,
        totalAttendees: 900,
        inPersonAttendees: 800,
        virtualAttendees: 0,
      },
    ]);
  });

  it('keeps a null count unmeasured, reads a null partial flag as complete, and drops a row with no year', async () => {
    execute.mockResolvedValue({ rows: [growthRow({ TOTAL_ATTENDEES: null, IS_PARTIAL_YEAR: null }), growthRow({ YEAR: null })] });

    const { years } = await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' });

    expect(years).toHaveLength(1);
    expect(years[0]).toMatchObject({ totalAttendees: null, isPartialYear: false });
  });

  it('drops and reports a year outside the plausible window, so one stray row cannot stretch the gap fill', async () => {
    const maxYear = new Date().getUTCFullYear() + HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD;
    execute.mockResolvedValue({
      rows: [
        growthRow({ YEAR: 0 }),
        growthRow({ YEAR: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR - 1 }),
        growthRow(),
        growthRow({ YEAR: maxYear + 1 }),
      ],
    });

    const { years } = await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' });

    expect(years.map((year) => year.year)).toEqual([2025]);
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_events_registrations_growth',
      expect.any(String),
      expect.objectContaining({ foundation_slug: 'acme', dropped_count: 3, min_year: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR, max_year: maxYear })
    );
  });

  it('keeps the first and last years of the plausible window without warning', async () => {
    const maxYear = new Date().getUTCFullYear() + HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD;
    execute.mockResolvedValue({ rows: [growthRow({ YEAR: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR }), growthRow({ YEAR: maxYear })] });

    const { years } = await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' });

    expect(years.map((year) => year.year)).toEqual([HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR, maxYear]);
    expect(warning).not.toHaveBeenCalled();
  });

  it('returns no years when the foundation has none', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' })).toEqual({ years: [] });
  });

  it('warns and truncates when the read hits the cap', async () => {
    execute.mockResolvedValue({
      rows: Array.from({ length: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP + 1 }, () => growthRow()),
    });

    const { years } = await new HealthMetricsEventsService().getRegistrationsGrowth(req, { foundationSlug: 'acme' });

    expect(years).toHaveLength(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP);
    expect(warning).toHaveBeenCalledWith(req, 'get_events_registrations_growth', expect.any(String), expect.objectContaining({ foundation_slug: 'acme' }));
  });
});

function revenueRow(overrides: Record<string, unknown> = {}) {
  return {
    EVENT_ID: 'rev-1',
    EVENT_NAME: 'Acme Summit',
    EVENT_START_DATE: new Date('2026-03-10T00:00:00.000Z'),
    REGISTRATION_REVENUE_USD: 180000,
    SPONSORSHIP_REVENUE_USD: 78000,
    REGISTRATION_REVENUE_GOAL: 200000,
    SPONSORSHIP_REVENUE_GOAL: 0,
    HAS_UNCONVERTED_REGISTRATION_REVENUE: false,
    HAS_UNCONVERTED_REVENUE_GOAL: false,
    FOUNDATION_TOTAL_REVENUE_USD_YTD: 258000,
    FOUNDATION_REGISTRATION_REVENUE_USD_YTD: 180000,
    FOUNDATION_SPONSORSHIP_REVENUE_USD_YTD: 78000,
    FOUNDATION_REGISTRATION_REVENUE_SHARE_PCT_YTD: 0.7,
    FOUNDATION_SPONSORSHIP_REVENUE_SHARE_PCT_YTD: 0.3,
    FOUNDATION_HAS_UNCONVERTED_REGISTRATION_REVENUE_YTD: false,
    FOUNDATION_TOTAL_REVENUE_CHANGE_PCT_YTD: 0.06,
    FOUNDATION_REGISTRATION_REVENUE_CHANGE_PCT_YTD: 0,
    FOUNDATION_SPONSORSHIP_REVENUE_CHANGE_PCT_YTD: null,
    IN_PERIOD_YTD: true,
    FOUNDATION_TOTAL_REVENUE_USD_LAST_COMPLETED_YEAR: 400000,
    FOUNDATION_REGISTRATION_REVENUE_USD_LAST_COMPLETED_YEAR: 300000,
    FOUNDATION_SPONSORSHIP_REVENUE_USD_LAST_COMPLETED_YEAR: 100000,
    FOUNDATION_REGISTRATION_REVENUE_SHARE_PCT_LAST_COMPLETED_YEAR: null,
    FOUNDATION_SPONSORSHIP_REVENUE_SHARE_PCT_LAST_COMPLETED_YEAR: null,
    FOUNDATION_HAS_UNCONVERTED_REGISTRATION_REVENUE_LAST_COMPLETED_YEAR: true,
    IN_PERIOD_LAST_COMPLETED_YEAR: false,
    FOUNDATION_TOTAL_REVENUE_USD_3RD_LAST_COMPLETED_YEAR: 0,
    FOUNDATION_REGISTRATION_REVENUE_USD_3RD_LAST_COMPLETED_YEAR: 0,
    FOUNDATION_SPONSORSHIP_REVENUE_USD_3RD_LAST_COMPLETED_YEAR: 0,
    FOUNDATION_HAS_UNCONVERTED_REGISTRATION_REVENUE_3RD_LAST_COMPLETED_YEAR: false,
    IN_PERIOD_3RD_LAST_COMPLETED_YEAR: false,
    ...overrides,
  };
}

describe('HealthMetricsEventsService.getRevenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [revenueRow()] });
  });

  it('binds only the foundation, sorts events outside every period last, and reads one past the cap', async () => {
    await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme']);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sql).toContain('MARKETING_EVENT_REVENUE');
    expect(sql).toContain("event_start_date >= DATE_TRUNC('YEAR', CURRENT_DATE()) AND event_start_date < CURRENT_DATE()) AS in_period_ytd");
    expect(sql).toContain(
      "event_start_date >= DATEADD(YEAR, -1, DATE_TRUNC('YEAR', CURRENT_DATE())) AND event_start_date < DATE_TRUNC('YEAR', CURRENT_DATE())) AS in_period_last_completed_year"
    );
    expect(sql).toContain('foundation_total_revenue_change_pct_prev_completed_year');
    expect(sql).not.toContain('change_pct_3rd_last_completed_year');
    expect(sql).toContain('ORDER BY IFF(');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP + 1}`);
  });

  it('maps an event with the periods it falls in, withholding a zero goal', async () => {
    const { events } = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(events).toEqual([
      {
        eventId: 'rev-1',
        eventName: 'Acme Summit',
        eventStartDate: '2026-03-10',
        registrationUsd: 180000,
        sponsorshipUsd: 78000,
        registrationGoal: 200000,
        sponsorshipGoal: null,
        hasUnconverted: false,
        registrationGoalWithheld: false,
        sponsorshipGoalWithheld: false,
        ranges: ['YTD'],
      },
    ]);
  });

  it('reads each period headline off the first row, with changes only for the compared periods', async () => {
    const { periods } = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(periods.find((period) => period.range === 'YTD')).toEqual({
      range: 'YTD',
      totalUsd: 258000,
      registrationUsd: 180000,
      sponsorshipUsd: 78000,
      registrationShare: 0.7,
      sponsorshipShare: 0.3,
      hasUnconverted: false,
      changes: { total: 0.06, registration: 0, sponsorship: null },
    });
    expect(periods.find((period) => period.range === 'COMPLETED_YEAR')).toMatchObject({ registrationShare: null, hasUnconverted: true });
    expect(periods.find((period) => period.range === 'COMPLETED_YEAR_3')).toMatchObject({ totalUsd: 0, changes: null });
  });

  it('withholds each goal set in local currency apart from the revenue, dropping one outside every period or with no id', async () => {
    execute.mockResolvedValue({
      rows: [
        revenueRow({ HAS_UNCONVERTED_REVENUE_GOAL: true, SPONSORSHIP_REVENUE_GOAL: 60000 }),
        revenueRow({ EVENT_ID: 'rev-3', HAS_UNCONVERTED_REVENUE_GOAL: true, SPONSORSHIP_REVENUE_GOAL: null }),
        revenueRow({ EVENT_ID: 'rev-2', IN_PERIOD_YTD: false }),
        revenueRow({ EVENT_ID: null }),
      ],
    });

    const { events } = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventId: 'rev-1',
      registrationGoal: null,
      sponsorshipGoal: null,
      hasUnconverted: false,
      registrationGoalWithheld: true,
      sponsorshipGoalWithheld: true,
    });
    expect(events[1]).toMatchObject({ eventId: 'rev-3', registrationGoalWithheld: true, sponsorshipGoalWithheld: false });
  });

  it('keeps the headline when no event falls in any period', async () => {
    execute.mockResolvedValue({ rows: [revenueRow({ IN_PERIOD_YTD: false })] });

    const revenue = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(revenue.events).toEqual([]);
    expect(revenue.eventsMeasured).toBe(true);
    expect(revenue.periods.find((period) => period.range === 'YTD')?.totalUsd).toBe(258000);
  });

  it('falls back to the overview total alone when the revenue view has no row for the foundation', async () => {
    execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ REVENUE_USD_YTD: 1200, REVENUE_USD_LAST_COMPLETED_YEAR: null, REVENUE_USD_PREV_COMPLETED_YEAR: 0, REVENUE_USD_3RD_LAST_COMPLETED_YEAR: 5 }],
    });

    const revenue = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[1];
    expect(sql).toContain('HEALTH_OVERVIEW_REVENUE');
    expect(sql).toContain("LOWER(revenue_domain) = 'events'");
    expect(binds).toEqual(['acme']);
    expect(revenue.events).toEqual([]);
    expect(revenue.eventsMeasured).toBe(false);
    expect(revenue.periods.find((period) => period.range === 'YTD')).toEqual({
      range: 'YTD',
      totalUsd: 1200,
      registrationUsd: null,
      sponsorshipUsd: null,
      registrationShare: null,
      sponsorshipShare: null,
      hasUnconverted: false,
      changes: null,
    });
    expect(revenue.periods.map((period) => period.range).sort()).toEqual(['COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'YTD']);
  });

  it('reads a foundation with no row in either view as unmeasured, never as zero revenue', async () => {
    execute.mockResolvedValue({ rows: [] });

    const revenue = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(revenue).toEqual({ periods: [], events: [], eventsMeasured: false });
  });

  it('warns and truncates when the read hits the cap', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP + 1 }, (_, i) => revenueRow({ EVENT_ID: `rev-${i}` })) });

    const { events } = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP);
    expect(warning).toHaveBeenCalledWith(req, 'get_events_revenue', expect.any(String), expect.objectContaining({ foundation_slug: 'acme' }));
  });

  it('warns when the in-period row past the cap has no event id', async () => {
    const rows = Array.from({ length: HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP + 1 }, (_, i) =>
      revenueRow({ EVENT_ID: i < HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP ? `rev-${i}` : null })
    );
    execute.mockResolvedValue({ rows });

    await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(warning).toHaveBeenCalledWith(req, 'get_events_revenue', expect.any(String), expect.objectContaining({ foundation_slug: 'acme' }));
  });

  it('does not warn when only events outside every period fall past the cap', async () => {
    const rows = Array.from({ length: HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP + 1 }, (_, i) =>
      revenueRow({ EVENT_ID: `rev-${i}`, IN_PERIOD_YTD: i < HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP })
    );
    execute.mockResolvedValue({ rows });

    const { events } = await new HealthMetricsEventsService().getRevenue(req, { foundationSlug: 'acme' });

    expect(events).toHaveLength(HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP);
    expect(warning).not.toHaveBeenCalledWith(req, 'get_events_revenue', expect.any(String), expect.anything());
  });
});

describe('HealthMetricsEventsService.getSpeakers', () => {
  function drilldownRow(overrides: Record<string, unknown> = {}) {
    return {
      ACCOUNT_ID: null,
      ACCOUNT_NAME: null,
      IS_ALL_ORGANIZATIONS: true,
      IS_UNAFFILIATED_ORGANIZATION: false,
      PROPOSALS_SUBMITTED_COUNT_YTD: 6283,
      PROPOSALS_ACCEPTED_COUNT_YTD: 348,
      PROPOSALS_IN_REVIEW_COUNT_YTD: 3447,
      PROPOSALS_DECLINED_COUNT_YTD: 2488,
      SPEAKERS_COUNT_YTD: 3559,
      ACCEPTANCE_RATE_YTD: '0.055388',
      SORT_RANK_YTD: null,
      SPEAKERS_COUNT_CHANGE_PCT_YTD: '-0.143029',
      PROPOSALS_SUBMITTED_COUNT_3RD_LAST_COMPLETED_YEAR: 8017,
      ...overrides,
    };
  }

  function proposalRow(overrides: Record<string, unknown> = {}) {
    return {
      PROPOSAL_KEY: 'p-1',
      PERIOD: 'YTD',
      ACCOUNT_NAME: 'Acme Motors',
      JOB_TITLE: 'Staff Engineer',
      EVENT_NAME: 'Acme Summit',
      SESSION_TITLE: 'A talk',
      SUBMISSION_DATE: new Date('2026-03-10T00:00:00.000Z'),
      SUBMISSION_STATUS_ORIGINAL: 'Waitlisted',
      PROPOSAL_STATUS_GROUP: 'In review',
      IS_UNAFFILIATED_PROPOSAL: false,
      ...overrides,
    };
  }

  function mockReads(drilldown: Record<string, unknown>[], proposals: Record<string, unknown>[]) {
    execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('ORG_DRILLDOWN') ? drilldown : proposals }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReads(
      [
        drilldownRow(),
        drilldownRow({ IS_ALL_ORGANIZATIONS: false, IS_UNAFFILIATED_ORGANIZATION: true, PROPOSALS_SUBMITTED_COUNT_YTD: 1351 }),
        drilldownRow({ IS_ALL_ORGANIZATIONS: false, ACCOUNT_ID: 'org-a', ACCOUNT_NAME: 'Acme Motors', PROPOSALS_SUBMITTED_COUNT_YTD: 324, SORT_RANK_YTD: 1 }),
        drilldownRow({ IS_ALL_ORGANIZATIONS: false, ACCOUNT_ID: 'org-b', ACCOUNT_NAME: 'Beta Coastal', SORT_RANK_YTD: 9, SORT_RANK_LAST_COMPLETED_YEAR: 4 }),
      ],
      [proposalRow()]
    );
  });

  it('binds only the foundation in both reads and keeps the latest few per period and tab', async () => {
    await new HealthMetricsEventsService().getSpeakers(req, { foundationSlug: 'acme' });

    expect(execute).toHaveBeenCalledTimes(2);
    const [drilldownSql, drilldownBinds] = execute.mock.calls.find(([sql]) => sql.includes('ORG_DRILLDOWN')) ?? [];
    const [listSql, listBinds] = execute.mock.calls.find(([sql]) => sql.includes('PROPOSALS_LIST')) ?? [];
    expect(drilldownBinds).toEqual(['acme']);
    expect(listBinds).toEqual(['acme']);
    expect(drilldownSql).toContain('sort_rank_3rd_last_completed_year <= 5');
    expect(drilldownSql).toContain('speakers_count_change_pct_last_completed_year');
    expect(drilldownSql).not.toContain('change_pct_prev_completed_year');
    expect(listSql).toContain("WHEN is_ytd THEN 'YTD'");
    expect(listSql).toContain("proposal_status_group IN ('Accepted', 'In review')");
    expect(listSql).toContain(`<= ${HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS}`);
    expect(listSql).toContain('ORDER BY TO_DATE(submission_date) DESC NULLS LAST, proposal_key');
    // The speaker is shown by job title; the name never leaves the warehouse.
    expect(listSql).toContain('job_title');
    expect(listSql).not.toContain('speaker_name');
  });

  it('maps the scope row per period, with the speakers change only where compared', async () => {
    const { periods } = await new HealthMetricsEventsService().getSpeakers(req, { foundationSlug: 'acme' });

    expect(periods).toHaveLength(HEALTH_METRICS_L2_RANGES.length);
    expect(periods.find((period) => period.range === 'YTD')).toEqual({
      range: 'YTD',
      submitted: 6283,
      accepted: 348,
      inReview: 3447,
      declined: 2488,
      speakers: 3559,
      acceptanceRate: 0.055388,
      changes: { speakers: -0.143029 },
    });
    expect(periods.find((period) => period.range === 'COMPLETED_YEAR_3')).toMatchObject({ submitted: 8017, changes: null });
  });

  it('keeps organizations to the periods they rank in and the unaffiliated row apart', async () => {
    const { organizations, unaffiliated } = await new HealthMetricsEventsService().getSpeakers(req, { foundationSlug: 'acme' });

    expect(organizations).toEqual([
      { accountId: 'org-a', accountName: 'Acme Motors', periods: [{ range: 'YTD', rank: 1, submitted: 324 }] },
      { accountId: 'org-b', accountName: 'Beta Coastal', periods: [{ range: 'COMPLETED_YEAR', rank: 4, submitted: null }] },
    ]);
    expect(unaffiliated.find((entry) => entry.range === 'YTD')).toEqual({ range: 'YTD', submitted: 1351 });
  });

  it('maps a proposal with its status group and drops one with no key or period', async () => {
    mockReads([drilldownRow()], [proposalRow(), proposalRow({ PROPOSAL_KEY: null }), proposalRow({ PROPOSAL_KEY: 'p-2', PERIOD: null })]);

    const { proposals } = await new HealthMetricsEventsService().getSpeakers(req, { foundationSlug: 'acme' });
    const [listSql] = execute.mock.calls.find(([sql]) => sql.includes('PROPOSALS_LIST')) ?? [];

    // Filtered before the cap, so a key-less row cannot crowd a real one out of the list.
    expect(listSql.indexOf('AND proposal_key IS NOT NULL')).toBeGreaterThan(-1);
    expect(listSql.indexOf('AND proposal_key IS NOT NULL')).toBeLessThan(listSql.indexOf('QUALIFY'));

    expect(proposals).toEqual([
      {
        proposalKey: 'p-1',
        range: 'YTD',
        jobTitle: 'Staff Engineer',
        organizationName: 'Acme Motors',
        unaffiliated: false,
        eventName: 'Acme Summit',
        sessionTitle: 'A talk',
        submissionDate: '2026-03-10',
        status: 'Waitlisted',
        statusGroup: 'in-review',
      },
    ]);
  });

  it('reads a blank job title as none', async () => {
    mockReads([drilldownRow()], [proposalRow({ JOB_TITLE: '  ' }), proposalRow({ PROPOSAL_KEY: 'p-2', JOB_TITLE: null })]);

    const { proposals } = await new HealthMetricsEventsService().getSpeakers(req, { foundationSlug: 'acme' });

    expect(proposals.map((proposal) => proposal.jobTitle)).toEqual([null, null]);
  });

  it('returns no periods when the foundation has no scope row', async () => {
    mockReads([], []);

    await expect(new HealthMetricsEventsService().getSpeakers(req, { foundationSlug: 'acme' })).resolves.toEqual({
      periods: [],
      organizations: [],
      unaffiliated: [],
      proposals: [],
    });
  });
});

describe('HealthMetricsEventsService.getOrganizations', () => {
  const baseQuery: HealthMetricsEventsOrganizationsQuery = { foundationSlug: 'acme', range: 'YTD', segment: 'all', search: '', offset: 0, pageSize: 25 };

  function organizationRow(overrides: Record<string, unknown> = {}) {
    return {
      SCOPE_TOTAL: 120,
      TOTAL_RECORDS: 40,
      IS_PAGE_ROW: true,
      ACCOUNT_ID: '0014100000AcmeAAAA',
      ACCOUNT_NAME: 'Acme Motors',
      LOGO_URL: 'https://acme-motors.example/logo.png',
      IS_MEMBER: true,
      REGISTRATIONS_COUNT: 420,
      REGISTRATIONS_SHARE: '0.5',
      SPONSORSHIP_REVENUE: 150000,
      PROPOSALS_COUNT: 12,
      SPEAKERS_COUNT: 4,
      EVENTS_COUNT: 3,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [organizationRow()] });
  });

  it('reads the period columns of the active all-projects rows for the foundation', async () => {
    await new HealthMetricsEventsService().getOrganizations(req, { ...baseQuery, range: 'COMPLETED_YEAR_3' });

    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain('ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATIONS_ORG_OVERVIEW');
    expect(sql).toContain('registrations_count_3rd_last_completed_year AS registrations_count');
    expect(sql).toContain('registrations_share_of_scope_max_3rd_last_completed_year AS registrations_share');
    expect(sql).toContain('sort_rank_3rd_last_completed_year AS sort_rank');
    expect(sql).toContain('AND is_all_projects = TRUE');
    // The mapper drops a row with no account id, so the counts must not include it either.
    expect(sql).toContain('AND account_id IS NOT NULL');
    expect(sql).toContain('events_count_3rd_last_completed_year > 0');
    expect(sql).toContain('ORDER BY sort_rank ASC NULLS LAST, account_id ASC');
    expect(sql).not.toContain('ILIKE');
    expect(binds).toEqual(['acme']);
  });

  it('binds the search once, with its wildcards escaped', async () => {
    await new HealthMetricsEventsService().getOrganizations(req, { ...baseQuery, search: '50%_off' });

    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain("account_name ILIKE ? ESCAPE '!'");
    expect((sql as string).match(/\?/g)).toHaveLength(binds.length);
    expect(binds).toEqual(['acme', '%50!%!_off%']);
  });

  it.each([
    ['members', 'is_member = TRUE'],
    ['non-members', 'COALESCE(is_member, FALSE) = FALSE'],
  ] as const)('filters the %s segment', async (segment, predicate) => {
    await new HealthMetricsEventsService().getOrganizations(req, { ...baseQuery, segment });

    expect(execute.mock.calls[0][0]).toContain(`WHERE ${predicate}`);
  });

  it('clamps the page size and offset it interpolates', async () => {
    await new HealthMetricsEventsService().getOrganizations(req, { ...baseQuery, pageSize: 5000, offset: Number.MAX_SAFE_INTEGER });

    const maxOffset = MAX_SNOWFLAKE_PAGINATION_PAGE * HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE;
    expect(execute.mock.calls[0][0]).toContain(`LIMIT ${HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE} OFFSET ${maxOffset}`);
  });

  it('maps the page rows and reads the totals off the first row', async () => {
    execute.mockResolvedValue({
      rows: [organizationRow(), organizationRow({ ACCOUNT_ID: 'org-b', ACCOUNT_NAME: null, LOGO_URL: '', IS_MEMBER: null, SPONSORSHIP_REVENUE: null })],
    });

    await expect(new HealthMetricsEventsService().getOrganizations(req, baseQuery)).resolves.toEqual({
      rows: [
        {
          accountId: '0014100000AcmeAAAA',
          accountName: 'Acme Motors',
          logoUrl: 'https://acme-motors.example/logo.png',
          isMember: true,
          registrations: 420,
          registrationsShare: 0.5,
          sponsorshipUsd: 150000,
          proposals: 12,
          speakers: 4,
          events: 3,
        },
        {
          accountId: 'org-b',
          accountName: 'org-b',
          logoUrl: null,
          isMember: false,
          registrations: 420,
          registrationsShare: 0.5,
          sponsorshipUsd: null,
          proposals: 12,
          speakers: 4,
          events: 3,
        },
      ],
      totalRecords: 40,
      scopeTotal: 120,
    });
  });

  it('keeps the totals when the page is past the end', async () => {
    execute.mockResolvedValue({ rows: [organizationRow({ IS_PAGE_ROW: null, ACCOUNT_ID: null })] });

    await expect(new HealthMetricsEventsService().getOrganizations(req, { ...baseQuery, offset: 500 })).resolves.toEqual({
      rows: [],
      totalRecords: 40,
      scopeTotal: 120,
    });
  });

  it('drops a page row without an account id', async () => {
    execute.mockResolvedValue({ rows: [organizationRow({ ACCOUNT_ID: null })] });

    const { rows } = await new HealthMetricsEventsService().getOrganizations(req, baseQuery);

    expect(rows).toEqual([]);
  });
});
