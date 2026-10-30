// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A synthetic id in the Salesforce 18-char format the controller requires.
const ACCOUNT = '001000000000000AAA';

const { getContributorsMonthly } = vi.hoisted(() => ({ getContributorsMonthly: vi.fn() }));

vi.mock('../services/org-involvement.service', () => ({
  OrgInvolvementService: class {
    public getContributorsMonthly = getContributorsMonthly;
  },
}));
// The controller constructs unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-overview.service', () => ({ HealthMetricsOverviewService: class {} }));
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {}, isSupportedEventsRange: () => true }));
vi.mock('../services/health-metrics-members.service', () => ({ HealthMetricsMembersService: class {}, isSupportedMembersRange: () => true }));
vi.mock('../services/health-metrics-non-members.service', () => ({ HealthMetricsNonMembersService: class {}, isSupportedNonMembersRange: () => true }));
vi.mock('../services/health-metrics-training.service', () => ({ HealthMetricsTrainingService: class {}, isSupportedTrainingRange: () => true }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// The utils barrel cannot load in this server-only runtime; the real org-scope parser is what runs here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-scope.utils')),
}));

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

function call(query: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { res, next, promise: new AnalyticsController().orgContributorsMonthly({ query } as unknown as Request, res, next) };
}

describe('AnalyticsController.orgContributorsMonthly — organization scope (lfx-self-serve-ops#1219)', () => {
  const response = { accountId: ACCOUNT, totalActiveContributors: 5, monthlyData: [], monthlyLabels: [] };

  beforeEach(() => {
    getContributorsMonthly.mockReset();
    getContributorsMonthly.mockResolvedValue(response);
  });

  it.each([
    [{ accountId: ACCOUNT }, 'insights'],
    [{ accountId: ACCOUNT, orgScope: 'insights' }, 'insights'],
    [{ accountId: ACCOUNT, orgScope: 'all' }, 'all'],
  ])('reads %o under the %s scope', async (query, scope) => {
    const { res, next, promise } = call(query);
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getContributorsMonthly).toHaveBeenCalledWith(ACCOUNT, scope);
    expect(res.json).toHaveBeenCalledWith(response);
  });

  it('rejects an unknown scope with a 400 before reading', async () => {
    const { next, promise } = call({ accountId: ACCOUNT, orgScope: 'everyone' });
    await promise;

    expect(getContributorsMonthly).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });
});
