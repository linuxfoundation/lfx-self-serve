// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors';

const { gatewayFetch, isImpersonating, checkSingleAccessStrict } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  isImpersonating: vi.fn(() => false),
  checkSingleAccessStrict: vi.fn(),
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/cla-service-url.helper', () => ({ claServiceBaseUrl: () => 'https://gw.test/cla-service' }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'contributor', isImpersonating: () => isImpersonating() }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./valkey.service', () => ({ buildUserCacheKey: () => null, valkeyService: { withCache: vi.fn() } }));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));

const { OrgClaOnlyOrgsService, claOnlyEntryApplies } = await import('./org-cla-only-orgs.service');
const { ORG_CLA_ONLY_ORGS_MAX } = await import('@lfx-one/shared/constants');

const COMPANY_A = '0014100000Te2ovAAB';
const COMPANY_B = '0014100000BetaAAAA';
const COMPANY_C = '0014100000GammaAAA';

const req = (overrides: Partial<Request> = {}): Request => ({ path: '/api/nav/org-items', bearerToken: 'target-token', ...overrides }) as unknown as Request;

function scopesOf(...sfids: string[]) {
  return { getCompanySfids: vi.fn().mockResolvedValue(new Set(sfids)) };
}

function company(sfid: string, name: string | undefined = `Company ${sfid}`) {
  return { companyID: `internal-${sfid}`, companyExternalID: sfid, companyName: name };
}

function service(scopes: { getCompanySfids: ReturnType<typeof vi.fn> }) {
  return new OrgClaOnlyOrgsService(scopes as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  isImpersonating.mockReturnValue(false);
  checkSingleAccessStrict.mockResolvedValue(false);
});

describe('claOnlyEntryApplies', () => {
  it('applies only to a non-staff caller Org Lens resolved nothing for', () => {
    expect(claOnlyEntryApplies(false, 0, true)).toBe(true);
    expect(claOnlyEntryApplies(false, 1, true)).toBe(false);
    expect(claOnlyEntryApplies(true, 0, true)).toBe(false);
  });

  it('never applies while the roster or the staff check has not answered', () => {
    expect(claOnlyEntryApplies(false, 0, false)).toBe(false);
  });
});

describe('OrgClaOnlyOrgsService.listOrgs', () => {
  it('lists each managed company under the name EasyCLA holds for it, with the caller’s token', async () => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => company(url.split('/').pop() as string));

    const result = await service(scopesOf(COMPANY_A, COMPANY_B)).listOrgs(req());

    // SFID order, so the listing cap always keeps the same companies; the selector sorts by name.
    expect(result).toEqual({
      orgs: [
        { uid: COMPANY_B, name: `Company ${COMPANY_B}` },
        { uid: COMPANY_A, name: `Company ${COMPANY_A}` },
      ],
      failed: false,
    });
    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      `https://gw.test/cla-service/v4/company/external/${COMPANY_A}`,
      expect.objectContaining({ bearerToken: undefined, redactResponseBody: true })
    );
  });

  it('forwards the target’s token while impersonating', async () => {
    isImpersonating.mockReturnValue(true);
    gatewayFetch.mockResolvedValue(company(COMPANY_A));

    await service(scopesOf(COMPANY_A)).listOrgs(req());

    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ bearerToken: 'target-token' }));
  });

  it('drops a company EasyCLA answers for with another company’s record', async () => {
    gatewayFetch.mockResolvedValue(company(COMPANY_B));

    expect(await service(scopesOf(COMPANY_A)).listOrgs(req())).toEqual({ orgs: [], failed: false });
  });

  it('drops a company EasyCLA does not know, without reporting an outage', async () => {
    gatewayFetch.mockRejectedValue(new MicroserviceError('not found', 404, 'UPSTREAM_ERROR', { operation: 'x', service: 'y' }));

    expect(await service(scopesOf(COMPANY_A)).listOrgs(req())).toEqual({ orgs: [], failed: false });
  });

  it('reports an outage, not an unknown company, when EasyCLA answers without the company’s external id', async () => {
    gatewayFetch.mockResolvedValue({ companyID: 'internal-x', companyName: 'Acme Corp' });

    expect(await service(scopesOf(COMPANY_A)).listOrgs(req())).toEqual({ orgs: [], failed: true });
  });

  it('keeps the rows that resolved and reports the lookup that failed', async () => {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => {
      if (url.endsWith(COMPANY_B)) throw new MicroserviceError('down', 503, 'UPSTREAM_ERROR', { operation: 'x', service: 'y' });
      return company(url.split('/').pop() as string);
    });

    const result = await service(scopesOf(COMPANY_A, COMPANY_B, COMPANY_C)).listOrgs(req());

    expect(result.orgs.map((org) => org.uid).sort()).toEqual([COMPANY_A, COMPANY_C].sort());
    expect(result.failed).toBe(true);
  });

  it('lists nothing and reports the outage when the scopes cannot be read', async () => {
    const scopes = { getCompanySfids: vi.fn().mockRejectedValue(new Error('user-service down')) };

    expect(await service(scopes).listOrgs(req())).toEqual({ orgs: [], failed: true });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('falls back to the SFID when EasyCLA holds no name', async () => {
    gatewayFetch.mockResolvedValue(company(COMPANY_A, '  '));

    expect((await service(scopesOf(COMPANY_A)).listOrgs(req())).orgs).toEqual([{ uid: COMPANY_A, name: COMPANY_A }]);
  });

  it(`makes at most ORG_CLA_ONLY_ORGS_MAX company lookups`, async () => {
    const sfids = Array.from({ length: ORG_CLA_ONLY_ORGS_MAX + 3 }, (_v, i) => `0014100000${String(i).padStart(8, '0')}`);
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => company(url.split('/').pop() as string));

    const result = await service(scopesOf(...sfids)).listOrgs(req());

    expect(gatewayFetch).toHaveBeenCalledTimes(ORG_CLA_ONLY_ORGS_MAX);
    expect(result.orgs).toHaveLength(ORG_CLA_ONLY_ORGS_MAX);
  });
});

describe('OrgClaOnlyOrgsService.getRoleGrantClaManagerOrgs', () => {
  const grants = {
    writers: [],
    auditors: [],
    cascadingWriters: [],
    cascadingAuditors: [],
    isStaff: false,
    username: 'contributor',
    loaded_at: '2026-01-01T00:00:00.000Z',
    degraded: false,
  };
  const cascading = [{ uid: COMPANY_C, parentUid: COMPANY_C, parentName: 'Parent' }];

  it('answers the caller’s CLA-manager companies, sorted, when Org Lens granted nothing', async () => {
    expect(await service(scopesOf(COMPANY_A, COMPANY_B)).getRoleGrantClaManagerOrgs(req(), grants)).toEqual({
      claManagerOrgs: [COMPANY_B, COMPANY_A],
      claManagerLookup: 'ok',
    });
  });

  it.each([
    ['a writer grant', { writers: [COMPANY_C] }],
    ['an auditor grant', { auditors: [COMPANY_C] }],
    ['a cascading writer grant', { cascadingWriters: cascading }],
    ['a cascading auditor grant', { cascadingAuditors: cascading }],
    ['staff', { isStaff: true }],
    ['a roster that never loaded', { lookupOutcome: 'failed' as const }],
    ['a partial roster, which is only a lower bound', { lookupOutcome: 'partial' as const }],
    ['a failed staff check', { staffCheck: 'failed' as const }],
  ])('never asks user-service for a caller with %s', async (_label, overrides) => {
    const scopes = scopesOf(COMPANY_A);

    expect(await service(scopes).getRoleGrantClaManagerOrgs(req(), { ...grants, ...overrides })).toEqual({ claManagerOrgs: [], claManagerLookup: 'ok' });
    expect(scopes.getCompanySfids).not.toHaveBeenCalled();
  });

  it('answers none, marked failed, when the scopes cannot be read', async () => {
    const scopes = { getCompanySfids: vi.fn().mockRejectedValue(new Error('user-service down')) };

    expect(await service(scopes).getRoleGrantClaManagerOrgs(req(), grants)).toEqual({ claManagerOrgs: [], claManagerLookup: 'failed' });
  });
});

describe('OrgClaOnlyOrgsService.resolveOrg', () => {
  it('resolves a managed company as a CLA-only organization with no slug', async () => {
    gatewayFetch.mockResolvedValue(company(COMPANY_A, 'Acme Corp'));

    expect(await service(scopesOf(COMPANY_A)).resolveOrg(req(), COMPANY_A)).toEqual({ uid: COMPANY_A, slug: null, name: 'Acme Corp', claOnly: true });
  });

  it('never resolves a company the caller does not manage, and never asks EasyCLA about it', async () => {
    expect(await service(scopesOf(COMPANY_B)).resolveOrg(req(), COMPANY_A)).toBeNull();
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('answers not found when user-service cannot answer', async () => {
    const scopes = { getCompanySfids: vi.fn().mockRejectedValue(new Error('user-service down')) };

    expect(await service(scopes).resolveOrg(req(), COMPANY_A)).toBeNull();
  });

  it('answers not found when EasyCLA cannot answer', async () => {
    gatewayFetch.mockRejectedValue(new MicroserviceError('down', 503, 'UPSTREAM_ERROR', { operation: 'x', service: 'y' }));

    expect(await service(scopesOf(COMPANY_A)).resolveOrg(req(), COMPANY_A)).toBeNull();
  });

  it('answers not found when EasyCLA returns another company', async () => {
    gatewayFetch.mockResolvedValue(company(COMPANY_B));

    expect(await service(scopesOf(COMPANY_A)).resolveOrg(req(), COMPANY_A)).toBeNull();
  });
});

describe('OrgClaOnlyOrgsService.resolveOrg through cla_admin', () => {
  it('resolves an organization the caller holds cla_admin on without a cla-manager scope', async () => {
    checkSingleAccessStrict.mockResolvedValue(true);
    gatewayFetch.mockResolvedValue(company(COMPANY_A, 'Acme Corp'));

    expect(await service(scopesOf()).resolveOrg(req(), COMPANY_A)).toEqual({ uid: COMPANY_A, slug: null, name: 'Acme Corp', claOnly: true });
    expect(checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: COMPANY_A, access: 'cla_admin' });
  });

  it('resolves through cla_admin while user-service is failing', async () => {
    checkSingleAccessStrict.mockResolvedValue(true);
    gatewayFetch.mockResolvedValue(company(COMPANY_A, 'Acme Corp'));
    const scopes = { getCompanySfids: vi.fn().mockRejectedValue(new Error('user-service down')) };

    expect(await service(scopes).resolveOrg(req(), COMPANY_A)).toEqual({ uid: COMPANY_A, slug: null, name: 'Acme Corp', claOnly: true });
  });

  it('falls back to the scope when the cla_admin check fails', async () => {
    checkSingleAccessStrict.mockRejectedValue(new Error('relation cla_admin not found'));
    gatewayFetch.mockResolvedValue(company(COMPANY_A, 'Acme Corp'));

    expect(await service(scopesOf(COMPANY_A)).resolveOrg(req(), COMPANY_A)).toEqual({ uid: COMPANY_A, slug: null, name: 'Acme Corp', claOnly: true });
    expect(await service(scopesOf(COMPANY_B)).resolveOrg(req(), COMPANY_A)).toBeNull();
  });
});
