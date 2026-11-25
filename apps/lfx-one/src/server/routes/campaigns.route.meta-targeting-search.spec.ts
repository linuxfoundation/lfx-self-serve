// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as campaigns.route.spec.ts: the import graph reaches Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { META_TARGETING_SEARCH_BUSY_MESSAGE } from '@lfx-one/shared/constants';

/**
 * Router-level coverage for the Meta targeting search (#5904 row 4): it sits behind the blanket
 * `requireCampaignManager` (Meta taxonomy, campaign-service's own gate), checks the kind and query before any
 * upstream call, camel-cases the answer, and turns a Meta throttle into a "busy, try again" 503. The LinkedIn location
 * search (#5545) shares the harness for its guard test, at the end.
 */

const { svcSearch, svcLinkedInSearch, isServerFeatureEnabled, checkProjectGlobalMarketingOpsStrict, blanketGuard } = vi.hoisted(() => ({
  svcSearch: vi.fn(),
  svcLinkedInSearch: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => true),
  checkProjectGlobalMarketingOpsStrict: vi.fn<(req: unknown, slug: string) => Promise<boolean>>(async () => true),
  blanketGuard: vi.fn(),
}));

vi.mock('../middleware/require-marketing-access.middleware', async () => {
  const { AuthorizationError } = await import('../errors');
  return {
    requireCampaignManager: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      blanketGuard(req.path);
      // Let the search through: it belongs behind this guard, which only records that it ran.
      if (req.path === '/meta/targeting-search' || req.path === '/linkedin/geo-targets') {
        next();
        return;
      }
      next(new AuthorizationError('campaign_manager access required for this resource', { code: 'MARKETING_ACCESS_REQUIRED', path: req.path }));
    },
    requireGoogleMonitorAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireGoogleConversionActionsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireGoogleUserListsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireGoogleAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireMetaCustomAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireMetaLeadFormsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireLinkedInAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireLinkedInConversionsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireLinkedInLeadFormsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireRedditCustomAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  };
});
vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public searchMetaTargetingOptions = svcSearch;
      public searchLinkedInTargetingEntities = svcLinkedInSearch;
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
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    checkRootWriter: vi.fn(async () => false),
    checkRootCampaignManager: vi.fn(async () => false),
    checkProjectGlobalMarketingOpsStrict,
  },
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));
vi.mock('../controllers/audience-builder.controller', () => ({ AudienceBuilderController: class {} }));
vi.mock('../controllers/campaign-optimize.controller', () => ({ CampaignOptimizeController: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

const campaignsRouter = (await import('./campaigns.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');
const { MicroserviceError } = await import('../errors');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/campaigns', campaignsRouter);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  isServerFeatureEnabled.mockImplementation(() => true);
  checkProjectGlobalMarketingOpsStrict.mockResolvedValue(true);
});

const search = (qs: string): Promise<Response> => fetch(`${baseUrl}/api/campaigns/meta/targeting-search?${qs}`);

describe('GET /api/campaigns/meta/targeting-search', () => {
  it('runs behind the campaign-manager guard and camel-cases the answer, dropping an id a create would refuse and a repeat', async () => {
    svcSearch.mockResolvedValueOnce({
      type: 'interest',
      options: [
        { id: '6003020834693', name: 'Kubernetes', path: ['Interests', 'Technology'], audience_size_lower_bound: 1000, audience_size_upper_bound: 2000 },
        { id: '6003020834693', name: 'Repeat' },
        { id: '6003111111111', name: '', description: 'Open source' },
        { id: 'act_1', name: 'Not an id' },
      ],
      option_count: 4,
    });

    const res = await search('project=tlf&type=interest&query=%20kubernetes%20');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type: 'interest',
      options: [
        { id: '6003020834693', name: 'Kubernetes', path: ['Interests', 'Technology'], audienceSizeLowerBound: 1000, audienceSizeUpperBound: 2000 },
        { id: '6003111111111', name: '6003111111111', path: [], description: 'Open source' },
      ],
    });
    expect(svcSearch).toHaveBeenCalledWith(expect.anything(), 'tlf', 'interest', 'kubernetes');
    expect(blanketGuard).toHaveBeenCalled();
  });

  it('keeps coverage for job titles', async () => {
    svcSearch.mockResolvedValueOnce({ type: 'work_position', options: [{ id: '105', name: 'Platform Engineer', coverage: 0.4 }] });

    expect(await (await search('project=tlf&type=work_position&query=platform')).json()).toEqual({
      type: 'work_position',
      options: [{ id: '105', name: 'Platform Engineer', path: [], coverage: 0.4 }],
    });
  });

  it.each([
    ['an unknown kind', 'project=tlf&type=industry&query=kubernetes'],
    ['a one-letter query', 'project=tlf&type=interest&query=k'],
    ['a missing project', 'type=interest&query=kubernetes'],
  ])('refuses %s with a 400, calling nothing upstream', async (_label, qs) => {
    expect((await search(qs)).status).toBe(400);
    expect(svcSearch).not.toHaveBeenCalled();
  });

  it.each([
    ['interest', 'LFX_CUTOVER_CAMPAIGN_SERVICE_META_INTEREST_TARGETING'],
    ['work_position', 'LFX_CUTOVER_CAMPAIGN_SERVICE_META_BEHAVIOR_TARGETING'],
  ])('answers 404 for %s while its own flag (%s) is off, though the other kind is on', async (type, off) => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== off);

    expect((await search(`project=tlf&type=${type}&query=kubernetes`)).status).toBe(404);
    expect(svcSearch).not.toHaveBeenCalled();
  });

  it('answers 404 unless interest or behavior targeting is on', async () => {
    isServerFeatureEnabled.mockImplementation(
      (flag) => flag !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_META_INTEREST_TARGETING' && flag !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_META_BEHAVIOR_TARGETING'
    );

    expect((await search('project=tlf&type=interest&query=kubernetes')).status).toBe(404);
    expect(svcSearch).not.toHaveBeenCalled();
  });

  it('answers an upstream 503 with a try-again 503 the operator can act on', async () => {
    svcSearch.mockRejectedValueOnce(new MicroserviceError('upstream throttled', 503, 'SERVICE_UNAVAILABLE', { operation: 'x', service: 'y' }));

    const res = await search('project=tlf&type=behavior&query=early');

    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain(META_TARGETING_SEARCH_BUSY_MESSAGE);
  });

  it('leaves a failure to reach campaign-service as it is, rather than blaming Meta', async () => {
    svcSearch.mockRejectedValueOnce(
      new MicroserviceError('The request could not be completed. Please try again.', 503, 'NETWORK_ERROR', {
        transportFailure: true,
        originalError: new Error('fetch failed'),
      })
    );

    const res = await search('project=tlf&type=interest&query=kubernetes');

    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain(META_TARGETING_SEARCH_BUSY_MESSAGE);
  });

  it('fails an unreadable body with a 502 rather than an empty list', async () => {
    svcSearch.mockResolvedValueOnce({ type: 'interest' });

    expect((await search('project=tlf&type=interest&query=kubernetes')).status).toBe(502);
  });
});

// The LinkedIn location search (#5545) shares this router harness: it sits behind the same blanket guard.
describe('GET /api/campaigns/linkedin/geo-targets', () => {
  it('runs behind requireCampaignManager', async () => {
    svcLinkedInSearch.mockResolvedValueOnce({ facet: 'locations', entities: [{ urn: 'urn:li:geo:103035651', name: 'Berlin, Germany' }], entity_count: 1 });

    const res = await fetch(`${baseUrl}/api/campaigns/linkedin/geo-targets?project=tlf&q=Berlin`);

    expect(blanketGuard).toHaveBeenCalledWith('/linkedin/geo-targets');
    // The answer's shape is the controller spec's (`campaign.controller.linkedin-geo-search.spec.ts`).
    expect(res.status).toBe(200);
  });
});
