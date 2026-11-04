// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.controller.spec.ts: the shared utils import graph reaches Angular's
// partially-compiled packages, which need the JIT compiler under vitest.
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccessAwareOrgs, getDirectGrantProjectRows } = vi.hoisted(() => ({
  getAccessAwareOrgs: vi.fn(),
  getDirectGrantProjectRows: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: vi.fn(async () => 'alice') }));
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getDirectGrantProjectRows = getDirectGrantProjectRows;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ServiceValidationError } from '../errors';
import { CrowdfundingService } from '../services/crowdfunding.service';
import { getUsernameFromAuth } from '../utils/auth-helper';
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

describe('CrowdfundingController org donations (#415)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('CROWDFUNDING_API_BASE_URL', 'https://cf.example');
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'd1',
            type: 'recurring',
            initiative_id: 'i1',
            initiative_name: 'Synthetic Fund',
            donor_name: 'Synthetic Donor',
            donor_email: 'donor@example.com',
            amount_cents: 2500,
            frequency: 'monthly',
            status: 'active',
            created_on: '2026-10-01T00:00:00Z',
          },
        ],
        meta: { total: 1, limit: 10, offset: 20 },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['a missing orgUid', {}],
    ['a non-SFID orgUid', { orgUid: 'acme' }],
    ['a 15-char orgUid', { orgUid: '001000000000000' }],
    ['a path traversal orgUid', { orgUid: '../me/donations' }],
    ['a repeated orgUid', { orgUid: [ORG_UID, ORG_UID] }],
  ])('rejects %s with a 400 before calling CF', async (_label, query) => {
    const next = vi.fn();
    await new CrowdfundingController().getOrgDonations(buildReq(query), buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists from the CF organizations donations endpoint with the user token and maps rows', async () => {
    const res = buildRes();
    const next = vi.fn();
    await new CrowdfundingController().getOrgDonations(buildReq({ orgUid: ORG_UID, pageSize: '10', offset: '20' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe(`https://cf.example/crowdfunding/organizations/${ORG_UID}/donations?limit=10&offset=20`);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer user-token');
    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'd1',
          recurring: true,
          initiativeId: 'i1',
          initiativeName: 'Synthetic Fund',
          donorName: 'Synthetic Donor',
          donorEmail: 'donor@example.com',
          amountCents: 2500,
          date: Date.UTC(2026, 9, 1),
        },
      ],
      total: 1,
      pageSize: 10,
      offset: 20,
    });
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

describe('CrowdfundingController initiative attribution (lfx-crowdfunding#342)', () => {
  const INITIATIVE_ID = '00000000-0000-4000-8000-000000000003';
  const OTHER_ORG_UID = '001000000000001AAA';
  let fetchMock: ReturnType<typeof vi.fn>;

  const respondWith = (status: number, body: unknown = {}) =>
    fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' });
  const lastCall = (): [string, RequestInit] => fetchMock.mock.calls.at(-1) as [string, RequestInit];
  const sentBody = (): Record<string, unknown> => JSON.parse(lastCall()[1].body as string);
  const putReq = (body: Record<string, unknown>, id = INITIATIVE_ID) => ({ ...buildReq(), params: { id }, body }) as any;

  beforeEach(() => {
    vi.stubEnv('CROWDFUNDING_API_BASE_URL', 'https://cf.example');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getAccessAwareOrgs.mockReset().mockResolvedValue({
      upstreamFailed: false,
      resolved: new Map([
        [ORG_UID, { roleSource: 'direct-auditor' }],
        [OTHER_ORG_UID, { roleSource: 'inherited-writer', parentUid: ORG_UID }],
      ]),
      orgDocByUid: new Map([[ORG_UID, { uid: ORG_UID, name: 'Acme Motors', logo_url: 'https://logos.example/acme.png' }]]),
    });
    getDirectGrantProjectRows.mockReset().mockResolvedValue([{ uid: PROJECT_UID, name: 'Vendor Project', logo_url: 'http://logos.example/p.png' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('offers direct organization grants and direct-grant projects, not inherited organizations', async () => {
    const res = buildRes();
    const next = vi.fn();
    await new CrowdfundingController().getAttributionOptions(buildReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getAccessAwareOrgs).toHaveBeenCalledWith(expect.anything(), 'alice');
    expect(res.json).toHaveBeenCalledWith({
      organizations: [{ id: ORG_UID, name: 'Acme Motors', logoUrl: 'https://logos.example/acme.png' }],
      projects: [{ id: PROJECT_UID, name: 'Vendor Project', logoUrl: 'http://logos.example/p.png' }],
    });
  });

  it('fails the options read when the organization roster lookup failed, instead of returning an empty list', async () => {
    getAccessAwareOrgs.mockResolvedValue({ upstreamFailed: true, resolved: new Map(), orgDocByUid: new Map() });
    const next = vi.fn();
    await new CrowdfundingController().getAttributionOptions(buildReq(), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 502 });
  });

  it.each([
    ['an unknown type', { type: 'Organization', entityUid: ORG_UID }],
    ['a missing type', { entityUid: ORG_UID }],
    ['personal with an entityUid', { type: 'personal', entityUid: ORG_UID }],
    ['an organization without an entityUid', { type: 'organization' }],
    ['a 15-char organization id', { type: 'organization', entityUid: '001000000000000' }],
    ['an injection attempt', { type: 'organization', entityUid: `${ORG_UID}"}` }],
    ['a non-UUID project id', { type: 'project', entityUid: 'not-a-uuid' }],
  ])('rejects %s with a 400 before calling CF', async (_label, body) => {
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq(body), buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID initiative id with a 400', async () => {
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'personal' }, 'my-fund'), buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs an organization with the display name and logo from the options', async () => {
    respondWith(200, { id: INITIATIVE_ID, status: 'submitted', attribution: { type: 'organization', entity_uid: ORG_UID, name: 'Acme Motors' } });
    const res = buildRes();
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'organization', entityUid: ORG_UID }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(lastCall()[0]).toBe(`https://cf.example/crowdfunding/initiatives/${INITIATIVE_ID}/attribution`);
    expect(lastCall()[1].method).toBe('PUT');
    expect(sentBody()).toEqual({ type: 'organization', entity_uid: ORG_UID, name: 'Acme Motors', logo_url: 'https://logos.example/acme.png' });
    expect(res.json.mock.calls[0][0].attribution).toEqual({ type: 'organization', entityUid: ORG_UID, name: 'Acme Motors', logoUrl: undefined });
  });

  it('lowercases a project UUID and drops a non-https logo', async () => {
    respondWith(200, { id: INITIATIVE_ID, status: 'submitted' });
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'project', entityUid: PROJECT_UID.toUpperCase() }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({ type: 'project', entity_uid: PROJECT_UID, name: 'Vendor Project' });
  });

  it('sends personal without looking up options', async () => {
    respondWith(200, { id: INITIATIVE_ID, status: 'submitted' });
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'personal' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({ type: 'personal' });
    expect(getAccessAwareOrgs).not.toHaveBeenCalled();
  });

  it('rejects a target missing from the options with a 403, so CF never stores a nameless attribution', async () => {
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'organization', entityUid: OTHER_ORG_UID }), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails with a 502 when the options lookup fails, without calling CF', async () => {
    getAccessAwareOrgs.mockResolvedValue({ upstreamFailed: true, resolved: new Map(), orgDocByUid: new Map() });
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'organization', entityUid: ORG_UID }), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 502 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncates a long display name to the upstream limit', async () => {
    getDirectGrantProjectRows.mockResolvedValue([{ uid: PROJECT_UID, name: 'P'.repeat(300) }]);
    respondWith(200, { id: INITIATIVE_ID, status: 'submitted' });
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'project', entityUid: PROJECT_UID }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(sentBody()['name']).toBe('P'.repeat(255));
  });

  it('rejects an unauthenticated caller with a 401', async () => {
    vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null);
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'personal' }), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([403, 400])('propagates a %s from CF', async (status) => {
    respondWith(status);
    const next = vi.fn();
    await new CrowdfundingController().updateInitiativeAttribution(putReq({ type: 'personal' }), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: status });
  });

  it('maps is_owner and attribution from the manage read', async () => {
    respondWith(200, {
      id: INITIATIVE_ID,
      slug: 'my-fund',
      status: 'submitted',
      is_owner: true,
      attribution: { type: 'project', entity_uid: PROJECT_UID, name: 'Vendor Project' },
    });
    const res = buildRes();
    await new CrowdfundingController().getInitiativeBySlug({ ...buildReq(), params: { slug: 'my-fund' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0]).toMatchObject({
      isOwner: true,
      attribution: { type: 'project', entityUid: PROJECT_UID, name: 'Vendor Project' },
    });
  });

  it('reads a missing is_owner as false', async () => {
    respondWith(200, { id: INITIATIVE_ID, slug: 'my-fund', status: 'submitted' });
    const res = buildRes();
    await new CrowdfundingController().getInitiativeBySlug({ ...buildReq(), params: { slug: 'my-fund' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].isOwner).toBe(false);
  });
});
