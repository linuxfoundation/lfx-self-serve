// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTiers } = vi.hoisted(() => ({ getTiers: vi.fn() }));

vi.mock('../services/health-metrics-members.service', () => ({
  HealthMetricsMembersService: class {
    public getTiers = getTiers;
  },
}));
// The controller constructs six unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {}, isSupportedEventsRange: () => true }));
vi.mock('../services/org-involvement.service', () => ({ OrgInvolvementService: class {} }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import { HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

function call(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getMembersTiers(req, res, next) };
}

describe('AnalyticsController.getMembersTiers', () => {
  beforeEach(() => {
    getTiers.mockReset();
    getTiers.mockResolvedValue(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getTiers).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call(query as Record<string, string>);
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error?.validationErrors?.[0]?.field).toBe('foundationSlug');
    expect(getTiers).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getTiers.mockRejectedValue(failure);

    const { next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
