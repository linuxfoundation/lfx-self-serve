// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_AUDIENCES_ACCESS_UNAVAILABLE_CODE, GOOGLE_AUDIENCES_RESTRICTED_CODE } from '@lfx-one/shared/constants';
import type { CampaignServiceGoogleAdsAudiences } from '@lfx-one/shared/interfaces';

import { AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The Implement tab's Demand Gen audience picker route (#5244): `global_marketing_ops` on the project,
// as campaign-service answers the read, and 404 while the campaign-service create road is off.
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
      public listGoogleAdsAudiences = svcList;
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
  return { query, path: '/api/campaigns/google/audiences' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function nextError(next: NextFunction): unknown {
  return vi.mocked(next).mock.calls[0]?.[0];
}

const ACCOUNT = '1234567890';
const AUDIENCES: CampaignServiceGoogleAdsAudiences = {
  account_id: ACCOUNT,
  type: 'audience',
  audiences: [
    {
      resource_name: `customers/${ACCOUNT}/audiences/111`,
      id: '111',
      name: 'Example Summit - High Intent',
      type: 'audience',
      status: 'ENABLED',
      description: 'Registrants and site visitors',
    },
    { resource_name: `customers/${ACCOUNT}/audiences/222`, id: '222', name: '  ', type: 'audience', description: ' ' },
  ],
  audience_count: 2,
  truncated: true,
};

describe('CampaignController.getGoogleAdsAudiences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cutover(true);
    checkProjectGlobalMarketingOpsStrict.mockResolvedValue(true);
  });

  it('maps the Audiences onto the camelCase shape for the trimmed project, naming an unnamed one by its resource name', async () => {
    svcList.mockResolvedValueOnce(AUDIENCES);
    const res = buildRes();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: ' tlf ' }), res, vi.fn());

    expect(checkProjectGlobalMarketingOpsStrict).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf', 'audience', undefined);
    expect(res.json).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      audiences: [
        { resourceName: `customers/${ACCOUNT}/audiences/111`, id: '111', name: 'Example Summit - High Intent', description: 'Registrants and site visitors' },
        { resourceName: `customers/${ACCOUNT}/audiences/222`, id: '222', name: `customers/${ACCOUNT}/audiences/222`, description: null },
      ],
      truncated: true,
    });
  });

  it('drops a row the create would refuse, and offers a repeated one once', async () => {
    const row = AUDIENCES.audiences[0];
    svcList.mockResolvedValueOnce({
      ...AUDIENCES,
      audiences: [
        row,
        { ...row, name: 'Repeat' },
        { ...row, resource_name: `customers/${ACCOUNT}/userLists/333` },
        { ...row, resource_name: `customers/${ACCOUNT}/audiences/0333` },
        { ...row, resource_name: 'customers/999/audiences/444' },
        { ...row, resource_name: '444' },
        { ...row, resource_name: undefined as unknown as string },
        null as unknown as CampaignServiceGoogleAdsAudiences['audiences'][number],
      ],
    });
    const res = buildRes();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), res, vi.fn());

    const rows = (vi.mocked(res.json).mock.calls[0][0] as { audiences: { resourceName: string; name: string }[] }).audiences;
    expect(rows).toEqual([expect.objectContaining({ resourceName: `customers/${ACCOUNT}/audiences/111`, name: 'Example Summit - High Intent' })]);
  });

  it.each([
    ['custom_audience', 'customAudiences'],
    ['custom_interest', 'customInterests'],
    ['user_interest', 'userInterests'],
  ])('reads type=%s for the Display pickers, keeping only rows of %s on the account read (#5262)', async (type, collection) => {
    const row = AUDIENCES.audiences[0];
    svcList.mockResolvedValueOnce({
      ...AUDIENCES,
      type,
      audiences: [
        { ...row, resource_name: `customers/${ACCOUNT}/${collection}/80001` },
        { ...row, resource_name: `customers/${ACCOUNT}/audiences/111` },
        { ...row, resource_name: `customers/999/${collection}/80002` },
        { ...row, resource_name: `customers/${ACCOUNT}/${collection}/080003` },
      ],
    });
    const res = buildRes();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf', type, q: '  cloud ' }), res, vi.fn());

    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf', type, 'cloud');
    const rows = (vi.mocked(res.json).mock.calls[0][0] as { audiences: { resourceName: string }[] }).audiences;
    expect(rows.map((r) => r.resourceName)).toEqual([`customers/${ACCOUNT}/${collection}/80001`]);
  });

  it('leaves a blank q out', async () => {
    svcList.mockResolvedValueOnce(AUDIENCES);

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf', type: 'audience', q: '   ' }), buildRes(), vi.fn());

    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf', 'audience', undefined);
  });

  it.each([
    ['an unknown type', { type: 'combined_audience' }, 'type'],
    ['a repeated type', { type: ['audience', 'user_interest'] }, 'type'],
    ['a q over 100 characters', { q: 'x'.repeat(101) }, 'q'],
    ['a repeated q', { q: ['a', 'b'] }, 'q'],
  ])('refuses %s with a 400 after the access check and before any upstream call', async (_label, query, field) => {
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf', ...query }), buildRes(), next);

    const error = nextError(next) as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.validationErrors?.[0]?.field).toBe(field);
    expect(checkProjectGlobalMarketingOpsStrict).toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('reads truncated as false unless upstream says true', async () => {
    svcList.mockResolvedValueOnce({ ...AUDIENCES, truncated: undefined as unknown as boolean });
    const res = buildRes();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), res, vi.fn());

    expect((vi.mocked(res.json).mock.calls[0][0] as { truncated: boolean }).truncated).toBe(false);
  });

  it('refuses a caller without global_marketing_ops on the project with a coded 403 before any upstream call', async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValueOnce(false);
    checkRootWriter.mockResolvedValue(true);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect((error as AuthorizationError).code).toBe(GOOGLE_AUDIENCES_RESTRICTED_CODE);
    expect(svcList).not.toHaveBeenCalled();
    expect(checkRootWriter).not.toHaveBeenCalled();
  });

  it('answers a coded 503 when the access check cannot be made, and never admits', async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('fga down'));
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(MicroserviceError);
    expect((error as MicroserviceError).statusCode).toBe(503);
    expect((error as MicroserviceError).code).toBe(GOOGLE_AUDIENCES_ACCESS_UNAVAILABLE_CODE);
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers 404 while the create road is off, asking nothing about the caller', async () => {
    cutover(false);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('refuses a request without a project with a 400 before the access check', async () => {
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('fails the read with a 502 when upstream sends no audiences array', async () => {
    svcList.mockResolvedValueOnce({ account_id: ACCOUNT });
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it('passes an upstream failure on to the error handler', async () => {
    const failure = new MicroserviceError('upstream', 503, 'SERVICE_UNAVAILABLE');
    svcList.mockRejectedValueOnce(failure);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAudiences(buildReq({ project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBe(failure);
  });
});
