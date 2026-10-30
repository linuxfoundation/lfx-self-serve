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

const { uploadCreativeAsset, listCreativeAssets, getCreativeAsset, getCreativeAssetPlan, deleteCreativeAsset, isServerFeatureEnabled } = vi.hoisted(() => ({
  uploadCreativeAsset: vi.fn(),
  listCreativeAssets: vi.fn(),
  getCreativeAsset: vi.fn(),
  getCreativeAssetPlan: vi.fn(),
  deleteCreativeAsset: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => true),
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/campaign-service.service')>()),
  CampaignServiceClient: class {
    public uploadCreativeAsset = uploadCreativeAsset;
    public listCreativeAssets = listCreativeAssets;
    public getCreativeAsset = getCreativeAsset;
    public getCreativeAssetPlan = getCreativeAssetPlan;
    public deleteCreativeAsset = deleteCreativeAsset;
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
const { ServerFeatureFlag } = await import('../helpers/server-feature-flag.helper');

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

  it('refuses every upload while EVERY capability is off, since nothing could use the asset', async () => {
    isServerFeatureEnabled.mockImplementation(() => false);

    const response = await upload(PNG, 'image/png');

    expect(response.status).toBe(400);
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
  });

  /**
   * The stored library is ONE library, so any capability alone is reason enough to let an image
   * into it. Pinned in both directions: a Google-only deployment must not be left able to read and
   * delete a library it is not allowed to add to, and the Reddit-only case must keep working
   * unchanged now that the gate has widened.
   */
  it.each([
    [
      'only Reddit',
      [
        ServerFeatureFlag.CampaignServiceGoogleAssets,
        ServerFeatureFlag.CampaignServiceMetaAssets,
        ServerFeatureFlag.CampaignServiceLinkedInAssets,
        ServerFeatureFlag.CampaignServiceMicrosoftAssets,
        ServerFeatureFlag.CampaignServiceTwitterCreate,
      ],
    ],
    [
      'only Google',
      [
        ServerFeatureFlag.CampaignServiceRedditAssets,
        ServerFeatureFlag.CampaignServiceMetaAssets,
        ServerFeatureFlag.CampaignServiceLinkedInAssets,
        ServerFeatureFlag.CampaignServiceMicrosoftAssets,
        ServerFeatureFlag.CampaignServiceTwitterCreate,
      ],
    ],
    [
      'only Meta',
      [
        ServerFeatureFlag.CampaignServiceRedditAssets,
        ServerFeatureFlag.CampaignServiceGoogleAssets,
        ServerFeatureFlag.CampaignServiceLinkedInAssets,
        ServerFeatureFlag.CampaignServiceMicrosoftAssets,
        ServerFeatureFlag.CampaignServiceTwitterCreate,
      ],
    ],
    [
      'only LinkedIn',
      [
        ServerFeatureFlag.CampaignServiceRedditAssets,
        ServerFeatureFlag.CampaignServiceGoogleAssets,
        ServerFeatureFlag.CampaignServiceMetaAssets,
        ServerFeatureFlag.CampaignServiceMicrosoftAssets,
        ServerFeatureFlag.CampaignServiceTwitterCreate,
      ],
    ],
    [
      'only Microsoft',
      [
        ServerFeatureFlag.CampaignServiceRedditAssets,
        ServerFeatureFlag.CampaignServiceGoogleAssets,
        ServerFeatureFlag.CampaignServiceMetaAssets,
        ServerFeatureFlag.CampaignServiceLinkedInAssets,
        ServerFeatureFlag.CampaignServiceTwitterCreate,
      ],
    ],
    [
      'only X (the tweet image)',
      [
        ServerFeatureFlag.CampaignServiceRedditAssets,
        ServerFeatureFlag.CampaignServiceGoogleAssets,
        ServerFeatureFlag.CampaignServiceMetaAssets,
        ServerFeatureFlag.CampaignServiceLinkedInAssets,
        ServerFeatureFlag.CampaignServiceMicrosoftAssets,
      ],
    ],
  ])('admits an upload when %s can consume the asset', async (_label, offFlags) => {
    isServerFeatureEnabled.mockImplementation((flag: unknown) => !(offFlags as unknown[]).includes(flag));
    uploadCreativeAsset.mockResolvedValue(ASSET);

    const response = await upload(PNG, 'image/png');

    expect(response.status).toBe(201);
    expect(uploadCreativeAsset).toHaveBeenCalledTimes(1);
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

/**
 * The four reads and the prune of that same library. They are gated on
 * `LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS` alone, not on either creative-asset capability flag, and
 * they are exercised through the real router because two of their guarantees are properties of the
 * route table rather than of any handler: `plan` is registered before `:assetId`, and the DELETE
 * answers 204 with no body.
 */
describe('creative-asset library reads and prune', () => {
  const SCOPE = `project=tlf&brief_id=${BRIEF}`;
  const ASSET_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const LIBRARY = {
    assets: [{ id: ASSET_ID, projectId: 'tlf', briefId: BRIEF, mimeType: 'image/png', byteSize: 12, checksum: 'ab'.repeat(32) }],
    count: 1,
    countLimit: 100,
    bytesUsed: 12,
    bytesLimit: 536870912,
  };
  const PLAN = { platforms: ['google-ads'], assignments: [], gaps: [], unclassified: [], unused: [] };

  it('answers the library with the quota the next upload will be judged against, so a caller can plan before it starts', async () => {
    listCreativeAssets.mockResolvedValue(LIBRARY);

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets?${SCOPE}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(LIBRARY);
    expect(listCreativeAssets).toHaveBeenCalledWith(expect.anything(), 'tlf', BRIEF);
  });

  it('answers one stored asset by id', async () => {
    getCreativeAsset.mockResolvedValue(LIBRARY.assets[0]);

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets/${ASSET_ID}?${SCOPE}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(LIBRARY.assets[0]);
    expect(getCreativeAsset).toHaveBeenCalledWith(expect.anything(), 'tlf', BRIEF, ASSET_ID);
  });

  /**
   * Express matches in registration order, so `plan` registered after `:assetId` would be swallowed
   * as an asset id. This is the test that fails if the two are ever reordered.
   */
  it('routes the literal plan path to the plan handler, not to the asset-id handler', async () => {
    getCreativeAssetPlan.mockResolvedValue(PLAN);

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets/plan?${SCOPE}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PLAN);
    expect(getCreativeAsset).not.toHaveBeenCalled();
  });

  /**
   * `platforms` is REPEATABLE upstream (`?platforms=a&platforms=b`) and explicitly not comma-joined:
   * a joined string would be read as one platform named "a,b" and silently match nothing. Express
   * surfaces one value as a string and several as an array; both reach the client as an array.
   */
  it.each([
    ['repeated', 'platforms=google-ads&platforms=reddit', ['google-ads', 'reddit']],
    ['single', 'platforms=google-ads', ['google-ads']],
    ['absent', '', []],
    ['blank and duplicated', 'platforms=google-ads&platforms=++&platforms=google-ads', ['google-ads']],
  ])('passes %s platforms to campaign-service as an array', async (_label, query, expected) => {
    getCreativeAssetPlan.mockResolvedValue(PLAN);

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets/plan?${SCOPE}${query ? `&${query}` : ''}`);

    expect(response.status).toBe(200);
    expect(getCreativeAssetPlan).toHaveBeenCalledWith(expect.anything(), 'tlf', BRIEF, expected);
  });

  it('answers a delete with 204 and no body', async () => {
    deleteCreativeAsset.mockResolvedValue(undefined);

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets/${ASSET_ID}?${SCOPE}`, { method: 'DELETE' });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(deleteCreativeAsset).toHaveBeenCalledWith(expect.anything(), 'tlf', BRIEF, ASSET_ID);
  });

  /**
   * Upstream refuses a delete with 409 `reason=creative_asset_in_use` while a live campaign on the
   * brief could still need the image, and that refusal carries its own remedy text. It must reach
   * the operator readably rather than being flattened into a generic 500.
   */
  it('passes the in-use refusal through with campaign-service’s own remedy text', async () => {
    const message = 'this image is still referenced by a campaign that has not finished launching; retry once it settles';
    deleteCreativeAsset.mockRejectedValue(
      new MicroserviceError(message, 409, 'CONFLICT', {
        operation: 'delete_creative_asset',
        service: 'campaign_service_client',
        errorBody: { code: '409', message, reason: 'creative_asset_in_use' },
      })
    );

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets/${ASSET_ID}?${SCOPE}`, { method: 'DELETE' });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(message);
  });

  it.each([
    ['the list', 'GET', `/api/campaigns/brief/creative-assets?${SCOPE}`],
    ['the plan', 'GET', `/api/campaigns/brief/creative-assets/plan?${SCOPE}`],
    ['one asset', 'GET', `/api/campaigns/brief/creative-assets/${ASSET_ID}?${SCOPE}`],
    ['a delete', 'DELETE', `/api/campaigns/brief/creative-assets/${ASSET_ID}?${SCOPE}`],
  ])('answers %s with a 404 while the briefs cutover is off, since no such brief exists here', async (_label, method, path) => {
    isServerFeatureEnabled.mockImplementation((flag: unknown) => flag !== ServerFeatureFlag.CampaignServiceBriefs);

    const response = await fetch(`${baseUrl}${path}`, { method });

    expect(response.status).toBe(404);
    expect(listCreativeAssets).not.toHaveBeenCalled();
    expect(getCreativeAssetPlan).not.toHaveBeenCalled();
    expect(getCreativeAsset).not.toHaveBeenCalled();
    expect(deleteCreativeAsset).not.toHaveBeenCalled();
  });

  /**
   * The capability flags gate the UPLOAD, never these — a deployment must be able to see and prune
   * what it already stores whatever platform may currently consume it, or images uploaded under one
   * flag become unreachable the moment it is turned off.
   */
  it('still answers the library while every creative-asset capability is off', async () => {
    isServerFeatureEnabled.mockImplementation(
      (flag: unknown) =>
        flag !== ServerFeatureFlag.CampaignServiceRedditAssets &&
        flag !== ServerFeatureFlag.CampaignServiceGoogleAssets &&
        flag !== ServerFeatureFlag.CampaignServiceMetaAssets
    );
    listCreativeAssets.mockResolvedValue(LIBRARY);

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets?${SCOPE}`);

    expect(response.status).toBe(200);
    expect(listCreativeAssets).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no brief', 'project=tlf'],
    ['a brief that is not a UUID', 'project=tlf&brief_id=not-a-uuid'],
    ['no project', `brief_id=${BRIEF}`],
  ])('refuses a read with %s as a 400, before any upstream call', async (_label, query) => {
    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets?${query}`);

    expect(response.status).toBe(400);
    expect(listCreativeAssets).not.toHaveBeenCalled();
  });

  /**
   * The id is shape-checked as well as registered after the literal `plan`: the ordering is what
   * keeps `/plan` off this handler, and this check is what makes relying on that ordering safe.
   */
  it.each([
    ['a GET', 'GET', getCreativeAsset],
    ['a DELETE', 'DELETE', deleteCreativeAsset],
  ])('refuses %s naming an asset id that is not a UUID with a 400', async (_label, method, upstream) => {
    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets/not-a-uuid?${SCOPE}`, { method });

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  /** A 502 the client raised on an unusable upstream answer reaches the browser as a 502. */
  it('passes an unusable-answer 502 through rather than flattening it to a 500', async () => {
    listCreativeAssets.mockRejectedValue(
      new MicroserviceError('Creative asset list answer was unusable', 502, 'BAD_GATEWAY', {
        operation: 'list_creative_assets',
        service: 'campaign_service_client',
        clientMessage: 'The stored images could not be read. Please try again.',
      })
    );

    const response = await fetch(`${baseUrl}/api/campaigns/brief/creative-assets?${SCOPE}`);

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('The stored images could not be read. Please try again.');
  });
});
