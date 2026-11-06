// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_USER_LISTS_ACCESS_UNAVAILABLE_CODE, GOOGLE_USER_LISTS_RESTRICTED_CODE } from '@lfx-one/shared/constants';
import type { CampaignServiceGoogleAdsUserLists } from '@lfx-one/shared/interfaces';

import { AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The Implement tab's audience segment picker route (#5244): `global_marketing_ops` on the project,
// as campaign-service answers the read, and 404 while audience segments cannot be created.
const { svcList, isServerFeatureEnabled, logger, checkProjectGlobalMarketingOpsStrict, checkRootWriter } = vi.hoisted(() => ({
  svcList: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
  checkProjectGlobalMarketingOpsStrict: vi.fn(async () => true),
  checkRootWriter: vi.fn(async () => false),
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public listGoogleAdsUserLists = svcList;
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
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkProjectGlobalMarketingOpsStrict, checkRootWriter } }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

const CUTOVER_FLAGS = [ServerFeatureFlag.CampaignServiceCreate, ServerFeatureFlag.CampaignServiceBriefs, ServerFeatureFlag.CampaignServiceJobs];

function cutover(on: boolean): void {
  isServerFeatureEnabled.mockImplementation((flag) => (CUTOVER_FLAGS as unknown[]).includes(flag) && on);
}

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/api/campaigns/google/user-lists' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function nextError(next: NextFunction): unknown {
  return vi.mocked(next).mock.calls[0]?.[0];
}

const LISTS: CampaignServiceGoogleAdsUserLists = {
  account_id: '8666746580',
  user_lists: [
    {
      resource_name: 'customers/8666746580/userLists/111',
      id: '111',
      name: 'KubeCon NA 2025 registrants',
      type: 'CRM_BASED',
      membership_status: 'OPEN',
      eligible_for_search: true,
    },
    { resource_name: 'customers/8666746580/userLists/222', id: '222', name: '  ', type: 'RULE_BASED' },
  ],
  user_list_count: 2,
  truncated: true,
};

describe('CampaignController.getGoogleAdsUserLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cutover(true);
    checkProjectGlobalMarketingOpsStrict.mockResolvedValue(true);
  });

  it('maps the lists onto the camelCase shape for the trimmed project, naming an unnamed list by its resource name', async () => {
    svcList.mockResolvedValueOnce(LISTS);
    const res = buildRes();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: ' tlf ' }), res, vi.fn());

    expect(checkProjectGlobalMarketingOpsStrict).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(res.json).toHaveBeenCalledWith({
      accountId: '8666746580',
      userLists: [
        { resourceName: 'customers/8666746580/userLists/111', id: '111', name: 'KubeCon NA 2025 registrants', type: 'CRM_BASED', eligibleForSearch: true },
        {
          resourceName: 'customers/8666746580/userLists/222',
          id: '222',
          name: 'customers/8666746580/userLists/222',
          type: 'RULE_BASED',
          eligibleForSearch: null,
        },
      ],
      truncated: true,
    });
  });

  it('drops a row whose resource name campaignAudienceSegments would refuse, and offers a repeated one once', async () => {
    const row = LISTS.user_lists[0];
    svcList.mockResolvedValueOnce({
      ...LISTS,
      user_lists: [
        row,
        { ...row, name: 'Repeat' },
        { ...row, resource_name: 'customers/8666746580/customAudiences/333' },
        { ...row, resource_name: '333' },
        { ...row, resource_name: 'customers/866-674-6580/userLists/444' },
        { ...row, resource_name: 'customers/8666746580/userLists/0555' },
        { ...row, resource_name: undefined as unknown as string },
      ],
    });
    const res = buildRes();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), res, vi.fn());

    const names = (vi.mocked(res.json).mock.calls[0][0] as { userLists: { resourceName: string; name: string }[] }).userLists;
    expect(names).toEqual([expect.objectContaining({ resourceName: 'customers/8666746580/userLists/111', name: 'KubeCon NA 2025 registrants' })]);
  });

  it('reads truncated as false unless upstream says true', async () => {
    svcList.mockResolvedValueOnce({ ...LISTS, truncated: undefined as unknown as boolean });
    const res = buildRes();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), res, vi.fn());

    expect((vi.mocked(res.json).mock.calls[0][0] as { truncated: boolean }).truncated).toBe(false);
  });

  it('refuses a caller without global_marketing_ops on the project with a coded 403 before any upstream call', async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValueOnce(false);
    checkRootWriter.mockResolvedValue(true);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect((error as AuthorizationError).code).toBe(GOOGLE_USER_LISTS_RESTRICTED_CODE);
    expect(svcList).not.toHaveBeenCalled();
    // A ROOT writer without the relation is refused too: campaign-service checks only the relation.
    expect(checkRootWriter).not.toHaveBeenCalled();
  });

  it('answers a coded 503 when the access check cannot be made, and never admits', async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('fga down'));
    const next = vi.fn();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(MicroserviceError);
    expect((error as MicroserviceError).statusCode).toBe(503);
    expect((error as MicroserviceError).code).toBe(GOOGLE_USER_LISTS_ACCESS_UNAVAILABLE_CODE);
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers 404 while audience segments cannot be created, asking nothing about the caller', async () => {
    cutover(false);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('refuses a request without a project with a 400 before the access check', async () => {
    const next = vi.fn();

    await new CampaignController().getGoogleAdsUserLists(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('fails the read with a 502 when upstream sends no user_lists array', async () => {
    svcList.mockResolvedValueOnce({ account_id: '8666746580' });
    const next = vi.fn();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it('passes an upstream failure on to the error handler', async () => {
    const failure = new MicroserviceError('upstream', 503, 'SERVICE_UNAVAILABLE');
    svcList.mockRejectedValueOnce(failure);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsUserLists(buildReq({ project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBe(failure);
  });
});
