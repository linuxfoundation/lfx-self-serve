// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the Microsoft Ads campaign-ref resolve the act-from-Monitor dialog calls
 * (#2519): the route must be REGISTERED, bound to `microsoft-ads` (never another platform's
 * campaign-ref), and answer through the real controller and the app's own error handler. Only the
 * service's upstream call is stubbed, so a 404 or a failure upstream is answered as production would.
 */

const { resolvePlatformCampaign } = vi.hoisted(() => ({ resolvePlatformCampaign: vi.fn() }));

vi.mock('../services/campaign-optimize.service', () => ({
  CampaignOptimizeService: class {
    public resolvePlatformCampaign = resolvePlatformCampaign;
  },
}));
// The other controllers on this router are not under test; stubbing them keeps their service graphs out.
vi.mock('../controllers/campaign.controller', () => ({ CampaignController: class {} }));
vi.mock('../controllers/audience-builder.controller', () => ({ AudienceBuilderController: class {} }));
vi.mock('../middleware/require-marketing-access.middleware', () => ({
  requireCampaignManager: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
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
const { MicroserviceError } = await import('../errors/microservice.error');

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
});

const resolveMicrosoft = (platformCampaignId: string): Promise<Response> =>
  fetch(`${baseUrl}/api/campaigns/microsoft/campaign-ref?project=tlf&platformCampaignId=${encodeURIComponent(platformCampaignId)}`);

describe('GET /api/campaigns/microsoft/campaign-ref', () => {
  it("answers campaign-service's resolution as is, resolved against Microsoft's campaign-ref", async () => {
    const resolution = {
      platform_campaign_id: '413296582',
      matches: [{ campaign_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', brief_id: '6f9619ff-8b86-d011-b42d-00c04fc964ff' }],
      match_count: 1,
    };
    resolvePlatformCampaign.mockResolvedValue(resolution);

    const response = await resolveMicrosoft('413296582');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resolution);
    expect(resolvePlatformCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', 'microsoft-ads', '413296582');
  });

  it('passes an upstream 404 through as a 404', async () => {
    resolvePlatformCampaign.mockRejectedValue(
      new MicroserviceError('Resource not found', 404, 'NOT_FOUND', { operation: 'resolve_platform_campaign', service: 'campaign_optimize_service' })
    );

    const response = await resolveMicrosoft('413296582');

    expect(response.status).toBe(404);
    // Reached the controller: not the router's own "no such route" 404.
    expect(resolvePlatformCampaign).toHaveBeenCalledTimes(1);
  });

  it('answers an upstream failure with its status, not a 200', async () => {
    resolvePlatformCampaign.mockRejectedValue(
      new MicroserviceError('Upstream is unavailable', 503, 'SERVICE_UNAVAILABLE', {
        operation: 'resolve_platform_campaign',
        service: 'campaign_optimize_service',
      })
    );

    const response = await resolveMicrosoft('413296582');

    expect(response.status).toBe(503);
  });

  it.each(['0413296582', '9223372036854775808', 'abc'])('refuses %s, outside Microsoft int64 id rule, with a 400 and no upstream call', async (id) => {
    const response = await resolveMicrosoft(id);

    expect(response.status).toBe(400);
    expect(resolvePlatformCampaign).not.toHaveBeenCalled();
  });
});
