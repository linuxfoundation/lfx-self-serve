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
  CAMPAIGN_AUDIENCE_CONFLICT_CODE,
  CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE,
  CAMPAIGN_AUDIENCE_FAILED_MESSAGE,
  CAMPAIGN_AUDIENCE_LOGGED_UPSTREAM_MESSAGE_MAX_LENGTH,
  CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE,
  CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE,
  CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE,
  CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE,
  CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE,
  CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ETAG_REQUIRED_CODE,
  CAMPAIGN_ETAG_REQUIRED_MESSAGE,
  CAMPAIGN_ETAG_STALE_CODE,
  CAMPAIGN_ETAG_STALE_MESSAGE,
  KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
  META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED,
  META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE,
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

describe('CampaignOptimizeService.getPlatformAudience failures', () => {
  async function failureFor(error: unknown): Promise<MicroserviceError> {
    proxyRequest.mockRejectedValueOnce(error);
    const caught = await new CampaignOptimizeService().getPlatformAudience(req, 'tlf', 'linkedin-ads').catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(MicroserviceError);
    return caught as MicroserviceError;
  }

  it.each([
    [404, 'no linkedin ads connection configured for this project', CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE, CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE],
    [
      409,
      'the campaign was created under ad account 123 but the connection is bound to 456',
      CAMPAIGN_AUDIENCE_CONFLICT_CODE,
      CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE,
    ],
    [503, 'linkedin answered 429: rate limited (retry-after 30)', CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE, CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE],
    [400, 'keyword and audience insights are not supported for this platform', CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE, CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE],
  ])('maps an answered %i to its own code and a fixed message, never the upstream sentence', async (status, upstreamText, code, message) => {
    const error = await failureFor(upstreamError(status, upstreamText));

    expect(error.statusCode).toBe(status);
    const body = error.toResponse();
    expect(body).toMatchObject({ code, error: message });
    expect(JSON.stringify(body)).not.toContain(upstreamText);
  });

  it("maps Reddit's 409 for mixed provenance (a foreign campaign and one recording no account) to the generic conflict message, which names both causes", async () => {
    proxyRequest.mockRejectedValueOnce(
      upstreamError(
        409,
        'campaign t2_abc was created under another ad account, and campaign t2_def does not record which ad account it was created under: reconnect the right account, or re-dispatch the campaign'
      )
    );
    const error = (await new CampaignOptimizeService().getPlatformAudience(req, 'tlf', 'reddit-ads').catch((e: unknown) => e)) as MicroserviceError;

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/reddit-ads/audience', 'GET', undefined);
    expect(error.toResponse()).toMatchObject({ code: CAMPAIGN_AUDIENCE_CONFLICT_CODE, error: CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE });
    expect(CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE).toContain('another ad account');
    expect(CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE).toContain("doesn't record its account");
    expect(JSON.stringify(error.toResponse())).not.toContain('t2_abc');
  });

  it.each([
    ['an answered 500', upstreamError(500, 'pq: connection refused at 10.0.0.1')],
    ['an unanswered gateway 503', gatewayError(503)],
    ['a transport failure', transportError()],
  ])('gives %s the generic message and keeps its status', async (_label, raw) => {
    const error = await failureFor(raw);

    expect(error.statusCode).toBe(raw.statusCode);
    expect(error.toResponse()['error']).toBe(CAMPAIGN_AUDIENCE_FAILED_MESSAGE);
    expect(error.toResponse()['code']).not.toBe(CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE);
  });

  it('logs the upstream 400 sentence at DEBUG, bounded, while answering NOT_ENABLED', async () => {
    const upstreamText = `connection inactive ${'x'.repeat(500)}`;
    await failureFor(upstreamError(400, upstreamText));

    const call = logger.debug.mock.calls.find((args: unknown[]) => String(args[2]).includes('400')) as unknown[] | undefined;
    expect(call).toBeDefined();
    const fields = call?.[3] as { platform: string; upstream_message: string };
    expect(fields.platform).toBe('linkedin-ads');
    expect(fields.upstream_message.startsWith('connection inactive')).toBe(true);
    expect(fields.upstream_message).toHaveLength(CAMPAIGN_AUDIENCE_LOGGED_UPSTREAM_MESSAGE_MAX_LENGTH);
    expect(logger.warning).not.toHaveBeenCalled();
  });

  it.each([
    ['the LinkedIn campaign cap', 'linkedin-ads', 'this project has 11 linkedin campaigns; the audience read covers at most 10'],
    ['a malformed stored Reddit id', 'reddit-ads', 'campaign c-9 stores an invalid reddit campaign id'],
    ['an unrecorded account', 'reddit-ads', 'campaign t2_def does not record which ad account it was created under; re-dispatch it'],
  ] as const)('answers %s (409, no reason) with the GENERIC conflict, logging the upstream sentence at DEBUG', async (_label, platform, upstreamText) => {
    proxyRequest.mockRejectedValueOnce(upstreamError(409, upstreamText));
    const error = (await new CampaignOptimizeService().getPlatformAudience(req, 'tlf', platform).catch((e: unknown) => e)) as MicroserviceError;

    expect(error.toResponse()).toMatchObject({ code: CAMPAIGN_AUDIENCE_CONFLICT_CODE, error: CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE });
    expect(JSON.stringify(error.toResponse())).not.toContain(upstreamText);
    const call = logger.debug.mock.calls.find((args: unknown[]) => String(args[2]).includes('409')) as unknown[] | undefined;
    expect(call?.[3]).toMatchObject({ status: 409, platform, upstream_message: upstreamText });
  });

  it('does not log an upstream sentence for a 400 nobody answered, or for another status', async () => {
    await failureFor(gatewayError(400));
    await failureFor(upstreamError(404, 'no linkedin ads connection'));

    expect(logger.debug.mock.calls.some((args: unknown[]) => String(args[2]).includes('answering a fixed message'))).toBe(false);
  });

  it('passes a non-microservice error through untouched', async () => {
    const raw = new Error('boom');
    proxyRequest.mockRejectedValueOnce(raw);
    await expect(new CampaignOptimizeService().getPlatformAudience(req, 'tlf', 'meta-ads')).rejects.toBe(raw);
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

describe('CampaignOptimizeService.resolvePlatformCampaign LinkedIn int64 range', () => {
  it('accepts the int64 maximum', async () => {
    proxyRequest.mockResolvedValueOnce({ platform_campaign_id: '9223372036854775807', matches: [], match_count: 0 });

    await new CampaignOptimizeService().resolvePlatformCampaign(req, 'tlf', 'linkedin-ads', '9223372036854775807');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/linkedin-ads/campaign-ref', 'GET', {
      platform_campaign_id: '9223372036854775807',
    });
  });

  it.each(['9223372036854775808', '9999999999999999999'])('refuses %s, past int64, without calling the proxy', async (id) => {
    await expect(new CampaignOptimizeService().resolvePlatformCampaign(req, 'tlf', 'linkedin-ads', id)).rejects.toBeInstanceOf(ServiceValidationError);
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

  it("GETs one ad set's Meta ads under the encoded ad-set path, with the window as a QUERY parameter", async () => {
    const data = { ad_set_id: '888', ads: [], ad_count: 0, truncated: false };
    proxyRequest.mockResolvedValueOnce(data);

    const result = await new CampaignOptimizeService().listMetaAds(req, { ...ref, adSetId: '888' }, 'this_month');

    expect(result).toBe(data);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1/campaigns/c-1/meta-ad-sets/888/ads', 'GET', {
      window: 'this_month',
    });
  });

  it('GETs the Meta ads with no query when no window is given, and lets a failure through', async () => {
    const failure = upstreamError(409, 'The ad set does not belong to this campaign.');
    proxyRequest.mockRejectedValueOnce(failure);

    await expect(new CampaignOptimizeService().listMetaAds(req, { ...ref, adSetId: '888' })).rejects.toBe(failure);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1/campaigns/c-1/meta-ad-sets/888/ads', 'GET', undefined);
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

  it.each([
    'the ad set WAS paused on Meta, but whether that was recorded on the campaign could not be confirmed: read the ad sets (deliberately_paused); if it is not shown, a campaign resume would re-activate it; pause it here again',
    "the ad set is already paused on Meta (nothing was sent), but this request lost the campaign's write lock while recording that, so whether the deliberate-pause record is on the campaign could not be confirmed: read the ad sets (deliberately_paused) before retrying; if it is not shown, pause it here again",
  ])('surfaces an answered 503 whose pause RECORD could not be confirmed as its own code: %s', async (message) => {
    const error = await failureFor(upstreamError(503, message));
    expect(error.statusCode).toBe(503);
    expect(error.toResponse()).toMatchObject({ code: META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE, error: META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED });
  });

  it('does not read a record-unconfirmed sentence off an UNANSWERED 503', async () => {
    const raw = new MicroserviceError('could not be confirmed', 503, 'SERVICE_UNAVAILABLE', { errorBody: { message: 'could not be confirmed' } });
    const error = await failureFor(raw);
    expect(error.toResponse()['code']).toBe(META_AD_SET_STATUS_UNCONFIRMED_CODE);
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

describe('CampaignOptimizeService.getCampaign', () => {
  it('GETs the campaign row and takes the ETag from the header', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(
      apiResponse({ id: 'c-1', platform: 'reddit-ads', status: 'active', version: 4, etag: '"3"' }, { etag: '"4"' })
    );

    const result = await new CampaignOptimizeService().getCampaign(req, ref);

    expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1/campaigns/c-1', 'GET');
    expect(result.etag).toBe('"4"');
  });

  it('falls back to the body ETag when the header is absent', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', etag: '"3"' }));

    expect((await new CampaignOptimizeService().getCampaign(req, ref)).etag).toBe('"3"');
  });

  // lfx-v2-campaign-service#366: `adopted` is `true` or absent; only a literal `true` is carried.
  it.each([
    [true, true],
    ['true', undefined],
    [false, undefined],
  ])('carries adopted %s as %s', async (sent, expected) => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', etag: '"3"', adopted: sent }));

    const result = await new CampaignOptimizeService().getCampaign(req, ref);

    expect(result.adopted).toBe(expected);
    expect('adopted' in result).toBe(expected === true);
  });
});

describe('CampaignOptimizeService.listAdoptableBriefs', () => {
  const page = (data: unknown[]) => ({ resources: data.map((d) => ({ type: 'campaign_brief', id: 'x', data: d })) });

  it('reads campaign_brief and keeps approved paid briefs: absent and paid-marketing included, email excluded', async () => {
    proxyRequest.mockResolvedValueOnce(
      page([
        { id: 'b-1', event_slug: 'kubecon', program_type: 'events', delivery_type: 'paid-marketing', status: 'approved', platforms: ['linkedin-ads', 7] },
        { id: 'b-2', event_slug: 'legacy', status: 'approved' },
        { id: 'b-3', event_slug: 'draft', delivery_type: 'paid-marketing', status: 'draft' },
        { id: 'b-4', event_slug: 'mail', delivery_type: 'email', status: 'approved' },
        { event_slug: 'no-id', status: 'approved' },
      ])
    );

    const briefs = await new CampaignOptimizeService().listAdoptableBriefs(req, 'tlf');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', { type: 'campaign_brief', parent: 'project:tlf' });
    // campaign-service's BriefDoc contract: an ABSENT delivery_type predates the widening and means
    // paid-marketing; email briefs always publish theirs.
    expect(briefs).toEqual([
      { id: 'b-1', eventSlug: 'kubecon', programType: 'events', platforms: ['linkedin-ads'] },
      { id: 'b-2', eventSlug: 'legacy', programType: '', platforms: [] },
    ]);
  });

  it('refuses an empty project without calling the Query Service', async () => {
    await expect(new CampaignOptimizeService().listAdoptableBriefs(req, '')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});
