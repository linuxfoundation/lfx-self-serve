// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPresence, getEnrollment, getCourses } = vi.hoisted(() => ({ getPresence: vi.fn(), getEnrollment: vi.fn(), getCourses: vi.fn() }));

vi.mock('../services/health-metrics-training.service', () => ({
  HealthMetricsTrainingService: class {
    public getPresence = getPresence;
    public getEnrollment = getEnrollment;
    public getCourses = getCourses;
  },
  isSupportedTrainingRange: (range: string) => range !== 'COMPLETED_YEAR_4',
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

import { HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

import { logger } from '../services/logger.service';

function call(
  queryParams: Record<string, string>,
  handler: 'getTrainingPresence' | 'getTrainingEnrollment' | 'getTrainingCourses' = 'getTrainingPresence'
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
  const period = {
    totals: { enrollments: 10, certifications: 2, revenueUsd: 500 },
    baseline: null,
    byType: [{ deliveryType: 'E-Learning', enrollments: 10, revenueUsd: 500 }],
  };
  const enrollment = {
    measured: true,
    periods: { YTD: period, COMPLETED_YEAR: period, COMPLETED_YEAR_2: period, COMPLETED_YEAR_3: period },
    trend: [{ year: 2025, enrollments: 10 }],
  };

  beforeEach(() => {
    vi.mocked(logger.success).mockClear();
    getEnrollment.mockReset();
    getEnrollment.mockResolvedValue(enrollment);
  });

  it('reads every period for the foundation and logs counts only', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' }, 'getTrainingEnrollment');
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getEnrollment).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(enrollment);
    expect(vi.mocked(logger.success).mock.calls[0]?.[3]).toEqual({
      foundation_slug: 'acme',
      measured: true,
      delivery_type_count: 1,
      trend_year_count: 1,
    });
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

describe('AnalyticsController.getTrainingCourses', () => {
  const courses = { rows: [], totalRecords: 3, scopeTotal: 7 };

  beforeEach(() => {
    vi.mocked(logger.success).mockClear();
    getCourses.mockReset();
    getCourses.mockResolvedValue(courses);
  });

  it('defaults the period, type, search and page, and logs counts only', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' }, 'getTrainingCourses');
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getCourses).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme', range: 'YTD', type: 'all', search: '', offset: 0, pageSize: 25 });
    expect(res.json).toHaveBeenCalledWith(courses);
    expect(vi.mocked(logger.success).mock.calls[0]?.[3]).toEqual({
      foundation_slug: 'acme',
      range: 'YTD',
      type: 'all',
      has_search: false,
      total_records: 3,
      scope_total: 7,
    });
  });

  it('passes the parsed query, with the search trimmed and capped', async () => {
    const search = `  ${'a'.repeat(HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH + 20)}  `;
    const { promise } = call(
      { foundationSlug: 'acme', range: 'COMPLETED_YEAR_2', type: 'certifications', search, offset: '50', pageSize: '25' },
      'getTrainingCourses'
    );
    await promise;

    expect(getCourses).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'COMPLETED_YEAR_2',
      type: 'certifications',
      search: 'a'.repeat(HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH),
      offset: 50,
      pageSize: 25,
    });
    expect(vi.mocked(logger.success).mock.calls[0]?.[3]).toMatchObject({ has_search: true });
    expect(JSON.stringify(vi.mocked(logger.success).mock.calls[0]?.[3])).not.toContain('aaa');
  });

  it.each([
    [{}, 'foundationSlug'],
    [{ foundationSlug: 'Acme Corp' }, 'foundationSlug'],
    [{ foundationSlug: 'acme', range: 'LAST_WEEK' }, 'range'],
    [{ foundationSlug: 'acme', range: 'COMPLETED_YEAR_4' }, 'range'],
    [{ foundationSlug: 'acme', type: 'bundles' }, 'type'],
  ])('rejects %o on %s', async (query, field) => {
    const { next, promise } = call(query as Record<string, string>, 'getTrainingCourses');
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error?.validationErrors?.[0]?.field).toBe(field);
    expect(getCourses).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getCourses.mockRejectedValue(failure);

    const { next, promise } = call({ foundationSlug: 'acme' }, 'getTrainingCourses');
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
