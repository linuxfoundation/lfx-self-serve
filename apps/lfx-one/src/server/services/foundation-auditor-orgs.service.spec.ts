// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runtime collaborators are mocked (the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config; this spec only needs literal stand-ins for the constants/enums/utils the
// service imports at runtime).
vi.mock('@lfx-one/shared/constants', () => ({
  FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE: 200,
  FOUNDATION_AUDITOR_MAX_FOUNDATIONS: 60,
  FOUNDATION_AUDITOR_MEMBER_CACHE_TTL_MS: 60_000,
  FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP: 500,
  FOUNDATION_AUDITOR_ROSTER_FETCH_CONCURRENCY: 8,
  FOUNDATION_AUDITOR_ROSTER_PAGE_SIZE: 500,
  FOUNDATION_AUDITOR_SEARCH_MIN_TERM_LENGTH: 2,
  ORG_ROLE_GRANTS_HARD_CAP: 500,
}));
vi.mock('@lfx-one/shared/enums', () => ({ ProjectFunding: { Funded: 'Funded' }, ProjectStage: { Active: 'Active', FormationEngaged: 'Formation - Engaged' } }));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({
  computeIsFoundation: vi.fn(() => true),
  isFilterSafeIdentifier: vi.fn((v: unknown) => typeof v === 'string' && v.length > 0),
}));

const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));

const { checkAccess } = vi.hoisted(() => ({ checkAccess: vi.fn() }));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkAccess = checkAccess;
  },
}));

const { generateM2MToken } = vi.hoisted(() => ({ generateM2MToken: vi.fn() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { FoundationAuditorOrgsService } from './foundation-auditor-orgs.service';

/**
 * Query-service fixture: one foundation ("f-1") with one active project_membership pointing at org
 * "org-1". `req.bearerToken` is a mutable field the service swaps in place, so the token used for each
 * call must be captured synchronously *inside* the mock implementation at call-time — reading it back
 * off `req` after the whole flow settles would only ever see the final (restored) value.
 */
function stubQueryService(orgDocFetchImpl: 'succeed' | 'reject'): { tokensByType: Map<string, string> } {
  const tokensByType = new Map<string, string>();
  proxyRequest.mockImplementation(async (req: Request, _service: string, _path: string, _method: string, query: Record<string, unknown>) => {
    tokensByType.set(query['type'] as string, req.bearerToken as string);
    if (query['type'] === 'project') {
      return { resources: [{ type: 'project', id: 'project:f-1', data: { uid: 'f-1', slug: 'found1' } }] };
    }
    if (query['type'] === 'project_membership') {
      return { resources: [{ type: 'project_membership', id: 'project_membership:pm-1', data: { uid: 'pm-1', b2b_org_uid: 'org-1', status: 'active' } }] };
    }
    if (query['type'] === 'b2b_org') {
      if (orgDocFetchImpl === 'reject') {
        throw new Error('b2b_org upstream down');
      }
      return { resources: [{ type: 'b2b_org', id: 'b2b_org:org-1', data: { name: 'Acme' } }] };
    }
    return { resources: [] };
  });
  return { tokensByType };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkAccess.mockResolvedValue(new Map([['f-1#auditor', true]]));
  generateM2MToken.mockResolvedValue('m2m-token');
});

describe('FoundationAuditorOrgsService — verify-then-elevate token boundary', () => {
  it("reads the project_membership roster on the caller's own user token, elevates only for the b2b_org display-doc fetch, and restores the original token", async () => {
    const { tokensByType } = stubQueryService('succeed');
    const req = { bearerToken: 'user-token' } as unknown as Request;

    const orgs = await new FoundationAuditorOrgsService().findAuditedMemberOrgs(req, 'alice', 'ac');

    expect(tokensByType.get('project_membership')).toBe('user-token');
    expect(tokensByType.get('b2b_org')).toBe('m2m-token');
    expect(orgs).toHaveLength(1);
    expect(req.bearerToken).toBe('user-token');
  });

  it('restores the original bearer token even when the M2M-scoped b2b_org fetch rejects', async () => {
    stubQueryService('reject');
    const req = { bearerToken: 'user-token' } as unknown as Request;

    await expect(new FoundationAuditorOrgsService().findAuditedMemberOrgs(req, 'bob', 'ac')).rejects.toThrow('b2b_org upstream down');

    expect(req.bearerToken).toBe('user-token');
  });
});
