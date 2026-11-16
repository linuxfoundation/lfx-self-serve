// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QUERY_SERVICE_MAX_PAGES } from '@lfx-one/shared/constants';
import type { ProjectMembershipDoc, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, getEffectiveUsername, withCache, cacheWrite } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getEffectiveUsername: vi.fn(),
  withCache: vi.fn(),
  cacheWrite: vi.fn(),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/org-selector.utils'));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('./valkey.service', () => ({ cacheKeyNamespace: () => 'test', valkeyService: { withCache } }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { OrgMembershipResolverService } from './org-membership-resolver.service';

const req = {} as Request;
const older: ProjectMembershipDoc = { uid: 'membership-old', status: 'active', start_date: '2025-01-01', project_uid: 'project-1' };
const newest: ProjectMembershipDoc = { uid: 'membership-new', status: 'active', start_date: '2026-01-01', project_uid: 'project-1' };

function page(docs: ProjectMembershipDoc[], token?: string): QueryServiceResponse<ProjectMembershipDoc> {
  return {
    resources: docs.map((data) => ({ type: 'project_membership', id: `project_membership:${data.uid}`, data })),
    ...(token ? { page_token: token } : {}),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getEffectiveUsername.mockReturnValue('viewer');
  // Match withCache's ordering: only a successfully resolved fetcher reaches the cache write.
  withCache.mockImplementation(async (_key: string, _ttl: number, fetcher: () => Promise<ProjectMembershipDoc[]>) => {
    const docs = await fetcher();
    cacheWrite(docs);
    return docs;
  });
});

describe('OrgMembershipResolverService completeness', () => {
  it('ignores a legacy partial cache entry and reuses only the complete v2 result', async () => {
    const legacyKey = 'lfx-ui:test:org-membership:v1:viewer:org-1:foundation-1';
    const strictKey = 'lfx-ui:test:org-membership:v2:viewer:org-1:foundation-1';
    const cache = new Map<string, ProjectMembershipDoc[]>([[legacyKey, [older]]]);
    withCache.mockImplementation(async (key: string, _ttl: number, fetcher: () => Promise<ProjectMembershipDoc[]>) => {
      const hit = cache.get(key);
      if (hit) return hit;
      const docs = await fetcher();
      cache.set(key, docs);
      return docs;
    });
    proxyRequest.mockResolvedValueOnce(page([older], 'next')).mockResolvedValueOnce(page([newest]));
    const resolver = new OrgMembershipResolverService();

    await expect(resolver.resolveContext(req, 'org-1', 'foundation-1')).resolves.toMatchObject({ membershipUid: newest.uid });
    expect(withCache.mock.calls[0][0]).toBe(strictKey);
    expect(cache.get(legacyKey)).toEqual([older]);
    expect(cache.get(strictKey)).toEqual([older, newest]);

    proxyRequest.mockClear();
    await expect(resolver.resolveContext(req, 'org-1', 'foundation-1')).resolves.toMatchObject({ membershipUid: newest.uid });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('selects the newest active membership only after every page is fetched', async () => {
    proxyRequest.mockResolvedValueOnce(page([older], 'next')).mockResolvedValueOnce(page([newest]));

    await expect(new OrgMembershipResolverService().resolveContext(req, 'org-1', 'foundation-1')).resolves.toEqual({
      b2bOrgUid: 'org-1',
      membershipUid: newest.uid,
      projectUid: 'project-1',
    });
    expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project_membership', page_size: 500, filters_all: 'project_slug:foundation-1' });
    expect(proxyRequest.mock.calls[1][4]).toMatchObject({ page_token: 'next' });
    expect(cacheWrite).toHaveBeenCalledWith([older, newest]);
  });

  it('rejects repeated tokens without caching or choosing the partial membership context, and permits retry', async () => {
    const resolver = new OrgMembershipResolverService();
    proxyRequest.mockResolvedValue(page([older], 'repeated'));

    await expect(resolver.resolveContext(req, 'org-1', 'foundation-1')).rejects.toMatchObject({
      code: 'QUERY_SERVICE_PAGINATION_LIMIT',
      statusCode: 502,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(cacheWrite).not.toHaveBeenCalled();

    proxyRequest.mockReset().mockResolvedValue(page([newest]));
    await expect(resolver.resolveContext(req, 'org-1', 'foundation-1')).resolves.toMatchObject({ membershipUid: newest.uid });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(cacheWrite).toHaveBeenCalledTimes(1);
    expect(cacheWrite).toHaveBeenCalledWith([newest]);
  });

  it('rejects a continuing scan at the page cap without completing the cache fetcher', async () => {
    let calls = 0;
    proxyRequest.mockImplementation(async () => page([older], `page-${++calls}`));

    await expect(new OrgMembershipResolverService().resolveContext(req, 'org-1', 'foundation-1')).rejects.toMatchObject({
      code: 'QUERY_SERVICE_PAGINATION_LIMIT',
      statusCode: 502,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(QUERY_SERVICE_MAX_PAGES);
    expect(cacheWrite).not.toHaveBeenCalled();
  });

  it('also rejects an incomplete scan when no principal-bound cache key is available', async () => {
    getEffectiveUsername.mockReturnValue(undefined);
    proxyRequest.mockResolvedValue(page([older], 'repeated'));

    await expect(new OrgMembershipResolverService().resolveContext(req, 'org-1', 'foundation-1')).rejects.toMatchObject({
      code: 'QUERY_SERVICE_PAGINATION_LIMIT',
    });
    expect(withCache).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
  });

  it('propagates a later-page failure without caching the successfully fetched prefix', async () => {
    const failure = Object.assign(new Error('page failed'), { statusCode: 400 });
    proxyRequest.mockResolvedValueOnce(page([older], 'next')).mockRejectedValueOnce(failure);

    await expect(new OrgMembershipResolverService().resolveContext(req, 'org-1', 'foundation-1')).rejects.toBe(failure);
    expect(cacheWrite).not.toHaveBeenCalled();
  });
});
