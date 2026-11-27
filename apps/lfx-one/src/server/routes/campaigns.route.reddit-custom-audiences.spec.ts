// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as campaigns.route.spec.ts: the import graph reaches Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { REDDIT_CUSTOM_AUDIENCES_ACCESS_UNAVAILABLE_CODE, REDDIT_CUSTOM_AUDIENCES_RESTRICTED_CODE } from '@lfx-one/shared/constants';

/**
 * Router-level wiring for the Reddit custom-audience route (#6108 row 1), as for the Meta one (#5905): it must be answered by its own guard and the controller's strict `global_marketing_ops` check, NOT by the blanket
 * `router.use(requireCampaignManager)`, whose non-strict project check turns an access-check outage into
 * an uncoded 403. The blanket guard is stubbed here to refuse every request, so any route that still sits
 * behind it answers MARKETING_ACCESS_REQUIRED; the real controller method answers this one.
 */

const { svcList, isServerFeatureEnabled, checkProjectGlobalMarketingOpsStrict, blanketGuard } = vi.hoisted(() => ({
  svcList: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => true),
  checkProjectGlobalMarketingOpsStrict: vi.fn<(req: unknown, slug: string) => Promise<boolean>>(async () => true),
  blanketGuard: vi.fn(),
}));

vi.mock('../middleware/require-marketing-access.middleware', async () => {
  const { AuthorizationError } = await import('../errors');
  return {
    requireCampaignManager: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      blanketGuard(req.path);
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
    requireRedditPixelsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  };
});
vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public listRedditCustomAudiences = svcList;
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

const getAudiences = (query = ''): Promise<Response> => fetch(`${baseUrl}/api/campaigns/reddit/custom-audiences?project=tlf${query}`);

/** Wiring only: the filtering and mapping rules are table rows in `campaign-reddit-custom-audiences.utils.spec.ts`. */
describe('GET /api/campaigns/reddit/custom-audiences', () => {
  it('answers 404 while Reddit custom audiences are off, checking and reading nothing', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_REDDIT_CUSTOM_AUDIENCES');

    expect((await getAudiences()).status).toBe(404);
    expect(checkProjectGlobalMarketingOpsStrict).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it("answers the controller's coded 403 and 503, not the blanket guard's, reading nothing", async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('access-check unavailable'));

    const denied = await getAudiences();
    const unverified = await getAudiences();

    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: REDDIT_CUSTOM_AUDIENCES_RESTRICTED_CODE });
    expect(unverified.status).toBe(503);
    expect(await unverified.json()).toMatchObject({ code: REDDIT_CUSTOM_AUDIENCES_ACCESS_UNAVAILABLE_CODE });
    expect(blanketGuard).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers the read camel-cased and searched, and an unreadable one with a 502', async () => {
    svcList
      .mockResolvedValueOnce({
        account_id: 't2_acct',
        audiences: [
          { id: '67547345732543', name: 'KubeCon site visitors', type: 'PIXEL_RETARGETING', status: 'VALID', size_lower: 1000 },
          { id: 'b_2', name: 'Registrants', type: 'CUSTOMER_LIST', status: 'VALID' },
        ],
        audience_count: 2,
        truncated: true,
      })
      .mockResolvedValueOnce({ account_id: 't2_acct' });

    const res = await getAudiences('&q=%20kubecon%20');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accountId: 't2_acct',
      audiences: [{ id: '67547345732543', name: 'KubeCon site visitors', type: 'PIXEL_RETARGETING', status: 'VALID', sizeLower: 1000, sizeUpper: null }],
      truncated: true,
    });
    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect((await getAudiences()).status).toBe(502);
  });
});
