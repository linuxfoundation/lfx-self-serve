// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as campaigns.route.spec.ts: the import graph reaches Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_CONVERSION_ACTIONS_ACCESS_UNAVAILABLE_CODE, GOOGLE_CONVERSION_ACTIONS_RESTRICTED_CODE } from '@lfx-one/shared/constants';

/**
 * Router-level coverage for the conversion-action picker route (#5239): it must be answered by its own
 * guard and the controller's strict `global_marketing_ops` check, NOT by the blanket
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
  };
});
vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public listGoogleAdsConversionActions = svcList;
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

const getConversionActions = (): Promise<Response> => fetch(`${baseUrl}/api/campaigns/google/conversion-actions?project=tlf`);

describe('GET /api/campaigns/google/conversion-actions', () => {
  it("answers an access-check outage with the controller's coded 503, not the blanket guard's 403", async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('access-check unavailable'));

    const res = await getConversionActions();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: GOOGLE_CONVERSION_ACTIONS_ACCESS_UNAVAILABLE_CODE });
    expect(blanketGuard).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers a caller without global_marketing_ops on the project with the coded 403', async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValueOnce(false);

    const res = await getConversionActions();

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: GOOGLE_CONVERSION_ACTIONS_RESTRICTED_CODE });
    expect(blanketGuard).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('lists the actions for a caller holding global_marketing_ops on the project', async () => {
    svcList.mockResolvedValueOnce({
      account_id: '1234567890',
      conversion_actions: [
        {
          id: '1111111111',
          resource_name: 'customers/1234567890/conversionActions/1111111111',
          name: 'Event Registrations',
          status: 'ENABLED',
          type: 'WEBPAGE',
          category: 'SIGNUP',
          primary_for_goal: true,
        },
      ],
      conversion_action_count: 1,
    });

    const res = await getConversionActions();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accountId: '1234567890', actions: [{ id: '1111111111', name: 'Event Registrations' }] });
    expect(checkProjectGlobalMarketingOpsStrict).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(blanketGuard).not.toHaveBeenCalled();
  });

  it('leaves every other campaigns route behind the blanket campaign_manager guard', async () => {
    const res = await fetch(`${baseUrl}/api/campaigns/google/accounts?project=tlf`);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'MARKETING_ACCESS_REQUIRED' });
    expect(blanketGuard).toHaveBeenCalledWith('/google/accounts');
  });
});
