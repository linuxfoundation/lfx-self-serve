// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignServiceLinkedInAdsCreateAccount, LinkedInCreateAccountResult } from '@lfx-one/shared/interfaces';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The Implement tab's LinkedIn ad account read (#5809): campaign-service's `create-account`
// (lfx-v2-campaign-service#581), camel-cased, with `canChoose` decided by the caller's
// `global_marketing_ops` on the project. 404 unless the create cutover and the account-selection flag
// are both on. Kept out of campaign.controller.spec.ts, as the other picker routes are.
const { svcGet, isServerFeatureEnabled, logger, checkProjectGlobalMarketingOpsStrict } = vi.hoisted(() => ({
  svcGet: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
  checkProjectGlobalMarketingOpsStrict: vi.fn<(req: unknown, slug: string) => Promise<boolean>>(async () => false),
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public getLinkedInAdsCreateAccount = svcGet;
    },
  };
});
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/server-feature-flag.helper')>();
  return { ...actual, isServerFeatureEnabled };
});
vi.mock('../services/campaign-proxy.service', () => ({ CampaignProxyService: class {} }));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {},
  LinkedInMetricsService: class {},
  RedditMetricsService: class {},
  MetaMetricsService: class {},
}));
vi.mock('../services/linkedin-ads.service', () => ({ getLinkedInConfig: () => ({ accounts: [], targetingProfiles: [] }) }));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    checkRootWriter: vi.fn(async () => false),
    checkRootCampaignManager: vi.fn(async () => false),
    checkProjectGlobalMarketingOpsStrict,
  },
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

const CUTOVER_FLAGS = [ServerFeatureFlag.CampaignServiceCreate, ServerFeatureFlag.CampaignServiceBriefs, ServerFeatureFlag.CampaignServiceJobs];

function flags(cutover: boolean, selection: boolean): void {
  isServerFeatureEnabled.mockImplementation(
    (flag) => ((CUTOVER_FLAGS as unknown[]).includes(flag) && cutover) || (flag === ServerFeatureFlag.CampaignServiceLinkedInAccountSelection && selection)
  );
}

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/api/campaigns/linkedin/create-account' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function nextError(next: NextFunction): unknown {
  return vi.mocked(next).mock.calls[0]?.[0];
}

function answered(res: Response): LinkedInCreateAccountResult {
  return vi.mocked(res.json).mock.calls[0][0] as LinkedInCreateAccountResult;
}

const SYSTEM: CampaignServiceLinkedInAdsCreateAccount = {
  account_id: '100000001',
  org_id: '200000001',
  label: 'Shared system account',
  source: 'system',
  status: 'active',
  account_selection_enabled: true,
  selectable_accounts: [
    { account_id: '100000001', org_id: '200000001', label: 'Shared system account', default: true },
    { account_id: '100000002', org_id: '200000002', label: 'Grant One', default: false },
  ],
};

describe('CampaignController.getLinkedInCreateAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags(true, true);
    checkProjectGlobalMarketingOpsStrict.mockResolvedValue(true);
  });

  it('offers global_marketing_ops the default first, then each grant, camel-cased', async () => {
    svcGet.mockResolvedValueOnce(SYSTEM);
    const res = buildRes();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: ' tlf ' }), res, vi.fn());

    expect(svcGet).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(checkProjectGlobalMarketingOpsStrict).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(answered(res)).toEqual({
      accountId: '100000001',
      orgId: '200000001',
      label: 'Shared system account',
      source: 'system',
      canChoose: true,
      accounts: [
        { accountId: '100000001', orgId: '200000001', label: 'Shared system account', isDefault: true },
        { accountId: '100000002', orgId: '200000002', label: 'Grant One', isDefault: false },
      ],
    });
  });

  // campaign-service refuses ANY adAccountId from a caller without global_marketing_ops while its
  // selection is on, so an executive director is shown the default only, and the grants are not listed.
  it('shows a caller without global_marketing_ops the default only', async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValue(false);
    svcGet.mockResolvedValueOnce(SYSTEM);
    const res = buildRes();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), res, vi.fn());

    expect(answered(res).canChoose).toBe(false);
    expect(answered(res).accounts).toEqual([{ accountId: '100000001', orgId: '200000001', label: 'Shared system account', isDefault: true }]);
  });

  it('answers a failed relation check with the read-only default, never a choice', async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('access check unavailable'));
    svcGet.mockResolvedValueOnce(SYSTEM);
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(answered(res).canChoose).toBe(false);
    expect(answered(res).accounts).toHaveLength(1);
  });

  it.each([
    ["campaign-service's selection is off", { ...SYSTEM, account_selection_enabled: false }],
    ['there is nothing but the default', { ...SYSTEM, selectable_accounts: [SYSTEM.selectable_accounts[0]] }],
  ])('offers no choice, and asks nothing about the caller, when %s', async (_label, payload) => {
    svcGet.mockResolvedValueOnce(payload);
    const res = buildRes();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), res, vi.fn());

    expect(answered(res).canChoose).toBe(false);
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
  });

  it('drops a grant whose id is not a bare account number, and offers a repeated one once', async () => {
    const grant = SYSTEM.selectable_accounts[1];
    svcGet.mockResolvedValueOnce({
      ...SYSTEM,
      selectable_accounts: [
        SYSTEM.selectable_accounts[0],
        grant,
        { ...grant, label: 'Repeat' },
        { ...grant, account_id: 'urn:li:sponsoredAccount:100000003' },
        { ...grant, account_id: '100000004', label: ' ' },
      ],
    });
    const res = buildRes();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), res, vi.fn());

    expect(answered(res).accounts.map((a) => [a.accountId, a.label])).toEqual([
      ['100000001', 'Shared system account'],
      ['100000002', 'Grant One'],
      ['100000004', '100000004'],
    ]);
  });

  it.each([
    ['the cutover is dark', false, true],
    ['account selection is off', true, false],
  ])('answers 404 while %s, reading nothing', async (_label, cutover, selection) => {
    flags(cutover, selection);
    const next = vi.fn();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svcGet).not.toHaveBeenCalled();
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
  });

  it('refuses a missing project as a 400', async () => {
    const next = vi.fn();

    await new CampaignController().getLinkedInCreateAccount(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svcGet).not.toHaveBeenCalled();
  });

  it('fails an unreadable default with 502 rather than naming an account the create does not use', async () => {
    svcGet.mockResolvedValueOnce({ ...SYSTEM, account_id: 'urn:li:sponsoredAccount:1' });
    const next = vi.fn();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it("passes campaign-service's own refusal through", async () => {
    const upstream = new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation: 'x', service: 'y' });
    svcGet.mockRejectedValueOnce(upstream);
    const next = vi.fn();

    await new CampaignController().getLinkedInCreateAccount(buildReq({ project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBe(upstream);
  });
});
