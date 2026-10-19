// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-org-lens-access.middleware.spec.ts: the import graph reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccessAwareOrgs, checkSingleAccessStrict, getEffectiveUsername, isImpersonating, gatewayFetch } = vi.hoisted(() => ({
  getAccessAwareOrgs: vi.fn(),
  checkSingleAccessStrict: vi.fn(),
  getEffectiveUsername: vi.fn(),
  isImpersonating: vi.fn(() => false),
  gatewayFetch: vi.fn(),
}));

// Only the upstreams are mocked: the read gate, the CLA gate and the scopes parser all run for real,
// so these cases pin the composed rule rather than a reimplementation of it.
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl: () => 'https://gw.test/user-service/v1' }));
vi.mock('../services/valkey.service', () => ({
  buildUserCacheKey: () => null,
  valkeyService: { withCache: (_key: unknown, _ttl: unknown, fetcher: () => Promise<unknown>) => fetcher() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername(), isImpersonating: () => isImpersonating() }));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { requireOrgLensClaAccess } = await import('./require-org-lens-cla-access.middleware');

const OWN = '0014100000Te2ovAAB';
const OTHER = '0014100000BetaAAAA';
const PROJECT = 'a09410000182dD2AAI';

function scope(role: string, companyId: string, type = 'project|organization'): Record<string, unknown> {
  return { Role: role, Type: type, ID: [PROJECT, companyId], Level: 'member' };
}

function permissions(...scopes: Record<string, unknown>[]): Record<string, unknown> {
  return { Permissions: [{ Resource: 'cla_enabled_group', Actions: ['view_all'], Allowed: true, Scopes: scopes }] };
}

function noGrants(upstreamFailed = false): { resolved: Map<string, unknown>; upstreamFailed: boolean } {
  return { resolved: new Map(), upstreamFailed };
}

function buildReq(orgUid: string, extra: Record<string, unknown> = {}): Request {
  return { path: `/api/orgs/${orgUid}/lens/cla-groups`, params: { orgUid }, ...extra } as unknown as Request;
}

async function run(orgUid: string, extra: Record<string, unknown> = {}): Promise<ReturnType<typeof vi.fn>> {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  await requireOrgLensClaAccess(buildReq(orgUid, extra), {} as Response, next);
  return next;
}

function statusOf(next: ReturnType<typeof vi.fn>): number | 'allow' {
  expect(next).toHaveBeenCalledTimes(1);
  const arg: unknown = next.mock.calls[0][0];
  if (arg === undefined) return 'allow';
  return arg instanceof Error && 'statusCode' in arg && typeof arg.statusCode === 'number' ? arg.statusCode : 500;
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('contributor');
  isImpersonating.mockReturnValue(false);
  getAccessAwareOrgs.mockResolvedValue(noGrants());
  checkSingleAccessStrict.mockResolvedValue(false);
  gatewayFetch.mockResolvedValue(permissions());
});

describe('requireOrgLensClaAccess', () => {
  describe('an Org Lens reader', () => {
    it('is admitted by the read gate alone, with no user-service call', async () => {
      getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[OWN, { roleSource: 'direct-writer' }]]), upstreamFailed: false });

      expect(statusOf(await run(OWN))).toBe('allow');
      expect(gatewayFetch).not.toHaveBeenCalled();
    });

    it('stays admitted while user-service is failing', async () => {
      getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[OWN, { roleSource: 'direct-auditor' }]]), upstreamFailed: false });
      gatewayFetch.mockRejectedValue(new Error('user-service down'));

      expect(statusOf(await run(OWN))).toBe('allow');
    });
  });

  describe('a CLA Manager without an Org Lens grant', () => {
    it('is admitted to the company their cla-manager scope names', async () => {
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN)));

      expect(statusOf(await run(OWN))).toBe('allow');
    });

    it('asks user-service for the cla-manager role only', async () => {
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN)));

      await run(OWN);

      expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), 'https://gw.test/user-service/v1/me/permissions?role=cla-manager', expect.anything());
    });

    it('is refused another company, holding the role somewhere is not enough', async () => {
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN)));

      expect(statusOf(await run(OTHER))).toBe(403);
    });

    it('is refused the 15-character form of their own company before any lookup', async () => {
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN)));

      expect(statusOf(await run(OWN.slice(0, 15)))).toBe(400);
      expect(getAccessAwareOrgs).not.toHaveBeenCalled();
      expect(gatewayFetch).not.toHaveBeenCalled();
    });

    it('is refused a malformed id before any lookup', async () => {
      expect(statusOf(await run('not-an-org'))).toBe(400);
      expect(gatewayFetch).not.toHaveBeenCalled();
    });

    it('gets a retriable 503, not a denial, when user-service fails', async () => {
      gatewayFetch.mockRejectedValue(new Error('user-service down'));

      expect(statusOf(await run(OWN))).toBe(503);
    });

    it('is admitted by the scopes when the roster itself is down', async () => {
      getAccessAwareOrgs.mockResolvedValue(noGrants(true));
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN)));

      expect(statusOf(await run(OWN))).toBe('allow');
    });

    it('keeps the roster 503 when both lookups fail', async () => {
      getAccessAwareOrgs.mockResolvedValue(noGrants(true));
      gatewayFetch.mockRejectedValue(new Error('user-service down'));

      const next = await run(OWN);

      expect(statusOf(next)).toBe(503);
      expect(next.mock.calls[0][0]).toMatchObject({ path: '/query/resources' });
    });
  });

  describe('a caller who is not a CLA Manager', () => {
    it.each(['cla-signatory', 'cla-manager-designee', 'company-admin'])('is refused with only a %s scope on the company', async (role) => {
      gatewayFetch.mockResolvedValue(permissions(scope(role, OWN)));

      expect(statusOf(await run(OWN))).toBe(403);
    });

    it('is refused a cla-manager scope of another type on the company', async () => {
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN, 'organization')));

      expect(statusOf(await run(OWN))).toBe(403);
    });

    it('is refused with no scopes at all', async () => {
      expect(statusOf(await run(OWN))).toBe(403);
    });

    it('is refused without a lookup when there is no authenticated username', async () => {
      getEffectiveUsername.mockReturnValue(null);

      expect(statusOf(await run(OWN))).toBe(403);
      expect(gatewayFetch).not.toHaveBeenCalled();
    });
  });

  describe('while impersonating', () => {
    it("asks user-service with the target's token", async () => {
      isImpersonating.mockReturnValue(true);
      gatewayFetch.mockResolvedValue(permissions(scope('cla-manager', OWN)));

      expect(statusOf(await run(OWN, { bearerToken: 'target-user-token' }))).toBe('allow');
      expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.objectContaining({ bearerToken: 'target-user-token' }));
    });
  });
});
