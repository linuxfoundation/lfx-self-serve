// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGroupAttendance } = vi.hoisted(() => ({ getGroupAttendance: vi.fn() }));

vi.mock('../services/health-metrics-engagement.service', async () => {
  // The range guard is real — a rename of the view's period columns must fail this suite too.
  const actual = await vi.importActual<typeof import('../services/health-metrics-engagement.service')>('../services/health-metrics-engagement.service');
  return {
    isSupportedEngagementRange: actual.isSupportedEngagementRange,
    HealthMetricsEngagementService: class {
      public getGroupAttendance = getGroupAttendance;
    },
  };
});
// The controller constructs four unrelated domain services; none of them are exercised here.
vi.mock('../services/org-involvement.service', () => ({ OrgInvolvementService: class {} }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which re-exports Angular-dependent
// utils that cannot load in this server-only runtime. Delegate to the real implementation instead of
// stubbing, so a change to period resolution still fails this suite.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/marketing-impact.utils');
  return { resolvePeriodRange: actual.resolvePeriodRange };
});

import { HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

function call(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getEngagementGroupAttendance(req, res, next) };
}

/** The error handed to `next()`, which is how every failure leaves this controller. */
function rejectedField(next: NextFunction): string | undefined {
  const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
  return error?.validationErrors?.[0]?.field;
}

describe('AnalyticsController.getEngagementGroupAttendance', () => {
  beforeEach(() => {
    getGroupAttendance.mockReset();
    getGroupAttendance.mockResolvedValue(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
  });

  it('defaults the optional params and passes a fully-resolved query to the service', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getGroupAttendance).toHaveBeenCalledWith({ foundationSlug: 'acme', projectSlug: null, groupType: 'all', range: 'YTD', page: 1, size: 25 });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
  });

  it('forwards every supplied param, coercing page and size to numbers', async () => {
    const { promise } = call({ foundationSlug: 'acme', projectSlug: 'acme-core', groupType: 'wg', range: 'COMPLETED_YEAR', page: '3', size: '50' });
    await promise;

    expect(getGroupAttendance).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      projectSlug: 'acme-core',
      groupType: 'wg',
      range: 'COMPLETED_YEAR',
      page: 3,
      size: 50,
    });
  });

  it('requires a foundation slug, since that is what scopes an ED to their own data', async () => {
    const { next, promise } = call({});
    await promise;

    expect(getGroupAttendance).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it.each([
    ['foundationSlug', { foundationSlug: 'Acme Corp' }],
    ['projectSlug', { foundationSlug: 'acme', projectSlug: "core' OR 1=1" }],
  ])('rejects a %s that is not a slug', async (field, queryParams) => {
    const { next, promise } = call(queryParams);
    await promise;

    expect(getGroupAttendance).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe(field);
  });

  it('rejects a group type outside the four design cuts', async () => {
    const { next, promise } = call({ foundationSlug: 'acme', groupType: 'board' });
    await promise;

    expect(getGroupAttendance).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('groupType');
  });

  it('rejects an unknown range, and the one range this view has no columns for', async () => {
    const unknown = call({ foundationSlug: 'acme', range: 'LAST_WEEK' });
    await unknown.promise;
    expect(rejectedField(unknown.next)).toBe('range');

    const unsupported = call({ foundationSlug: 'acme', range: 'COMPLETED_YEAR_4' });
    await unsupported.promise;
    expect(rejectedField(unsupported.next)).toBe('range');

    expect(getGroupAttendance).not.toHaveBeenCalled();
  });

  it('hands a service failure to the error middleware rather than answering with a body', async () => {
    getGroupAttendance.mockRejectedValue(new Error('snowflake down'));

    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowflake down' }));
  });
});
