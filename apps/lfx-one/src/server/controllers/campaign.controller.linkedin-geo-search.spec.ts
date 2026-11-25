// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError, ServiceValidationError } from '../errors';

// The Implement tab's LinkedIn location search route (#5545; campaign-service #643). The rules are table rows in
// `campaign-linkedin-geo.utils.spec.ts`; these prove the route applies them and handles the upstream answer.
const { svcSearch, logger } = vi.hoisted(() => ({
  svcSearch: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public searchLinkedInTargetingEntities = svcSearch;
    },
  };
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

const buildReq = (query: Record<string, unknown>): Request => ({ query, path: '/api/campaigns/linkedin/geo-targets' }) as unknown as Request;
const buildRes = (): Response => ({ json: vi.fn(), status: vi.fn().mockReturnThis() }) as unknown as Response;
const nextError = (next: NextFunction): unknown => vi.mocked(next).mock.calls[0]?.[0];

describe('CampaignController.searchLinkedInGeoTargets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches the locations facet with the trimmed query and answers only geo URNs', async () => {
    svcSearch.mockResolvedValueOnce({
      facet: 'locations',
      entities: [
        { urn: 'urn:li:geo:103035651', name: 'Berlin, Germany' },
        { urn: 'urn:li:skill:1', name: 'Not a place' },
      ],
      entity_count: 2,
    });
    const res = buildRes();

    await new CampaignController().searchLinkedInGeoTargets(buildReq({ project: ' tlf ', q: '  Berlin ' }), res, vi.fn());

    expect(svcSearch).toHaveBeenCalledWith(expect.anything(), 'tlf', 'locations', 'Berlin');
    expect(res.json).toHaveBeenCalledWith({ locations: [{ urn: 'urn:li:geo:103035651', label: 'Berlin, Germany' }] });
  });

  it.each([
    ['no project', { q: 'Berlin' }, 'project'],
    ['a one-character query', { project: 'tlf', q: 'B' }, 'q'],
  ])('refuses %s before any upstream call', async (_name, query, field) => {
    const next = vi.fn();

    await new CampaignController().searchLinkedInGeoTargets(buildReq(query), buildRes(), next);

    expect(svcSearch).not.toHaveBeenCalled();
    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe(field);
  });

  it('answers a LinkedIn throttle with a try-again 503, and an unreadable answer with a 502', async () => {
    svcSearch.mockRejectedValueOnce(new MicroserviceError('throttled', 503, 'SERVICE_UNAVAILABLE', { operation: 'x', service: 'y' }));
    const busy = vi.fn();
    await new CampaignController().searchLinkedInGeoTargets(buildReq({ project: 'tlf', q: 'Berlin' }), buildRes(), busy);
    expect((nextError(busy) as MicroserviceError).code).toBe('LINKEDIN_GEO_SEARCH_UNAVAILABLE');

    svcSearch.mockResolvedValueOnce({ facet: 'locations' });
    const bad = vi.fn();
    await new CampaignController().searchLinkedInGeoTargets(buildReq({ project: 'tlf', q: 'Berlin' }), buildRes(), bad);
    expect((nextError(bad) as MicroserviceError).statusCode).toBe(502);
  });
});
