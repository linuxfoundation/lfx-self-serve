// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, logger } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({ logger }));

import type { Request } from 'express';

import { ServiceValidationError } from '../errors/service-validation.error';
import { CampaignOptimizeService } from './campaign-optimize.service';

const req = {} as unknown as Request;
const ref = { projectSlug: 'tlf', briefId: 'b-1', campaignId: 'c-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CampaignOptimizeService.getPlatformAudience', () => {
  it.each([
    ['meta-ads', '/projects/tlf/meta-ads/audience'],
    ['twitter-ads', '/projects/tlf/twitter-ads/audience'],
    ['microsoft-ads', '/projects/tlf/microsoft-ads/audience'],
    ['reddit-ads', '/projects/tlf/reddit-ads/audience'],
    ['linkedin-ads', '/projects/tlf/linkedin-ads/audience'],
  ] as const)('GETs the %s audience read with the window as a QUERY parameter', async (platform, path) => {
    proxyRequest.mockResolvedValueOnce({ window: 'today', buckets: [], bucket_count: 0 });

    await new CampaignOptimizeService().getPlatformAudience(req, 'tlf', platform, 'today');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', path, 'GET', { window: 'today' });
  });

  it('encodes the project and sends no window when none is named', async () => {
    proxyRequest.mockResolvedValueOnce({ window: 'last_30_days', buckets: [], bucket_count: 0 });

    await new CampaignOptimizeService().getPlatformAudience(req, 'a b/c', 'meta-ads');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/a%20b%2Fc/meta-ads/audience', 'GET', undefined);
  });

  it('refuses an empty project and an unknown platform without calling the proxy', async () => {
    const service = new CampaignOptimizeService();
    await expect(service.getPlatformAudience(req, '', 'meta-ads')).rejects.toBeInstanceOf(ServiceValidationError);
    // @ts-expect-error -- a platform outside the table must not reach the proxy even if a caller bug passes one.
    await expect(service.getPlatformAudience(req, 'tlf', 'google-ads')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});

describe('CampaignOptimizeService.resolvePlatformCampaign', () => {
  it('GETs the platform campaign-ref with the id as a QUERY parameter', async () => {
    proxyRequest.mockResolvedValueOnce({ platform_campaign_id: '120210000000000001', matches: [], match_count: 0 });

    await new CampaignOptimizeService().resolvePlatformCampaign(req, 'tlf', 'meta-ads', '120210000000000001');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/meta-ads/campaign-ref', 'GET', {
      platform_campaign_id: '120210000000000001',
    });
  });

  it.each([
    ['meta-ads', '0123'],
    ['twitter-ads', 'abc_1'],
    ['reddit-ads', 'a-b'],
    ['linkedin-ads', 'urn:li:1'],
  ] as const)('refuses a %s id outside the platform id rule (%s) without calling the proxy', async (platform, id) => {
    await expect(new CampaignOptimizeService().resolvePlatformCampaign(req, 'tlf', platform, id)).rejects.toBeInstanceOf(ServiceValidationError);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});

describe('CampaignOptimizeService.getRedditAdsKeywords', () => {
  it('GETs the Reddit keyword read with the window as a QUERY parameter', async () => {
    proxyRequest.mockResolvedValueOnce({ window: 'last_7_days', rows: [] });

    await new CampaignOptimizeService().getRedditAdsKeywords(req, 'cncf', 'last_7_days');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/reddit-ads/keywords', 'GET', { window: 'last_7_days' });
  });

  it('refuses an empty project', async () => {
    await expect(new CampaignOptimizeService().getRedditAdsKeywords(req, '')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});

describe('CampaignOptimizeService per-campaign reads', () => {
  it('GETs the settings readback under the encoded campaign path', async () => {
    proxyRequest.mockResolvedValueOnce({ campaign_id: 'c-1', fields: [] });

    await new CampaignOptimizeService().getCampaignSettings(req, { projectSlug: 'a/b', briefId: 'c d', campaignId: 'e?f' });

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/a%2Fb/briefs/c%20d/campaigns/e%3Ff/settings', 'GET');
  });

  it('GETs the Meta ad sets with the window as a QUERY parameter', async () => {
    proxyRequest.mockResolvedValueOnce({ campaign_id: 'c-1', ad_sets: [], ad_set_count: 0 });

    await new CampaignOptimizeService().listMetaAdSets(req, ref, 'last_7_days');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1/campaigns/c-1/meta-ad-sets', 'GET', {
      window: 'last_7_days',
    });
  });

  it('GETs the keyword targeting', async () => {
    proxyRequest.mockResolvedValueOnce({ campaign_id: 'c-1', platform: 'reddit-ads', targeting_entity_id: 't', keywords: [] });

    await new CampaignOptimizeService().getKeywordTargeting(req, ref);

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1/campaigns/c-1/keyword-targeting', 'GET');
  });
});
