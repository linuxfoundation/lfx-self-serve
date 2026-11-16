// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignServiceGoogleAdsGeoTargetSuggestions } from '@lfx-one/shared/interfaces';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The Implement tab's location picker route (campaign-service #411), behind
// LFX_CUTOVER_CAMPAIGN_SERVICE_GOOGLE_GEO_SEARCH and the create cutover. Kept out of
// campaign.controller.spec.ts for the reason the monitor routes are: that file is already long.
const { svcSuggest, isServerFeatureEnabled, logger } = vi.hoisted(() => ({
  svcSuggest: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public suggestGoogleAdsGeoTargets = svcSuggest;
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
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkRootWriter: vi.fn(), checkRootCampaignManager: vi.fn() } }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

const CUTOVER_FLAGS = [ServerFeatureFlag.CampaignServiceCreate, ServerFeatureFlag.CampaignServiceBriefs, ServerFeatureFlag.CampaignServiceJobs];

/** Turn the create cutover and the geo-search flag on or off independently. */
function flags(cutover: boolean, geoSearch: boolean): void {
  isServerFeatureEnabled.mockImplementation((flag) => {
    if (flag === ServerFeatureFlag.CampaignServiceGoogleGeoSearch) return geoSearch;
    return (CUTOVER_FLAGS as unknown[]).includes(flag) ? cutover : false;
  });
}

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/api/campaigns/google/geo-targets' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function nextError(next: NextFunction): unknown {
  return vi.mocked(next).mock.calls[0]?.[0];
}

const AUSTIN: CampaignServiceGoogleAdsGeoTargetSuggestions = {
  suggestions: [
    {
      id: '1026201',
      name: 'Austin',
      canonical_name: 'Austin,Texas,United States',
      country_code: 'US',
      target_type: 'City',
      status: 'ENABLED',
      reach: 2100000,
    },
    { id: '9031945', name: '78701', canonical_name: '78701,Texas,United States', country_code: 'US', target_type: 'Postal Code', status: 'ENABLED' },
  ],
  suggestion_count: 2,
  truncated: true,
};

describe('CampaignController.searchGoogleAdsGeoTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags(true, true);
  });

  /** An older campaign-service has no suggest route, and the legacy road cannot send a postal id. */
  it.each([
    ['the geo-search flag is off', true, false],
    ['the create cutover is dark', false, true],
    ['both are off', false, false],
  ])('answers 404 when %s, calling nothing', async (_label, cutover, geoSearch) => {
    flags(cutover, geoSearch);
    const next = vi.fn();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: 'tlf', q: 'Austin' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svcSuggest).not.toHaveBeenCalled();
  });

  it("maps campaign-service's suggestions onto the camelCase shape, keeping reach only when sent", async () => {
    svcSuggest.mockResolvedValueOnce(AUSTIN);
    const res = buildRes();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: ' tlf ', q: '  Austin ' }), res, vi.fn());

    expect(svcSuggest).toHaveBeenCalledWith(expect.anything(), 'tlf', { q: 'Austin' });
    expect(res.json).toHaveBeenCalledWith({
      suggestions: [
        {
          id: '1026201',
          name: 'Austin',
          canonicalName: 'Austin,Texas,United States',
          countryCode: 'US',
          targetType: 'City',
          status: 'ENABLED',
          reach: 2100000,
        },
        { id: '9031945', name: '78701', canonicalName: '78701,Texas,United States', countryCode: 'US', targetType: 'Postal Code', status: 'ENABLED' },
      ],
      truncated: true,
    });
  });

  it('forwards a country, repeated location types and a limit under the names upstream reads', async () => {
    svcSuggest.mockResolvedValueOnce({ suggestions: [], suggestion_count: 0, truncated: false });

    await new CampaignController().searchGoogleAdsGeoTargets(
      buildReq({ project: 'tlf', q: '78701', countryCode: 'us', targetTypes: ['Postal Code', ' City '], limit: '20' }),
      buildRes(),
      vi.fn()
    );

    expect(svcSuggest).toHaveBeenCalledWith(expect.anything(), 'tlf', { q: '78701', country_code: 'US', target_types: ['Postal Code', 'City'], limit: 20 });
  });

  it('reads a single location type sent once as a string', async () => {
    svcSuggest.mockResolvedValueOnce({ suggestions: [], suggestion_count: 0, truncated: false });

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: 'tlf', q: '78701', targetTypes: 'Postal Code' }), buildRes(), vi.fn());

    expect(svcSuggest).toHaveBeenCalledWith(expect.anything(), 'tlf', { q: '78701', target_types: ['Postal Code'] });
  });

  /** Each of upstream's own bounds, refused by name here rather than as a Goa validation error. */
  it.each([
    ['no project', { q: 'Austin' }, 'project'],
    ['a blank query', { project: 'tlf', q: '   ' }, 'q'],
    ['no query', { project: 'tlf' }, 'q'],
    ['a query over 100 characters', { project: 'tlf', q: 'a'.repeat(101) }, 'q'],
    ['a three-letter country', { project: 'tlf', q: 'Austin', countryCode: 'USA' }, 'countryCode'],
    ['eleven location types', { project: 'tlf', q: 'Austin', targetTypes: Array.from({ length: 11 }, (_, i) => `Type${i}`) }, 'targetTypes'],
    ['a location type with no letter or digit', { project: 'tlf', q: 'Austin', targetTypes: ['--'] }, 'targetTypes'],
    ['a location type over 40 characters', { project: 'tlf', q: 'Austin', targetTypes: ['x'.repeat(41)] }, 'targetTypes'],
    ['an object for location types', { project: 'tlf', q: 'Austin', targetTypes: { a: 'City' } }, 'targetTypes'],
    ['a zero limit', { project: 'tlf', q: 'Austin', limit: '0' }, 'limit'],
    ['a limit over 50', { project: 'tlf', q: 'Austin', limit: '51' }, 'limit'],
    ['a fractional limit', { project: 'tlf', q: 'Austin', limit: '2.5' }, 'limit'],
  ])('refuses %s with a 400 naming the field', async (_label, query, field) => {
    const next = vi.fn();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq(query), buildRes(), next);

    const error = nextError(next) as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.validationErrors[0].field).toBe(field);
    expect(svcSuggest).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 characters and exactly 50 results, which upstream accepts', async () => {
    svcSuggest.mockResolvedValueOnce({ suggestions: [], suggestion_count: 0, truncated: false });
    const next = vi.fn();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: 'tlf', q: 'a'.repeat(100), limit: '50' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(svcSuggest).toHaveBeenCalledWith(expect.anything(), 'tlf', { q: 'a'.repeat(100), limit: 50 });
  });

  /** A row whose id cannot be a `geoTargets` entry is dropped, not offered for a pick that would fail. */
  it('drops a suggestion whose id is not a canonical geo target constant id', async () => {
    svcSuggest.mockResolvedValueOnce({
      suggestions: [{ ...AUSTIN.suggestions[0], id: 'geoTargetConstants/1026201' }, { ...AUSTIN.suggestions[0], id: '01026201' }, AUSTIN.suggestions[1]],
      suggestion_count: 3,
      truncated: false,
    });
    const res = buildRes();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: 'tlf', q: '78701' }), res, vi.fn());

    const body = vi.mocked(res.json).mock.calls[0][0] as { suggestions: { id: string }[] };
    expect(body.suggestions.map((s) => s.id)).toEqual(['9031945']);
  });

  it.each([
    ['absent', {}],
    ['not an array', { suggestions: null }],
  ])('fails the search with a 502 when suggestions is %s, never an empty list', async (_case, payload) => {
    svcSuggest.mockResolvedValueOnce(payload);
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: 'tlf', q: 'Austin' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it("passes campaign-service's own failure through with its status", async () => {
    const upstream = MicroserviceError.fromMicroserviceResponse(
      503,
      'Service Unavailable',
      { message: 'google ads unavailable' },
      'LFX_V2_CAMPAIGN_SERVICE',
      '/p'
    );
    svcSuggest.mockRejectedValueOnce(upstream);
    const next = vi.fn();

    await new CampaignController().searchGoogleAdsGeoTargets(buildReq({ project: 'tlf', q: 'Austin' }), buildRes(), next);

    expect(nextError(next)).toBe(upstream);
  });
});
