// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

/**
 * `GET /api/campaigns/briefs` through the real route, the real project canonicalization, the real
 * `requireCampaignManager` and the real controller (#4507). The same project, named by slug or by
 * uid, must get the same authorization and the same briefs. Only the identity lookups and the
 * Query Service read are stubbed, with synthetic projects.
 */

const PROJECT_SLUG = 'acme-foundation';
const PROJECT_UID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UNKNOWN_UID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';

const { getPersonas, checkProjectWriter, checkRootCampaignManager, checkSingleAccess, getProjectIdBySlug, getProjectById, proxyRequest } = vi.hoisted(() => ({
  getPersonas: vi.fn(),
  checkProjectWriter: vi.fn(),
  checkRootCampaignManager: vi.fn(),
  checkSingleAccess: vi.fn(),
  getProjectIdBySlug: vi.fn(),
  getProjectById: vi.fn(),
  proxyRequest: vi.fn(),
}));

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas, checkProjectWriter, checkRootCampaignManager, checkRootMarketingAuditor: vi.fn() },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccess = checkSingleAccess;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = getProjectIdBySlug;
    public getProjectById = getProjectById;
  },
}));
vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
// The other controller on this router is not under test; stubbing it keeps its service graph out.
vi.mock('../controllers/campaign.controller', () => ({ CampaignController: class {} }));
vi.mock('../controllers/audience-builder.controller', () => ({ AudienceBuilderController: class {} }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    getLastOperation: vi.fn(),
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
  baseUrl = `http://127.0.0.1:${port}/api/campaigns`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const approvedBrief = {
  id: '9a8b7c6d-1111-4222-8333-944455556666',
  status: 'approved',
  delivery_type: 'paid-marketing',
  event_slug: 'acme-summit-2026',
  program_type: 'event',
  platforms: ['google'],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(ServerFeatureFlag.MarketingOpsFga, 'true');
  vi.stubEnv(ServerFeatureFlag.CampaignServiceBriefs, 'true');
  getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
  checkProjectWriter.mockResolvedValue(false);
  checkRootCampaignManager.mockResolvedValue(false);
  getProjectIdBySlug.mockImplementation(async (_req: unknown, slug: string) =>
    slug === PROJECT_SLUG ? { uid: PROJECT_UID, slug, exists: true } : { uid: '', slug, exists: false }
  );
  getProjectById.mockImplementation(async (_req: unknown, uid: string) => {
    if (uid === PROJECT_UID) {
      return { uid: PROJECT_UID, slug: PROJECT_SLUG };
    }
    throw new MicroserviceError('Project not found', 404, 'NOT_FOUND', { operation: 'get_project_by_id' });
  });
  checkSingleAccess.mockResolvedValue(false);
  proxyRequest.mockImplementation(async (_req: unknown, _service: string, _path: string, _method: string, query: { parent?: string }) => ({
    resources: query.parent === `project:${PROJECT_SLUG}` ? [{ data: approvedBrief }] : [],
  }));
});

afterEach(() => vi.unstubAllEnvs());

const listBriefs = (project: string): Promise<Response> => fetch(`${baseUrl}/briefs?project=${encodeURIComponent(project)}`);

describe('GET /api/campaigns/briefs addressed by slug or uid', () => {
  it('answers a project campaign manager the same briefs for the slug and the uid', async () => {
    checkSingleAccess.mockResolvedValue(true);

    const bySlug = await listBriefs(PROJECT_SLUG);
    const byUid = await listBriefs(PROJECT_UID);

    expect(bySlug.status).toBe(200);
    expect(byUid.status).toBe(200);
    const slugBody = await bySlug.json();
    expect(slugBody.briefs).toHaveLength(1);
    expect(await byUid.json()).toEqual(slugBody);
    // Both authorize against the same project uid and query the brief index by the same slug.
    expect(checkSingleAccess).toHaveBeenNthCalledWith(1, expect.anything(), { resource: 'project', id: PROJECT_UID, access: 'campaign_manager' });
    expect(checkSingleAccess).toHaveBeenNthCalledWith(2, expect.anything(), { resource: 'project', id: PROJECT_UID, access: 'campaign_manager' });
    for (const call of proxyRequest.mock.calls) {
      expect(call[4]).toMatchObject({ parent: `project:${PROJECT_SLUG}` });
    }
  });

  it('admits an ED scoped to the project by slug and by uid alike', async () => {
    getPersonas.mockResolvedValue({
      personas: ['executive-director'],
      personaProjects: { 'executive-director': [{ projectSlug: PROJECT_SLUG }] },
      isRootWriter: false,
      isLFStaff: false,
    });

    expect((await listBriefs(PROJECT_SLUG)).status).toBe(200);
    expect((await listBriefs(PROJECT_UID)).status).toBe(200);
    expect(checkSingleAccess).not.toHaveBeenCalled();
  });

  it('refuses a caller without a grant on the project by slug and by uid alike', async () => {
    const bySlug = await listBriefs(PROJECT_SLUG);
    const byUid = await listBriefs(PROJECT_UID);

    expect(bySlug.status).toBe(403);
    expect(byUid.status).toBe(403);
    expect(await byUid.json()).toMatchObject({ code: 'MARKETING_ACCESS_REQUIRED' });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('refuses a uid that names no project exactly as it refuses an unknown slug', async () => {
    checkSingleAccess.mockResolvedValue(true);

    const unknownUid = await listBriefs(UNKNOWN_UID);
    const unknownSlug = await listBriefs('no-such-project');

    expect(unknownUid.status).toBe(403);
    expect(unknownSlug.status).toBe(403);
    expect(await unknownUid.json()).toMatchObject({ code: 'MARKETING_ACCESS_REQUIRED' });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('does not resolve a slug through the uid lookup', async () => {
    checkSingleAccess.mockResolvedValue(true);

    await listBriefs(PROJECT_SLUG);

    expect(getProjectById).not.toHaveBeenCalled();
  });

  it('fails the request when the uid lookup itself fails, instead of guessing', async () => {
    checkSingleAccess.mockResolvedValue(true);
    getProjectById.mockRejectedValue(new MicroserviceError('Upstream unavailable', 503, 'SERVICE_UNAVAILABLE', { operation: 'get_project_by_id' }));

    const response = await listBriefs(PROJECT_UID);

    expect(response.status).toBe(503);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});
