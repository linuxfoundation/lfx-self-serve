// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRegistrationForecast, getRegistrationForecastCurve } = vi.hoisted(() => ({
  getRegistrationForecast: vi.fn(),
  getRegistrationForecastCurve: vi.fn(),
}));

vi.mock('../services/health-metrics-events.service', () => ({
  HealthMetricsEventsService: class {
    public getRegistrationForecast = getRegistrationForecast;
    public getRegistrationForecastCurve = getRegistrationForecastCurve;
  },
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

import { HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED, HEALTH_METRICS_EVENTS_FORECAST_UNMEASURED } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

type Handler = 'getEventsRegistrationForecast' | 'getEventsRegistrationForecastCurve';

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
