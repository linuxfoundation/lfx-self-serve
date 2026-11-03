// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  getParticipatingOrgs: vi.fn(),
  getNps: vi.fn(),
  getChurn: vi.fn(),
  getOutstandingBalance: vi.fn(),
  getEvents: vi.fn(),
  getBoard: vi.fn(),
  getCode: vi.fn(),
  getNewsletters: vi.fn(),
}));

vi.mock('../services/health-metrics-overview.service', () => ({
  HealthMetricsOverviewService: class {
    public getParticipatingOrgs = reads.getParticipatingOrgs;
    public getNps = reads.getNps;
    public getChurn = reads.getChurn;
    public getOutstandingBalance = reads.getOutstandingBalance;
    public getEvents = reads.getEvents;
    public getBoard = reads.getBoard;
    public getCode = reads.getCode;
    public getNewsletters = reads.getNewsletters;
  },
}));
// The controller constructs nine unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {}, isSupportedEventsRange: () => true }));
vi.mock('../services/health-metrics-members.service', () => ({ HealthMetricsMembersService: class {}, isSupportedMembersRange: () => true }));
vi.mock('../services/health-metrics-non-members.service', () => ({ HealthMetricsNonMembersService: class {}, isSupportedNonMembersRange: () => true }));
vi.mock('../services/health-metrics-training.service', () => ({ HealthMetricsTrainingService: class {}, isSupportedTrainingRange: () => true }));
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

type Handler =
  | 'getOverviewParticipatingOrgs'
  | 'getOverviewNps'
  | 'getOverviewChurn'
  | 'getOverviewOutstandingBalance'
  | 'getOverviewEvents'
  | 'getOverviewBoard'
  | 'getOverviewCode'
  | 'getOverviewNewsletters';

const period = { totals: null, tiers: [{ tier: 'Gold Membership' }] };

/** Each handler, the read behind it, a response and the counts it logs. */
const CASES: [Handler, keyof typeof reads, string, unknown, Record<string, unknown>][] = [
  ['getOverviewParticipatingOrgs', 'getParticipatingOrgs', 'get_overview_participating_orgs', { measured: true, periods: {} }, { measured: true }],
  [
    'getOverviewNps',
    'getNps',
    'get_overview_nps',
    { periods: { YTD: { npsScore: 40 }, COMPLETED_YEAR: null, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null } },
    { surveyed_period_count: 1 },
  ],
  [
    'getOverviewChurn',
    'getChurn',
    'get_overview_churn',
    { periods: { YTD: period, COMPLETED_YEAR: period, COMPLETED_YEAR_2: period, COMPLETED_YEAR_3: period } },
    { measured: false, tier_count: 1 },
  ],
  ['getOverviewOutstandingBalance', 'getOutstandingBalance', 'get_overview_outstanding_balance', { measured: false }, { measured: false }],
  [
    'getOverviewEvents',
    'getEvents',
    'get_overview_events',
    { upcoming: [{ eventId: 'e1' }], past: [], truncated: false },
    { upcoming_count: 1, past_count: 0, truncated: false },
  ],
  ['getOverviewBoard', 'getBoard', 'get_overview_board', { periods: {}, members: [{ key: 'k1' }, { key: 'k2' }] }, { member_count: 2 }],
  ['getOverviewCode', 'getCode', 'get_overview_code', { measured: true, periods: {} }, { measured: true }],
  [
    'getOverviewNewsletters',
    'getNewsletters',
    'get_overview_newsletters',
    { measured: true, periods: {}, newsletters: [{ key: 'n1' }, { key: 'n2' }] },
    { measured: true, newsletter_count: 2 },
  ],
];

function call(handler: Handler, queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller[handler](req, res, next) };
}

describe.each(CASES)('AnalyticsController.%s', (handler, read, operation, response, logged) => {
  beforeEach(() => {
    vi.mocked(logger.success).mockClear();
    reads[read].mockReset();
    reads[read].mockResolvedValue(response);
  });

  it('reads the foundation, returns the response and logs counts only', async () => {
    const { res, next, promise } = call(handler, { foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(reads[read]).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(response);
    expect(vi.mocked(logger.success).mock.calls[0]?.[1]).toBe(operation);
    expect(vi.mocked(logger.success).mock.calls[0]?.[3]).toEqual({ foundation_slug: 'acme', ...logged });
  });

  it.each([[{}], [{ foundationSlug: '' }], [{ foundationSlug: 'Acme Corp' }]])('rejects %o on foundationSlug', async (query) => {
    const { next, promise } = call(handler, query);
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error?.validationErrors?.[0]?.field).toBe('foundationSlug');
    expect(reads[read]).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    reads[read].mockRejectedValue(failure);

    const { next, promise } = call(handler, { foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
