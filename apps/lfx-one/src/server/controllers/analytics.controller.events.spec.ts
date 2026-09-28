// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAtAGlance,
  getOrganizations,
  getPastEvents,
  getRegistrationForecast,
  getRegistrationForecastCurve,
  getRegistrationsGrowth,
  getRevenue,
  getSpeakers,
} = vi.hoisted(() => ({
  getAtAGlance: vi.fn(),
  getOrganizations: vi.fn(),
  getPastEvents: vi.fn(),
  getRegistrationForecast: vi.fn(),
  getRegistrationForecastCurve: vi.fn(),
  getRegistrationsGrowth: vi.fn(),
  getRevenue: vi.fn(),
  getSpeakers: vi.fn(),
}));

vi.mock('../services/health-metrics-events.service', () => ({
  HealthMetricsEventsService: class {
    public getRegistrationForecast = getRegistrationForecast;
    public getRegistrationForecastCurve = getRegistrationForecastCurve;
    public getPastEvents = getPastEvents;
    public getAtAGlance = getAtAGlance;
    public getRegistrationsGrowth = getRegistrationsGrowth;
    public getRevenue = getRevenue;
    public getSpeakers = getSpeakers;
    public getOrganizations = getOrganizations;
  },
  // Mirrors the service: the Events views carry no columns for the oldest range.
  isSupportedEventsRange: (range: string) => range !== 'COMPLETED_YEAR_4',
}));
// The controller constructs five unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/org-involvement.service', () => ({ OrgInvolvementService: class {} }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED,
  HEALTH_METRICS_EVENTS_PAST_UNMEASURED,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED,
  HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED,
  HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED,
} from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

type Handler =
  | 'getEventsRegistrationForecast'
  | 'getEventsRegistrationForecastCurve'
  | 'getEventsPast'
  | 'getEventsAtAGlance'
  | 'getEventsRegistrationsGrowth'
  | 'getEventsRevenue'
  | 'getEventsSpeakers'
  | 'getEventsOrganizations';

function call(handler: Handler, queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller[handler](req, res, next) };
}

/** The field named by the validation error handed to `next()`. */
function rejectedField(next: NextFunction): string | undefined {
  const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
  return error?.validationErrors?.[0]?.field;
}

describe('AnalyticsController.getEventsRegistrationForecast', () => {
  beforeEach(() => {
    getRegistrationForecast.mockReset();
    getRegistrationForecast.mockResolvedValue(HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call('getEventsRegistrationForecast', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getRegistrationForecast).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call('getEventsRegistrationForecast', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getRegistrationForecast).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getRegistrationForecast.mockRejectedValue(failure);

    const { next, promise } = call('getEventsRegistrationForecast', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getEventsRegistrationForecastCurve', () => {
  beforeEach(() => {
    getRegistrationForecastCurve.mockReset();
    getRegistrationForecastCurve.mockResolvedValue(HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED);
  });

  it('passes the foundation and event to the service', async () => {
    const { res, next, promise } = call('getEventsRegistrationForecastCurve', { foundationSlug: 'acme', eventId: 'evt_1-A' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getRegistrationForecastCurve).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme', eventId: 'evt_1-A' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED);
  });

  it('requires the foundation even when the event is given', async () => {
    const { next, promise } = call('getEventsRegistrationForecastCurve', { eventId: 'evt-1' });
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it.each<Record<string, string>>([
    { foundationSlug: 'acme' },
    { foundationSlug: 'acme', eventId: "evt'1" },
    { foundationSlug: 'acme', eventId: 'e'.repeat(65) },
  ])('rejects a missing or malformed event id (%o)', async (query) => {
    const { next, promise } = call('getEventsRegistrationForecastCurve', query);
    await promise;

    expect(rejectedField(next)).toBe('eventId');
    expect(getRegistrationForecastCurve).not.toHaveBeenCalled();
  });
});

describe('AnalyticsController.getEventsPast', () => {
  beforeEach(() => {
    getPastEvents.mockReset();
    getPastEvents.mockResolvedValue(HEALTH_METRICS_EVENTS_PAST_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call('getEventsPast', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getPastEvents).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_PAST_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call('getEventsPast', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getPastEvents).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getPastEvents.mockRejectedValue(failure);

    const { next, promise } = call('getEventsPast', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getEventsAtAGlance', () => {
  beforeEach(() => {
    getAtAGlance.mockReset();
    getAtAGlance.mockResolvedValue(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call('getEventsAtAGlance', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getAtAGlance).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call('getEventsAtAGlance', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getAtAGlance).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getAtAGlance.mockRejectedValue(failure);

    const { next, promise } = call('getEventsAtAGlance', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getEventsRegistrationsGrowth', () => {
  beforeEach(() => {
    getRegistrationsGrowth.mockReset();
    getRegistrationsGrowth.mockResolvedValue(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call('getEventsRegistrationsGrowth', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getRegistrationsGrowth).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call('getEventsRegistrationsGrowth', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getRegistrationsGrowth).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getRegistrationsGrowth.mockRejectedValue(failure);

    const { next, promise } = call('getEventsRegistrationsGrowth', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getEventsRevenue', () => {
  beforeEach(() => {
    getRevenue.mockReset();
    getRevenue.mockResolvedValue(HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call('getEventsRevenue', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getRevenue).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_REVENUE_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call('getEventsRevenue', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getRevenue).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getRevenue.mockRejectedValue(failure);

    const { next, promise } = call('getEventsRevenue', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getEventsSpeakers', () => {
  beforeEach(() => {
    getSpeakers.mockReset();
    getSpeakers.mockResolvedValue(HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call('getEventsSpeakers', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getSpeakers).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call('getEventsSpeakers', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getSpeakers).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getSpeakers.mockRejectedValue(failure);

    const { next, promise } = call('getEventsSpeakers', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getEventsOrganizations', () => {
  beforeEach(() => {
    getOrganizations.mockReset();
    getOrganizations.mockResolvedValue(HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED);
  });

  it('defaults the period, segment, search and page', async () => {
    const { res, next, promise } = call('getEventsOrganizations', { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getOrganizations).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'YTD',
      segment: 'all',
      search: '',
      offset: 0,
      pageSize: 25,
    });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_EVENTS_ORGANIZATIONS_UNMEASURED);
  });

  it('passes the parsed query, with the search trimmed and capped', async () => {
    const search = `  ${'a'.repeat(HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_SEARCH_LENGTH + 20)}  `;
    const { promise } = call('getEventsOrganizations', {
      foundationSlug: 'acme',
      range: 'COMPLETED_YEAR_2',
      segment: 'non-members',
      search,
      offset: '50',
      pageSize: '25',
    });
    await promise;

    expect(getOrganizations).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'COMPLETED_YEAR_2',
      segment: 'non-members',
      search: 'a'.repeat(HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_SEARCH_LENGTH),
      offset: 50,
      pageSize: 25,
    });
  });

  it.each([
    [{}, 'foundationSlug'],
    [{ foundationSlug: 'Acme Corp' }, 'foundationSlug'],
    [{ foundationSlug: 'acme', range: 'LAST_WEEK' }, 'range'],
    [{ foundationSlug: 'acme', range: 'COMPLETED_YEAR_4' }, 'range'],
    [{ foundationSlug: 'acme', segment: 'partners' }, 'segment'],
  ])('rejects %o on %s', async (query, field) => {
    const { next, promise } = call('getEventsOrganizations', query as Record<string, string>);
    await promise;

    expect(rejectedField(next)).toBe(field);
    expect(getOrganizations).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getOrganizations.mockRejectedValue(failure);

    const { next, promise } = call('getEventsOrganizations', { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
