// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignServiceGoogleAdsConversionActions } from '@lfx-one/shared/interfaces';

import { GOOGLE_CONVERSION_ACTIONS_ACCESS_UNAVAILABLE_CODE, GOOGLE_CONVERSION_ACTIONS_RESTRICTED_CODE } from '@lfx-one/shared/constants';

import { AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The Implement tab's conversion-action picker route (#4991): `global_marketing_ops` on the project,
// as campaign-service answers (lfx-v2-campaign-service#486), and 404 while the campaign-service create
// road is dark. Kept out of campaign.controller.spec.ts, as the geo route is.
const { svcList, isServerFeatureEnabled, logger, checkRootWriter, checkRootCampaignManager, checkProjectGlobalMarketingOpsStrict } = vi.hoisted(() => ({
  svcList: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
  checkRootWriter: vi.fn(async () => false),
  checkRootCampaignManager: vi.fn(async () => false),
  checkProjectGlobalMarketingOpsStrict: vi.fn<(req: unknown, slug: string) => Promise<boolean>>(async () => false),
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public listGoogleAdsConversionActions = svcList;
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
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkRootWriter, checkRootCampaignManager, checkProjectGlobalMarketingOpsStrict } }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

const CUTOVER_FLAGS = [ServerFeatureFlag.CampaignServiceCreate, ServerFeatureFlag.CampaignServiceBriefs, ServerFeatureFlag.CampaignServiceJobs];

function cutover(on: boolean): void {
  isServerFeatureEnabled.mockImplementation((flag) => (CUTOVER_FLAGS as unknown[]).includes(flag) && on);
}

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/api/campaigns/google/conversion-actions' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function nextError(next: NextFunction): unknown {
  return vi.mocked(next).mock.calls[0]?.[0];
}

const ACTIONS: CampaignServiceGoogleAdsConversionActions = {
  account_id: '1234567890',
  conversion_actions: [
    {
      id: '1111111111',
      resource_name: 'customers/1234567890/conversionActions/1111111111',
      name: 'Event Registrations',
      status: 'ENABLED',
      type: 'WEBPAGE',
      category: 'SIGNUP',
      primary_for_goal: true,
    },
    {
      id: '2222222222',
      resource_name: 'customers/1234567890/conversionActions/2222222222',
      name: '  ',
      status: 'ENABLED',
      type: 'UPLOAD_CLICKS',
      category: 'LEAD',
      primary_for_goal: false,
    },
  ],
  conversion_action_count: 2,
};

describe('CampaignController.getGoogleAdsConversionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cutover(true);
    checkProjectGlobalMarketingOpsStrict.mockResolvedValue(true);
    checkRootWriter.mockResolvedValue(false);
    checkRootCampaignManager.mockResolvedValue(false);
  });

  it('maps the actions onto the camelCase shape, naming an unnamed action by its id', async () => {
    svcList.mockResolvedValueOnce(ACTIONS);
    const res = buildRes();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: ' tlf ' }), res, vi.fn());

    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(res.json).toHaveBeenCalledWith({
      accountId: '1234567890',
      actions: [
        {
          id: '1111111111',
          resourceName: 'customers/1234567890/conversionActions/1111111111',
          name: 'Event Registrations',
          category: 'SIGNUP',
          primaryForGoal: true,
        },
        { id: '2222222222', resourceName: 'customers/1234567890/conversionActions/2222222222', name: '2222222222', category: 'LEAD', primaryForGoal: false },
      ],
    });
  });

  it('drops a row whose id or resource name cannot be sent, or whose resource name names another id, and offers a repeated id once', async () => {
    const row = ACTIONS.conversion_actions[0];
    svcList.mockResolvedValueOnce({
      ...ACTIONS,
      conversion_actions: [
        row,
        { ...row, name: 'Repeat' },
        { ...row, id: 'abc' },
        { ...row, id: '3333333333', resource_name: 'customers/1234567890/userLists/3333333333' },
        { ...row, id: '4444444444', resource_name: '' },
        { ...row, id: '5555555555', resource_name: '5555555555' },
        { ...row, id: '6666666666', resource_name: 'customers/1234567890/conversionActions/7777777777' },
      ],
    });
    const res = buildRes();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: 'tlf' }), res, vi.fn());

    const ids = (vi.mocked(res.json).mock.calls[0][0] as { actions: { id: string }[] }).actions.map((a) => a.id);
    expect(ids).toEqual(['1111111111', '4444444444']);
  });

  it("admits global_marketing_ops on the project the request names, asking for that project's relation", async () => {
    svcList.mockResolvedValueOnce(ACTIONS);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: ' tlf ' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(checkProjectGlobalMarketingOpsStrict).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(svcList).toHaveBeenCalled();
  });

  // campaign-service checks only `global_marketing_ops` on the path project (#486), so neither a ROOT
  // writer nor a campaign manager (a foundation ED) without it is answered: the list names every
  // foundation's actions. Refused with a coded 403 before any upstream call, and no root lookup is made.
  it.each([
    ['a ROOT writer without it', true, false],
    ['a ROOT campaign manager without it on the project', false, true],
    ['a campaign manager (ED) without it', false, false],
  ])('refuses %s with a coded 403 before any upstream call', async (_label, writer, manager) => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValue(false);
    checkRootWriter.mockResolvedValue(writer);
    checkRootCampaignManager.mockResolvedValue(manager);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: 'tlf' }), buildRes(), next);

    const err = nextError(next) as AuthorizationError;
    expect(err).toBeInstanceOf(AuthorizationError);
    expect(err.code).toBe(GOOGLE_CONVERSION_ACTIONS_RESTRICTED_CODE);
    expect(svcList).not.toHaveBeenCalled();
    expect(checkRootWriter).not.toHaveBeenCalled();
  });

  it('refuses with a coded 503, never an admission, when the access check cannot be made', async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('access check unavailable'));
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: 'tlf' }), buildRes(), next);

    const err = nextError(next) as MicroserviceError;
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe(GOOGLE_CONVERSION_ACTIONS_ACCESS_UNAVAILABLE_CODE);
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers 404 while the campaign-service create road is dark, asking nothing about the caller', async () => {
    cutover(false);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svcList).not.toHaveBeenCalled();
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
  });

  it('refuses a missing project as a 400, before the access check', async () => {
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svcList).not.toHaveBeenCalled();
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
  });

  it('fails an unreadable body with 502 rather than reporting no actions', async () => {
    svcList.mockResolvedValueOnce({ account_id: '1234567890', conversion_action_count: 0 });
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it("passes campaign-service's own refusal through", async () => {
    const upstream = new MicroserviceError('Service unavailable', 503, 'SERVICE_UNAVAILABLE', { operation: 'x', service: 'y' });
    svcList.mockRejectedValueOnce(upstream);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsConversionActions(buildReq({ project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBe(upstream);
  });
});
