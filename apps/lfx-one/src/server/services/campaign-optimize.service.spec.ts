// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, proxyRequestWithResponse, logger } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('./logger.service', () => ({ logger }));

import {
  CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
  CAMPAIGN_ETAG_REQUIRED_CODE,
  CAMPAIGN_ETAG_REQUIRED_MESSAGE,
  CAMPAIGN_ETAG_STALE_CODE,
  CAMPAIGN_ETAG_STALE_MESSAGE,
  KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
  META_AD_SET_STATUS_OUTCOME_UNCONFIRMED,
  META_AD_SET_STATUS_UNCONFIRMED_CODE,
} from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import { CampaignOptimizeService } from './campaign-optimize.service';

const req = {} as unknown as Request;
const ref = { projectSlug: 'tlf', briefId: 'b-1', campaignId: 'c-1' };

function apiResponse<T>(data: T, headers: Record<string, string> = {}): { data: T; status: number; statusText: string; headers: Record<string, string> } {
  return { data, status: 200, statusText: 'OK', headers };
}

/** A campaign-service answer: its own Goa envelope, whose `code` is the status as a string. */
function upstreamError(status: number, message: string): MicroserviceError {
  return new MicroserviceError(message, status, 'UPSTREAM', { errorBody: { code: String(status), message } });
}

/** A failure campaign-service never answered: the BFF's own transport error. */
function transportError(): MicroserviceError {
  return new MicroserviceError('fetch failed', 503, 'NETWORK_ERROR', { originalError: new Error('ECONNRESET'), transportFailure: true });
}

/** A gateway error page: a real status, no campaign-service envelope. */
function gatewayError(status: number): MicroserviceError {
  return new MicroserviceError('Bad Gateway', status, 'BAD_GATEWAY', { errorBody: { message: 'Service Unavailable' } });
}

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

describe('CampaignOptimizeService.updateMetaAdSetStatus', () => {
  const args = { ...ref, adSetId: '120210000000000888', status: 'PAUSED' as const, etag: '"3"' };

  async function failureFor(error: unknown): Promise<MicroserviceError> {
    proxyRequestWithResponse.mockRejectedValueOnce(error);
    const caught = await new CampaignOptimizeService().updateMetaAdSetStatus(req, args).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(MicroserviceError);
    return caught as MicroserviceError;
  }

  it('POSTs the status as the BODY with the etag as If-Match', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ campaign_id: 'c-1', outcome: 'APPLIED' }, { etag: '"3"' }));

    await new CampaignOptimizeService().updateMetaAdSetStatus(req, args);

    const call = proxyRequestWithResponse.mock.calls[0];
    expect(call[2]).toBe('/projects/tlf/briefs/b-1/campaigns/c-1/meta-ad-sets/120210000000000888/status');
    expect(call[3]).toBe('POST');
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ status: 'PAUSED' });
    expect(call[6]).toEqual({ 'If-Match': '"3"' });
  });

  it('returns the ETag header as the result etag, over any body value', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ campaign_id: 'c-1', outcome: 'ALREADY_IN_STATE', etag: 'body' }, { etag: '"3"' }));

    const result = await new CampaignOptimizeService().updateMetaAdSetStatus(req, args);

    expect(result.etag).toBe('"3"');
    expect(result.outcome).toBe('ALREADY_IN_STATE');
  });

  it('maps an answered 412 to PRECONDITION_FAILED with a fixed message', async () => {
    const error = await failureFor(upstreamError(412, 'etag mismatch'));
    expect(error.statusCode).toBe(412);
    expect(error.toResponse()).toMatchObject({ code: CAMPAIGN_ETAG_STALE_CODE, error: CAMPAIGN_ETAG_STALE_MESSAGE });
  });

  it('maps an answered 428 to PRECONDITION_REQUIRED with a fixed message', async () => {
    const error = await failureFor(upstreamError(428, 'If-Match header required'));
    expect(error.statusCode).toBe(428);
    expect(error.toResponse()).toMatchObject({ code: CAMPAIGN_ETAG_REQUIRED_CODE, error: CAMPAIGN_ETAG_REQUIRED_MESSAGE });
  });

  it.each([412, 428])('reports an UNANSWERED %i (a gateway page, no campaign-service envelope) as UNCONFIRMED, not as a no-op', async (status) => {
    const error = await failureFor(gatewayError(status));
    expect(error.statusCode).toBe(status);
    expect(error.toResponse()).toMatchObject({ code: META_AD_SET_STATUS_UNCONFIRMED_CODE, error: META_AD_SET_STATUS_OUTCOME_UNCONFIRMED });
  });

  it('passes a 409 through with campaign-service’s own sentence', async () => {
    const message =
      "the ad set's status was changed on Meta, but this campaign was modified or deleted by another request meanwhile; read the ad sets before retrying";
    const error = await failureFor(upstreamError(409, message));
    expect(error.statusCode).toBe(409);
    expect(error.toResponse()['error']).toBe(message);
  });

  it.each([
    'the ad set status change is unconfirmed — it may or may not have been applied on Meta; read the ad sets before retrying',
    "the ad set's status was changed on Meta, but verifying the campaign row failed; read the ad sets before retrying",
  ])('surfaces an answered UNCONFIRMED-class 503 as its own code: %s', async (message) => {
    const error = await failureFor(upstreamError(503, message));
    expect(error.statusCode).toBe(503);
    expect(error.toResponse()).toMatchObject({ code: META_AD_SET_STATUS_UNCONFIRMED_CODE, error: META_AD_SET_STATUS_OUTCOME_UNCONFIRMED });
  });

  it('keeps a DEFINITE answered 503 as SERVICE_UNAVAILABLE-class with its own sentence', async () => {
    const message = "the ad set's status could not be changed; nothing was changed on Meta";
    const upstream = upstreamError(503, message);
    const error = await failureFor(upstream);
    expect(error).toBe(upstream);
    expect(error.toResponse()['error']).toBe(message);
  });

  it.each([
    ['a transport failure', transportError()],
    ['a gateway 502 with no campaign-service envelope', gatewayError(502)],
    ['a timeout', new MicroserviceError('timed out', 504, 'TIMEOUT')],
  ])('reports %s as UNCONFIRMED, keeping its status', async (_label, raw) => {
    const error = await failureFor(raw);
    expect(error.statusCode).toBe(raw.statusCode);
    expect(error.toResponse()).toMatchObject({ code: META_AD_SET_STATUS_UNCONFIRMED_CODE, error: META_AD_SET_STATUS_OUTCOME_UNCONFIRMED });
  });

  it('passes an unanswered 4xx (never dispatched) through', async () => {
    const raw = new MicroserviceError('Forbidden', 403, 'FORBIDDEN');
    expect(await failureFor(raw)).toBe(raw);
  });
});

describe('CampaignOptimizeService.adoptCampaign', () => {
  const args = { projectSlug: 'tlf', briefId: 'b-1', platform: 'meta-ads' as const, platformCampaignId: '120210000000000555' };

  it('POSTs the platform and id as the BODY and returns the row with the ETag header', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-9', platform: 'meta-ads', version: 1 }, { etag: '"1"' }));

    const result = await new CampaignOptimizeService().adoptCampaign(req, args);

    const call = proxyRequestWithResponse.mock.calls[0];
    expect(call[2]).toBe('/projects/tlf/briefs/b-1/campaigns/adopt');
    expect(call[3]).toBe('POST');
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ platform: 'meta-ads', platform_campaign_id: '120210000000000555' });
    expect(call[6]).toBeUndefined();
    expect(result.etag).toBe('"1"');
  });

  it('passes an answered refusal through and reports an unanswered failure as unconfirmed', async () => {
    const conflict = upstreamError(409, 'the brief already has a live campaign on that platform');
    proxyRequestWithResponse.mockRejectedValueOnce(conflict);
    await expect(new CampaignOptimizeService().adoptCampaign(req, args)).rejects.toBe(conflict);

    proxyRequestWithResponse.mockRejectedValueOnce(transportError());
    const caught = (await new CampaignOptimizeService().adoptCampaign(req, args).catch((e: unknown) => e)) as MicroserviceError;
    expect(caught.toResponse()['error']).toBe(CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED);
  });
});

describe('CampaignOptimizeService.removeKeywordTargeting', () => {
  const reddit = { ...ref, keywords: [{ keyword: 'kubernetes' }, { keyword: ' Cloud ' }], revision: 'sha256:abc' };

  it('POSTs Reddit keywords verbatim with the revision as the BODY', async () => {
    proxyRequest.mockResolvedValueOnce({
      campaign_id: 'c-1',
      results: [
        { keyword: 'kubernetes', outcome: 'APPLIED' },
        { keyword: ' Cloud ', outcome: 'APPLIED' },
      ],
      applied_count: 2,
    });

    await new CampaignOptimizeService().removeKeywordTargeting(req, reddit);

    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      '/projects/tlf/briefs/b-1/campaigns/c-1/keyword-targeting/removals',
      'POST',
      undefined,
      {
        keywords: [{ keyword: 'kubernetes' }, { keyword: ' Cloud ' }],
        revision: 'sha256:abc',
      }
    );
  });

  it('maps X criterion ids to criterion_id and sends no revision', async () => {
    proxyRequest.mockResolvedValueOnce({ campaign_id: 'c-1', results: [{ criterion_id: '2kzxf', outcome: 'APPLIED' }], applied_count: 1 });

    await new CampaignOptimizeService().removeKeywordTargeting(req, { ...ref, keywords: [{ criterionId: '2kzxf' }] });

    expect(proxyRequest.mock.calls[0][5]).toEqual({ keywords: [{ criterion_id: '2kzxf' }] });
  });

  it('accepts a result that also carries the other platform’s field, comparing only the field the request used', async () => {
    proxyRequest.mockResolvedValueOnce({
      campaign_id: 'c-1',
      results: [{ criterion_id: '2kzxf', keyword: 'kubernetes', outcome: 'APPLIED' }],
      applied_count: 1,
    });

    const result = await new CampaignOptimizeService().removeKeywordTargeting(req, { ...ref, keywords: [{ criterionId: '2kzxf' }] });

    expect(result.applied_count).toBe(1);
  });

  it('refuses X results whose criterion ids come back in a different order', async () => {
    proxyRequest.mockResolvedValueOnce({
      campaign_id: 'c-1',
      results: [
        { criterion_id: 'b2', outcome: 'APPLIED' },
        { criterion_id: 'a1', outcome: 'FAILED' },
      ],
      applied_count: 1,
    });

    const caught = (await new CampaignOptimizeService()
      .removeKeywordTargeting(req, { ...ref, keywords: [{ criterionId: 'a1' }, { criterionId: 'b2' }] })
      .catch((e: unknown) => e)) as MicroserviceError;

    expect(caught.statusCode).toBe(502);
    expect(caught.toResponse()['code']).toBe(KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE);
  });

  it.each([
    [
      'another campaign',
      {
        campaign_id: 'c-2',
        results: [
          { keyword: 'kubernetes', outcome: 'APPLIED' },
          { keyword: ' Cloud ', outcome: 'APPLIED' },
        ],
        applied_count: 2,
      },
    ],
    ['a short result set', { campaign_id: 'c-1', results: [{ keyword: 'kubernetes', outcome: 'APPLIED' }], applied_count: 1 }],
    [
      'a reordered result set',
      {
        campaign_id: 'c-1',
        results: [
          { keyword: ' Cloud ', outcome: 'APPLIED' },
          { keyword: 'kubernetes', outcome: 'APPLIED' },
        ],
        applied_count: 2,
      },
    ],
    [
      'a substituted keyword',
      {
        campaign_id: 'c-1',
        results: [
          { keyword: 'kubernetes', outcome: 'APPLIED' },
          { keyword: 'cloud', outcome: 'APPLIED' },
        ],
        applied_count: 2,
      },
    ],
    ['an entry naming nothing', { campaign_id: 'c-1', results: [{ keyword: 'kubernetes', outcome: 'APPLIED' }, { outcome: 'APPLIED' }], applied_count: 2 }],
    ['no results array', { campaign_id: 'c-1', applied_count: 0 }],
  ])('refuses a 2xx naming %s as unconfirmed', async (_label, body) => {
    proxyRequest.mockResolvedValueOnce(body);

    const caught = (await new CampaignOptimizeService().removeKeywordTargeting(req, reddit).catch((e: unknown) => e)) as MicroserviceError;

    expect(caught).toBeInstanceOf(MicroserviceError);
    expect(caught.statusCode).toBe(502);
    expect(caught.toResponse()).toMatchObject({ code: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE, error: KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED });
  });

  it('surfaces an answered unconfirmed 503 as its own code, and keeps a definite one', async () => {
    proxyRequest.mockRejectedValueOnce(
      upstreamError(
        503,
        'the keyword removals are unconfirmed — they may or may not have been applied on the ad platform; read the keyword targeting again before retrying'
      )
    );
    const unconfirmed = (await new CampaignOptimizeService().removeKeywordTargeting(req, reddit).catch((e: unknown) => e)) as MicroserviceError;
    expect(unconfirmed.toResponse()['code']).toBe(KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE);

    const definite = upstreamError(503, 'the keywords could not be removed');
    proxyRequest.mockRejectedValueOnce(definite);
    await expect(new CampaignOptimizeService().removeKeywordTargeting(req, reddit)).rejects.toBe(definite);
  });
});
