// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_KEYWORD_TARGETING_REMOVALS } from '@lfx-one/shared/constants';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';

const {
  getPlatformAudience,
  resolvePlatformCampaign,
  getRedditAdsKeywords,
  getCampaignSettings,
  listMetaAdSets,
  updateMetaAdSetStatus,
  adoptCampaign,
  getKeywordTargeting,
  removeKeywordTargeting,
  getCampaign,
  listAdoptableBriefs,
  isServerFeatureEnabled,
  logger,
} = vi.hoisted(() => ({
  getPlatformAudience: vi.fn(),
  resolvePlatformCampaign: vi.fn(),
  getRedditAdsKeywords: vi.fn(),
  getCampaignSettings: vi.fn(),
  listMetaAdSets: vi.fn(),
  updateMetaAdSetStatus: vi.fn(),
  adoptCampaign: vi.fn(),
  getKeywordTargeting: vi.fn(),
  removeKeywordTargeting: vi.fn(),
  getCampaign: vi.fn(),
  listAdoptableBriefs: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/campaign-optimize.service', () => ({
  CampaignOptimizeService: class {
    public getPlatformAudience = getPlatformAudience;
    public resolvePlatformCampaign = resolvePlatformCampaign;
    public getRedditAdsKeywords = getRedditAdsKeywords;
    public getCampaignSettings = getCampaignSettings;
    public listMetaAdSets = listMetaAdSets;
    public updateMetaAdSetStatus = updateMetaAdSetStatus;
    public adoptCampaign = adoptCampaign;
    public getKeywordTargeting = getKeywordTargeting;
    public removeKeywordTargeting = removeKeywordTargeting;
    public getCampaign = getCampaign;
    public listAdoptableBriefs = listAdoptableBriefs;
  },
}));
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/server-feature-flag.helper')>();
  return { ...actual, isServerFeatureEnabled };
});
vi.mock('../services/logger.service', () => ({ logger }));

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { CampaignOptimizeController } from './campaign-optimize.controller';

const CAMPAIGN = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const BRIEF = '6f9619ff-8b86-d011-b42d-00c04fc964ff';

function buildReq(parts: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }): Request {
  return { params: parts.params ?? {}, query: parts.query ?? { project: 'tlf' }, body: parts.body, path: '/api/campaigns/x' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

/** The single error passed to `next`, asserted to be a validation error on `field`. */
function expectFieldError(next: NextFunction, field: string): void {
  expect(next).toHaveBeenCalledTimes(1);
  const error = vi.mocked(next).mock.calls[0][0] as unknown;
  expect(error).toBeInstanceOf(ServiceValidationError);
  expect((error as ServiceValidationError).validationErrors[0].field).toBe(field);
}

let controller: CampaignOptimizeController;
let res: Response;
let next: NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
  isServerFeatureEnabled.mockReturnValue(false);
  controller = new CampaignOptimizeController();
  res = buildRes();
  next = vi.fn();
});

describe('CampaignOptimizeController.getPlatformAudience', () => {
  it.each(['meta-ads', 'twitter-ads', 'microsoft-ads'] as const)('serves %s with the flag OFF (its upstream endpoint exists)', async (platform) => {
    getPlatformAudience.mockResolvedValue({ window: 'today', buckets: [], bucket_count: 0 });

    await controller.getPlatformAudience(buildReq({ query: { project: ' tlf ', window: 'today' } }), res, next, platform);

    expect(getPlatformAudience).toHaveBeenCalledWith(expect.anything(), 'tlf', platform, 'today');
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['reddit-ads', 'linkedin-ads'] as const)('answers 404 for %s while the optimize-reads flag is OFF', async (platform) => {
    await controller.getPlatformAudience(buildReq({}), res, next, platform);

    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(getPlatformAudience).not.toHaveBeenCalled();
  });

  it.each(['reddit-ads', 'linkedin-ads'] as const)('serves %s once the optimize-reads flag is ON', async (platform) => {
    isServerFeatureEnabled.mockImplementation((flag) => flag === ServerFeatureFlag.CampaignServiceOptimizeReads);
    getPlatformAudience.mockResolvedValue({ window: 'last_30_days', buckets: [], bucket_count: 0 });

    await controller.getPlatformAudience(buildReq({}), res, next, platform);

    expect(getPlatformAudience).toHaveBeenCalledWith(expect.anything(), 'tlf', platform, undefined);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses a window the platform does not serve (X caps at 7 days)', async () => {
    await controller.getPlatformAudience(buildReq({ query: { project: 'tlf', window: 'last_30_days' } }), res, next, 'twitter-ads');

    expectFieldError(next, 'window');
    expect(getPlatformAudience).not.toHaveBeenCalled();
  });

  it('refuses a missing project', async () => {
    await controller.getPlatformAudience(buildReq({ query: {} }), res, next, 'meta-ads');

    expectFieldError(next, 'project');
  });

  it('hands an upstream failure to the error middleware', async () => {
    const failure = new Error('upstream');
    getPlatformAudience.mockRejectedValue(failure);

    await controller.getPlatformAudience(buildReq({}), res, next, 'meta-ads');

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('CampaignOptimizeController.resolvePlatformCampaign', () => {
  it('serves Meta/Reddit/X ungated and validates the id against the platform rule', async () => {
    resolvePlatformCampaign.mockResolvedValue({ platform_campaign_id: '8wxyz', matches: [], match_count: 0 });

    await controller.resolvePlatformCampaign(buildReq({ query: { project: 'tlf', platformCampaignId: '8wxyz' } }), res, next, 'twitter-ads');
    expect(resolvePlatformCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', 'twitter-ads', '8wxyz');

    await controller.resolvePlatformCampaign(buildReq({ query: { project: 'tlf', platformCampaignId: '0123' } }), res, next, 'meta-ads');
    expectFieldError(next, 'platformCampaignId');
  });

  // LinkedIn's resolve shipped upstream (campaign-service #318), so it is no longer flag-gated.
  it('serves LinkedIn with the optimize-reads flag OFF and refuses an id outside its int64 rule', async () => {
    resolvePlatformCampaign.mockResolvedValue({ platform_campaign_id: '123', matches: [], match_count: 0 });

    await controller.resolvePlatformCampaign(buildReq({ query: { project: 'tlf', platformCampaignId: '123' } }), res, next, 'linkedin-ads');
    expect(resolvePlatformCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', 'linkedin-ads', '123');
    expect(next).not.toHaveBeenCalled();

    await controller.resolvePlatformCampaign(buildReq({ query: { project: 'tlf', platformCampaignId: '0123' } }), res, next, 'linkedin-ads');
    expectFieldError(next, 'platformCampaignId');
    expect(resolvePlatformCampaign).toHaveBeenCalledTimes(1);
  });
});

describe('CampaignOptimizeController.getRedditKeywords', () => {
  it('answers 404 while the flag is OFF', async () => {
    await controller.getRedditKeywords(buildReq({}), res, next);

    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(getRedditAdsKeywords).not.toHaveBeenCalled();
  });

  it('maps the rows into the keyword table shape when the flag is ON', async () => {
    isServerFeatureEnabled.mockReturnValue(true);
    getRedditAdsKeywords.mockResolvedValue({
      window: 'last_7_days',
      rows: [],
      row_count: 0,
      truncated: false,
      metrics_pending: true,
      conversions_complete: true,
      data_incomplete: false,
    });

    await controller.getRedditKeywords(buildReq({ query: { project: 'tlf', window: 'last_7_days' } }), res, next);

    expect(getRedditAdsKeywords).toHaveBeenCalledWith(expect.anything(), 'tlf', 'last_7_days');
    expect(vi.mocked(res.json).mock.calls[0][0]).toMatchObject({ window: 'last_7_days', totalKeywords: 0, metricsPending: true });
  });

  it('refuses a window Reddit does not serve', async () => {
    isServerFeatureEnabled.mockReturnValue(true);

    await controller.getRedditKeywords(buildReq({ query: { project: 'tlf', window: 'last_14_days' } }), res, next);

    expectFieldError(next, 'window');
  });
});

describe('CampaignOptimizeController per-campaign reads', () => {
  it('reads settings with the campaign from the route and the brief from the query', async () => {
    getCampaignSettings.mockResolvedValue({ platform: 'meta-ads', diverged_count: 0, unknown_count: 1 });

    await controller.getCampaignSettings(buildReq({ params: { campaignId: CAMPAIGN }, query: { project: 'tlf', briefId: BRIEF } }), res, next);

    expect(getCampaignSettings).toHaveBeenCalledWith(expect.anything(), { projectSlug: 'tlf', briefId: BRIEF, campaignId: CAMPAIGN });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['campaignId', { campaignId: '123' }, { project: 'tlf', briefId: BRIEF }],
    ['briefId', { campaignId: CAMPAIGN }, { project: 'tlf', briefId: 'not-a-uuid' }],
    ['briefId', { campaignId: CAMPAIGN }, { project: 'tlf' }],
    ['project', { campaignId: CAMPAIGN }, { briefId: BRIEF }],
  ])('refuses a bad %s before any round trip', async (field, params, query) => {
    await controller.getKeywordTargeting(buildReq({ params, query }), res, next);

    expectFieldError(next, field);
    expect(getKeywordTargeting).not.toHaveBeenCalled();
  });

  it('lists Meta ad sets with a validated window', async () => {
    listMetaAdSets.mockResolvedValue({ ad_set_count: 0 });

    await controller.listMetaAdSets(buildReq({ params: { campaignId: CAMPAIGN }, query: { project: 'tlf', briefId: BRIEF, window: 'this_month' } }), res, next);
    expect(listMetaAdSets).toHaveBeenCalledWith(expect.anything(), { projectSlug: 'tlf', briefId: BRIEF, campaignId: CAMPAIGN }, 'this_month');

    await controller.listMetaAdSets(buildReq({ params: { campaignId: CAMPAIGN }, query: { project: 'tlf', briefId: BRIEF, window: 'forever' } }), res, next);
    expectFieldError(next, 'window');
  });
});

describe('CampaignOptimizeController.updateMetaAdSetStatus', () => {
  const params = { campaignId: CAMPAIGN, adSetId: '120210000000000888' };
  const body = { briefId: BRIEF, status: 'PAUSED', etag: '"4"' };

  it('passes the etag through for If-Match and answers the upstream result', async () => {
    updateMetaAdSetStatus.mockResolvedValue({ outcome: 'APPLIED', etag: '"4"' });

    await controller.updateMetaAdSetStatus(buildReq({ params, body }), res, next);

    expect(updateMetaAdSetStatus).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: BRIEF,
      campaignId: CAMPAIGN,
      adSetId: '120210000000000888',
      status: 'PAUSED',
      etag: '"4"',
    });
    expect(res.json).toHaveBeenCalledWith({ outcome: 'APPLIED', etag: '"4"' });
  });

  it.each([
    ['adSetId', { ...params, adSetId: '0123' }, body],
    ['adSetId', { ...params, adSetId: '1/2' }, body],
    ['status', params, { ...body, status: 'paused' }],
    ['etag', params, { ...body, etag: '' }],
    ['etag', params, { ...body, etag: '"4"\r\nX: y' }],
    ['briefId', params, { ...body, briefId: 'b-1' }],
    ['body', params, [body]],
  ])('refuses a bad %s before any round trip', async (field, p, b) => {
    await controller.updateMetaAdSetStatus(buildReq({ params: p, body: b }), res, next);

    expectFieldError(next, field);
    expect(updateMetaAdSetStatus).not.toHaveBeenCalled();
  });
});

describe('CampaignOptimizeController.adoptCampaign', () => {
  const body = { briefId: BRIEF, platform: 'reddit-ads', platformCampaignId: 't2_abc123' };

  it('answers 201 with the adopted row', async () => {
    adoptCampaign.mockResolvedValue({ id: CAMPAIGN, etag: '"1"' });

    await controller.adoptCampaign(buildReq({ body }), res, next);

    expect(adoptCampaign).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: BRIEF,
      platform: 'reddit-ads',
      platformCampaignId: 't2_abc123',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: CAMPAIGN, etag: '"1"' });
  });

  it('accepts LinkedIn now that campaign-service adopts it', async () => {
    adoptCampaign.mockResolvedValue({ id: CAMPAIGN });

    await controller.adoptCampaign(buildReq({ body: { ...body, platform: 'linkedin-ads', platformCampaignId: '123456' } }), res, next);

    expect(adoptCampaign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ platform: 'linkedin-ads', platformCampaignId: '123456' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it.each([
    ['platform', { ...body, platform: 'google-ads' }],
    ['platform', { ...body, platform: 'hubspot' }],
    ['platformCampaignId', { ...body, platformCampaignId: ' 123' }],
    ['platformCampaignId', { ...body, platformCampaignId: 'x'.repeat(65) }],
  ])('refuses a bad %s', async (field, b) => {
    await controller.adoptCampaign(buildReq({ body: b }), res, next);

    expectFieldError(next, field);
    expect(adoptCampaign).not.toHaveBeenCalled();
  });
});

describe('CampaignOptimizeController.removeKeywordTargeting', () => {
  const params = { campaignId: CAMPAIGN };

  it('sends Reddit keywords verbatim with the revision', async () => {
    removeKeywordTargeting.mockResolvedValue({ applied_count: 1 });

    await controller.removeKeywordTargeting(
      buildReq({ params, body: { briefId: BRIEF, keywords: [{ keyword: ' Cloud ' }], revision: 'sha256:abc' } }),
      res,
      next
    );

    expect(removeKeywordTargeting).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: BRIEF,
      campaignId: CAMPAIGN,
      keywords: [{ keyword: ' Cloud ' }],
      revision: 'sha256:abc',
    });
  });

  it('sends X criterion ids with no revision', async () => {
    removeKeywordTargeting.mockResolvedValue({ applied_count: 1 });

    await controller.removeKeywordTargeting(buildReq({ params, body: { briefId: BRIEF, keywords: [{ criterionId: '2kzxf' }] } }), res, next);

    expect(removeKeywordTargeting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keywords: [{ criterionId: '2kzxf' }], revision: undefined })
    );
  });

  it.each([
    ['keywords', { briefId: BRIEF, keywords: [] }],
    ['keywords', { briefId: BRIEF, keywords: Array.from({ length: MAX_KEYWORD_TARGETING_REMOVALS + 1 }, () => ({ keyword: 'k' })) }],
    ['keywords[0]', { briefId: BRIEF, keywords: [{ keyword: 'k', criterionId: '1' }] }],
    ['keywords[0]', { briefId: BRIEF, keywords: [{ keyword: '   ' }] }],
    ['keywords[0]', { briefId: BRIEF, keywords: [{ criterionId: '../x' }] }],
    ['keywords[1]', { briefId: BRIEF, keywords: [{ keyword: 'k' }, { criterionId: '1' }] }],
    ['revision', { briefId: BRIEF, keywords: [{ keyword: 'k' }], revision: '' }],
  ])('refuses a bad %s before any round trip', async (field, body) => {
    await controller.removeKeywordTargeting(buildReq({ params, body }), res, next);

    expectFieldError(next, field);
    expect(removeKeywordTargeting).not.toHaveBeenCalled();
  });
});

describe('CampaignOptimizeController.getCampaignRecord', () => {
  it('answers the row with whether this deployment can toggle it', async () => {
    getCampaign.mockResolvedValue({ id: CAMPAIGN, platform: 'linkedin-ads', etag: '"4"' });
    isServerFeatureEnabled.mockImplementation((flag) => flag === ServerFeatureFlag.CampaignServiceStatusToggle);

    await controller.getCampaignRecord(buildReq({ params: { campaignId: CAMPAIGN }, query: { project: 'tlf', briefId: BRIEF } }), res, next);

    expect(getCampaign).toHaveBeenCalledWith(expect.anything(), { projectSlug: 'tlf', briefId: BRIEF, campaignId: CAMPAIGN });
    expect(res.json).toHaveBeenCalledWith({ campaign: { id: CAMPAIGN, platform: 'linkedin-ads', etag: '"4"' }, statusToggleEnabled: true });
  });

  it.each([
    ['campaignId', { campaignId: 'not-a-uuid' }, { project: 'tlf', briefId: BRIEF }],
    ['briefId', { campaignId: CAMPAIGN }, { project: 'tlf', briefId: 'nope' }],
    ['project', { campaignId: CAMPAIGN }, { project: ' ', briefId: BRIEF }],
  ])('refuses a bad %s before any upstream call', async (field, params, query) => {
    await controller.getCampaignRecord(buildReq({ params, query }), res, next);

    expectFieldError(next, field);
    expect(getCampaign).not.toHaveBeenCalled();
  });

  it('hands an upstream failure to the error middleware', async () => {
    const failure = new Error('upstream');
    getCampaign.mockRejectedValue(failure);

    await controller.getCampaignRecord(buildReq({ params: { campaignId: CAMPAIGN }, query: { project: 'tlf', briefId: BRIEF } }), res, next);

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('CampaignOptimizeController.listAdoptableBriefs', () => {
  it('answers 404 while campaign-service briefs are OFF', async () => {
    await controller.listAdoptableBriefs(buildReq({}), res, next);

    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(listAdoptableBriefs).not.toHaveBeenCalled();
  });

  it('lists the briefs once the flag is ON, and requires a project', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag === ServerFeatureFlag.CampaignServiceBriefs);
    listAdoptableBriefs.mockResolvedValue([{ id: BRIEF, eventSlug: 'kubecon', programType: 'events', platforms: [] }]);

    await controller.listAdoptableBriefs(buildReq({ query: { project: ' tlf ' } }), res, next);
    expect(listAdoptableBriefs).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(res.json).toHaveBeenCalledWith({ briefs: [{ id: BRIEF, eventSlug: 'kubecon', programType: 'events', platforms: [] }] });

    await controller.listAdoptableBriefs(buildReq({ query: {} }), res, next);
    expectFieldError(next, 'project');
    expect(listAdoptableBriefs).toHaveBeenCalledTimes(1);
  });
});
