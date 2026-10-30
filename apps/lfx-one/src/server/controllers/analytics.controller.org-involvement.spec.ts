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
// The utils barrel cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-scope.utils')),
}));

import { AnalyticsController } from './analytics.controller';

function call(query: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { res, next, promise: new AnalyticsController().orgContributorsMonthly({ query } as unknown as Request, res, next) };
}

// lfx-self-serve-ops#1219: the Overview has no organization scope picker, so its card always reads the default scope.
describe('AnalyticsController.orgContributorsMonthly — the default organization scope', () => {
  const response = { accountId: ACCOUNT, totalActiveContributors: 5, monthlyData: [], monthlyLabels: [] };

  beforeEach(() => {
    getContributorsMonthly.mockReset();
    getContributorsMonthly.mockResolvedValue(response);
  });

  it.each<Record<string, string>>([{ accountId: ACCOUNT }, { accountId: ACCOUNT, orgScope: 'all' }, { accountId: ACCOUNT, orgScope: 'everyone' }])(
    'reads %o for the account alone, taking no organization scope from the request',
    async (query) => {
      const { res, next, promise } = call(query);
      await promise;

      expect(next).not.toHaveBeenCalled();
      expect(getContributorsMonthly).toHaveBeenCalledWith(ACCOUNT);
      expect(getContributorsMonthly.mock.calls[0]).toHaveLength(1);
      expect(res.json).toHaveBeenCalledWith(response);
    }
  );
});
