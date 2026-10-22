// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as campaigns.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the Reddit creative-asset upload (decision D3): the route's raw parser
 * (type allowlist and size limit, and its 413 conversion) lives on the route registration, so it is
 * exercised here through the real router, the real controller and the app's own error handler.
 * Only campaign-service is stubbed, so an upstream refusal is answered as production would answer it.
 */

const { uploadCreativeAsset, isServerFeatureEnabled } = vi.hoisted(() => ({
  uploadCreativeAsset: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => true),
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/campaign-service.service')>()),
  CampaignServiceClient: class {
    public uploadCreativeAsset = uploadCreativeAsset;
  },
}));
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/server-feature-flag.helper')>()),
  isServerFeatureEnabled,
}));
// The controller's other collaborators are not under test; stubbing them keeps their graphs out.
vi.mock('../services/campaign-proxy.service', () => ({ CampaignProxyService: class {} }));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {},
  LinkedInMetricsService: class {},
  RedditMetricsService: class {},
  MetaMetricsService: class {},
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));
vi.mock('../controllers/audience-builder.controller', () => ({ AudienceBuilderController: class {} }));
vi.mock('../controllers/campaign-optimize.controller', () => ({ CampaignOptimizeController: class {} }));
vi.mock('../middleware/require-marketing-access.middleware', () => ({
  requireCampaignManager: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireGoogleMonitorAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
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
const { CREATIVE_ASSET_MAX_BYTES, CREATIVE_ASSET_TOO_LARGE_MESSAGE, CREATIVE_ASSET_WRONG_TYPE_MESSAGE } = await import('@lfx-one/shared/constants');

const BRIEF = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const ASSET = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', mimeType: 'image/png', byteSize: PNG.byteLength, checksum: 'ab'.repeat(32), created: true };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  // The app's global JSON parser runs before every router; mounted here too so a JSON body reaches
  // the route already consumed, exactly as in production.
  app.use(express.json({ limit: '15mb' }));
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
});

const upload = (body: Buffer | string, contentType: string, query = `project=tlf&brief_id=${BRIEF}`): Promise<Response> =>
  fetch(`${baseUrl}/api/campaigns/brief/creative-assets?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    // A Uint8Array view, because the DOM `BodyInit` type this spec compiles against does not name Buffer.
    body: typeof body === 'string' ? body : new Uint8Array(body),
  });

describe('POST /api/campaigns/brief/creative-assets', () => {
  it('forwards the raw PNG bytes to campaign-service and answers 201 with the asset', async () => {
    uploadCreativeAsset.mockResolvedValue(ASSET);

    const response = await upload(PNG, 'image/png');

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(ASSET);
    expect(uploadCreativeAsset).toHaveBeenCalledTimes(1);
    const [, project, brief, contentType, bytes] = uploadCreativeAsset.mock.calls[0];
    expect([project, brief, contentType]).toEqual(['tlf', BRIEF, 'image/png']);
    expect(Buffer.compare(bytes as Buffer, PNG)).toBe(0);
  });

  it('answers 200 when campaign-service already held the identical image', async () => {
    uploadCreativeAsset.mockResolvedValue({ ...ASSET, mimeType: 'image/jpeg', created: false });

    const response = await upload(JPEG, 'image/jpeg');

    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(ASSET.id);
  });

  it('refuses an image over the size limit with a 413 and the shared message, before any upstream call', async () => {
    const tooLarge = Buffer.concat([PNG, Buffer.alloc(CREATIVE_ASSET_MAX_BYTES)]);

    const response = await upload(tooLarge, 'image/png');

    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe(CREATIVE_ASSET_TOO_LARGE_MESSAGE);
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['a type outside the allowlist', Buffer.from('GIF89a'), 'image/gif'],
    ['a JSON body', JSON.stringify({ bytes: 'aGVsbG8=' }), 'application/json'],
    ['bytes that are not the declared type', JPEG, 'image/png'],
  ])('refuses %s with a 415 and the shared message, before any upstream call', async (_label, body, contentType) => {
    const response = await upload(body, contentType);

    expect(response.status).toBe(415);
    expect((await response.json()).error).toBe(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
  });

  it('keeps a body-parser refusal other than size as a 4xx, not a 500', async () => {
    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets?project=tlf&brief_id=${BRIEF}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Encoding': 'br-unknown' },
      body: new Uint8Array(PNG),
    });

    expect(response.status).toBe(415);
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['no brief', 'project=tlf'],
    ['no project', `brief_id=${BRIEF}`],
  ])('refuses an upload with %s as a 400', async (_label, query) => {
    const response = await upload(PNG, 'image/png', query);

    expect(response.status).toBe(400);
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
  });

  it('refuses every upload while the capability is off, since nothing could use the asset', async () => {
    isServerFeatureEnabled.mockImplementation(() => false);

    const response = await upload(PNG, 'image/png');

    expect(response.status).toBe(400);
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'BAD_REQUEST', 'the image is truncated or corrupt'],
    [503, 'SERVICE_UNAVAILABLE', 'upload capacity is temporarily exhausted'],
  ])('passes an upstream %i through with campaign-service’s message', async (status, code, message) => {
    uploadCreativeAsset.mockRejectedValue(
      new MicroserviceError(message, status, code, { operation: 'upload_creative_asset', service: 'campaign_service_client' })
    );

    const response = await upload(PNG, 'image/png');

    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(message);
  });
});
