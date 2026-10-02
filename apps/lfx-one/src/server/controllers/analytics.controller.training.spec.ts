// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPresence, getEnrollment } = vi.hoisted(() => ({ getPresence: vi.fn(), getEnrollment: vi.fn() }));

vi.mock('../services/health-metrics-training.service', () => ({
  HealthMetricsTrainingService: class {
    public getPresence = getPresence;
    public getEnrollment = getEnrollment;
  },
  isSupportedTrainingRange: (range: string) => ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'].includes(range),
}));
// The controller constructs eight unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {}, isSupportedEventsRange: () => true }));
vi.mock('../services/health-metrics-members.service', () => ({ HealthMetricsMembersService: class {}, isSupportedMembersRange: () => true }));
vi.mock('../services/health-metrics-non-members.service', () => ({ HealthMetricsNonMembersService: class {}, isSupportedNonMembersRange: () => true }));
vi.mock('../services/org-involvement.service', () => ({ OrgInvolvementService: class {} }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

import { logger } from '../services/logger.service';

function call(
  queryParams: Record<string, string>,
  handler: 'getTrainingPresence' | 'getTrainingEnrollment' = 'getTrainingPresence'
): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller[handler](req, res, next) };
}

describe('AnalyticsController.getTrainingPresence', () => {
  beforeEach(() => {
    vi.mocked(logger.success).mockClear();
    getPresence.mockReset();
    getPresence.mockResolvedValue({ hasProgramme: true });
  });

  it('reads the foundation and returns the response', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getPresence).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith({ hasProgramme: true });
    expect(vi.mocked(logger.success).mock.calls[0]?.[3]).toEqual({ foundation_slug: 'acme', has_programme: true });
  });

  it.each([[{}], [{ foundationSlug: '' }], [{ foundationSlug: 'Acme Corp' }]])('rejects %o on foundationSlug', async (query) => {
    const { next, promise } = call(query);
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error?.validationErrors?.[0]?.field).toBe('foundationSlug');
    expect(getPresence).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getPresence.mockRejectedValue(failure);

    const { next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getTrainingEnrollment', () => {
  const enrollment = {
    measured: true,
    totals: { enrollments: 10, certifications: 2, revenueUsd: 500 },
    baseline: null,
    byType: [{ deliveryType: 'E-Learning', enrollments: 10, revenueUsd: 500 }],
    trend: [{ year: 2025, enrollments: 10 }],
  };

  beforeEach(() => {
    vi.mocked(logger.success).mockClear();
    getEnrollment.mockReset();
    getEnrollment.mockResolvedValue(enrollment);
  });

  it('defaults the range to YTD and logs counts only', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' }, 'getTrainingEnrollment');
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getEnrollment).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme', range: 'YTD' });
    expect(res.json).toHaveBeenCalledWith(enrollment);
    expect(vi.mocked(logger.success).mock.calls[0]?.[3]).toEqual({
      foundation_slug: 'acme',
      range: 'YTD',
      measured: true,
      delivery_type_count: 1,
      trend_year_count: 1,
    });
  });

  it('passes a supported range through', async () => {
    const { promise } = call({ foundationSlug: 'acme', range: 'COMPLETED_YEAR_3' }, 'getTrainingEnrollment');
    await promise;

    expect(getEnrollment).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme', range: 'COMPLETED_YEAR_3' });
  });

  it.each([['COMPLETED_YEAR_4'], ['ALL_TIME']])('rejects the %s range', async (range) => {
    const { next, promise } = call({ foundationSlug: 'acme', range }, 'getTrainingEnrollment');
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(getEnrollment).not.toHaveBeenCalled();
  });

  it('rejects a malformed foundationSlug', async () => {
    const { next, promise } = call({ foundationSlug: 'Acme Corp' }, 'getTrainingEnrollment');
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error?.validationErrors?.[0]?.field).toBe('foundationSlug');
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getEnrollment.mockRejectedValue(failure);

    const { next, promise } = call({ foundationSlug: 'acme' }, 'getTrainingEnrollment');
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
