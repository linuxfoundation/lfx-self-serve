// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.controller.spec.ts: the shared utils import graph reaches Angular's
// partially-compiled packages, which need the JIT compiler under vitest.
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: vi.fn(async () => 'alice') }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ServiceValidationError } from '../errors';
import { CrowdfundingService } from '../services/crowdfunding.service';
import { CrowdfundingController } from './crowdfunding.controller';

const PROJECT_UID = '00000000-0000-4000-8000-000000000001';
const ORG_UID = '001000000000000AAA';
const EMPTY_PAGE = { data: [], meta: { total: 0, limit: 10, offset: 0 } };

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
}

function buildReq(query: Record<string, unknown> = {}) {
  return { bearerToken: 'user-token', query } as any;
}

describe('CrowdfundingController initiatives scope (#347, #348)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('CROWDFUNDING_API_BASE_URL', 'https://cf.example');
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => EMPTY_PAGE }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const requestedUrls = (): string[] => fetchMock.mock.calls.map(([url]) => url as string);

  it.each([
    ['a non-UUID projectUid', { projectUid: 'not-a-uuid' }],
    ['a path traversal projectUid', { projectUid: '../me/initiatives' }],
    ['a repeated projectUid', { projectUid: [PROJECT_UID, PROJECT_UID] }],
    ['a non-SFID orgUid', { orgUid: 'acme' }],
    ['a 15-char orgUid', { orgUid: '001000000000000' }],
    ['a path traversal orgUid', { orgUid: '../me/initiatives' }],
    ['both projectUid and orgUid', { projectUid: PROJECT_UID, orgUid: ORG_UID }],
  ])('rejects %s with a 400 before calling CF', async (_label, query) => {
    const controller = new CrowdfundingController();
    for (const handler of [controller.getMyInitiatives, controller.getInitiativesStats]) {
      const next = vi.fn();
      await handler.call(controller, buildReq(query), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists a project-scoped page from the CF projects endpoint with the user token', async () => {
    const res = buildRes();
    const next = vi.fn();
    await new CrowdfundingController().getMyInitiatives(buildReq({ projectUid: PROJECT_UID, pageSize: '10', offset: '20' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(requestedUrls()).toEqual([`https://cf.example/crowdfunding/projects/${PROJECT_UID}/initiatives?limit=10&offset=20`]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer user-token');
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, pageSize: 10, offset: 0 });
  });

  it('computes stats from the project-scoped endpoint', async () => {
    const next = vi.fn();
    await new CrowdfundingController().getInitiativesStats(buildReq({ projectUid: PROJECT_UID }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(requestedUrls()).toEqual([`https://cf.example/crowdfunding/projects/${PROJECT_UID}/initiatives?limit=100&offset=0`]);
  });

  it('lists and computes stats from the CF organizations endpoint for an orgUid', async () => {
    const controller = new CrowdfundingController();
    const next = vi.fn();
    await controller.getMyInitiatives(buildReq({ orgUid: ORG_UID }), buildRes(), next);
    await controller.getInitiativesStats(buildReq({ orgUid: ORG_UID }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(requestedUrls()).toEqual([
      `https://cf.example/crowdfunding/organizations/${ORG_UID}/initiatives?limit=10&offset=0`,
      `https://cf.example/crowdfunding/organizations/${ORG_UID}/initiatives?limit=100&offset=0`,
    ]);
  });

  it('keeps the caller-owned endpoint when projectUid is absent or empty', async () => {
    const service = new CrowdfundingService();
    await service.getMyInitiatives(buildReq(), 10, 0);
    const next = vi.fn();
    await new CrowdfundingController().getMyInitiatives(buildReq({ projectUid: '' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(requestedUrls().every((url) => url.startsWith('https://cf.example/crowdfunding/me/initiatives?'))).toBe(true);
  });
});

describe('CrowdfundingController initiative writer routes (#259)', () => {
  const INITIATIVE_ID = '00000000-0000-4000-8000-000000000002';
  let fetchMock: ReturnType<typeof vi.fn>;

  const respondWith = (status: number, body: unknown = {}) =>
    fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' });
  const lastCall = (): [string, RequestInit] => fetchMock.mock.calls.at(-1) as [string, RequestInit];

  beforeEach(() => {
    vi.stubEnv('CROWDFUNDING_API_BASE_URL', 'https://cf.example');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads initiative details from /manage and maps a 404 to not-found', async () => {
    respondWith(404);
    const res = buildRes();
    const next = vi.fn();
    await new CrowdfundingController().getInitiativeBySlug({ ...buildReq(), params: { slug: 'my-fund' } }, res, next);

    expect(lastCall()[0]).toBe('https://cf.example/crowdfunding/initiatives/my-fund/manage');
    expect(lastCall()[1].headers).toMatchObject({ Authorization: 'Bearer user-token' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates a non-writer 403 from /manage instead of reporting not-found', async () => {
    respondWith(403);
    const res = buildRes();
    const next = vi.fn();
    await new CrowdfundingController().getInitiativeBySlug({ ...buildReq(), params: { slug: 'my-fund' } }, res, next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('reads transactions from /manage/transactions', async () => {
    respondWith(200, { data: [], total_count: 0, from: 0, size: 5 });
    const next = vi.fn();
    await new CrowdfundingController().getInitiativeTransactions(
      { ...buildReq({ type: 'donations', size: '5' }), params: { slug: INITIATIVE_ID } },
      buildRes(),
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(lastCall()[0]).toBe(`https://cf.example/crowdfunding/initiatives/${INITIATIVE_ID}/manage/transactions?type=donations&limit=5`);
  });

  it.each([
    [
      'updateInitiative',
      'PATCH',
      `/crowdfunding/initiatives/${INITIATIVE_ID}`,
      (s: CrowdfundingService) => s.updateInitiative(buildReq(), INITIATIVE_ID, { name: 'x' }),
    ],
    [
      'createAnnouncement',
      'POST',
      `/crowdfunding/initiatives/${INITIATIVE_ID}/announcements`,
      (s: CrowdfundingService) => s.createAnnouncement(buildReq(), INITIATIVE_ID, { title: 't', description: 'd' }),
    ],
    [
      'updateAnnouncement',
      'PUT',
      `/crowdfunding/initiatives/${INITIATIVE_ID}/announcements/a1`,
      (s: CrowdfundingService) => s.updateAnnouncement(buildReq(), INITIATIVE_ID, 'a1', { title: 't', description: 'd' }),
    ],
    [
      'deleteAnnouncement',
      'DELETE',
      `/crowdfunding/initiatives/${INITIATIVE_ID}/announcements/a1`,
      (s: CrowdfundingService) => s.deleteAnnouncement(buildReq(), INITIATIVE_ID, 'a1'),
    ],
  ])('%s calls %s %s and propagates a 403', async (_name, method, path, call) => {
    respondWith(403);
    await expect(call(new CrowdfundingService())).rejects.toMatchObject({ statusCode: 403 });
    expect(lastCall()[0]).toBe(`https://cf.example${path}`);
    expect(lastCall()[1].method).toBe(method);
  });
});
