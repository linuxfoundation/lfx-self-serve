// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch, getEffectiveUsername, isImpersonating, cacheStore, withCacheCalls } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'contributor' as string | null),
  isImpersonating: vi.fn(() => false),
  cacheStore: new Map<string, unknown>(),
  withCacheCalls: [] as { key: string | null; ttl: number }[],
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl: () => 'https://gw.test/user-service/v1' }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername(), isImpersonating: () => isImpersonating() }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// A faithful stand-in for `withCache`'s contract: `accept` gates reads, `storable` gates writes, and a
// throwing fetcher writes nothing.
vi.mock('./valkey.service', () => ({
  buildUserCacheKey: (namespace: string, username: string) => `${namespace}:${username}`,
  valkeyService: {
    withCache: async (
      key: string | null,
      ttl: number,
      fetcher: () => Promise<unknown>,
      accept?: (value: unknown) => boolean,
      storable?: (value: unknown) => boolean
    ) => {
      withCacheCalls.push({ key, ttl });
      if (key !== null && cacheStore.has(key) && (!accept || accept(cacheStore.get(key)))) return cacheStore.get(key);
      const value = await fetcher();
      if (key !== null && (!storable || storable(value))) cacheStore.set(key, value);
      return value;
    },
  },
}));

const { OrgClaManagerScopesService, claManagerCompanies, isLensAddressableCompanyId } = await import('./org-cla-manager-scopes.service');

const COMPANY_A = '0014100000Te2ovAAB';
const COMPANY_B = '0014100000BetaAAAA';
const PROJECT_1 = 'a09410000182dD2AAI';
const PROJECT_2 = 'a09410000182dD3AAI';

function scope(role: string, id: string[], type = 'project|organization'): Record<string, unknown> {
  return { Role: role, Type: type, ID: id };
}

function payload(...scopes: Record<string, unknown>[]): { Permissions: { Scopes: Record<string, unknown>[] }[] } {
  return { Permissions: [{ Scopes: scopes }] };
}

describe('claManagerCompanies', () => {
  it('takes the company half of each project|organization cla-manager scope', () => {
    const { companySfids } = claManagerCompanies(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    expect([...companySfids]).toEqual([COMPANY_A]);
  });

  it('lists a company once however many CLA Groups it is managed on', () => {
    const { companySfids } = claManagerCompanies(
      payload(scope('cla-manager', [PROJECT_1, COMPANY_A]), scope('cla-manager', [PROJECT_2, COMPANY_A]), scope('cla-manager', [PROJECT_1, COMPANY_B]))
    );

    expect([...companySfids].sort()).toEqual([COMPANY_A, COMPANY_B].sort());
  });

  it('accepts the single-string project|company form', () => {
    const { companySfids } = claManagerCompanies(payload(scope('cla-manager', [`${PROJECT_1}|${COMPANY_A}`])));

    expect([...companySfids]).toEqual([COMPANY_A]);
  });

  it('reads every grant of the one scope user-service returns per role', () => {
    const { companySfids, rejected } = claManagerCompanies(
      payload(scope('cla-manager', [`${PROJECT_1}|${COMPANY_A}`, `${PROJECT_2}|${COMPANY_B}`, `${PROJECT_1}|lf0000000000000001`]))
    );

    expect([...companySfids].sort()).toEqual([COMPANY_A, COMPANY_B].sort());
    expect(rejected).toEqual({ malformed_scope: 0, not_account_id: 1 });
  });

  it.each(['cla-signatory', 'cla-manager-designee', 'company-admin', undefined])(
    'ignores a %s scope even if the role filter is not applied upstream',
    (role) => {
      const { companySfids } = claManagerCompanies(payload({ Role: role, Type: 'project|organization', ID: [PROJECT_1, COMPANY_A] }));

      expect(companySfids.size).toBe(0);
    }
  );

  it('ignores a cla-manager scope that is not project|organization', () => {
    const { companySfids } = claManagerCompanies(payload(scope('cla-manager', [COMPANY_A], 'organization')));

    expect(companySfids.size).toBe(0);
  });

  it.each([
    ['a 15-character id', COMPANY_A.slice(0, 15)],
    ['an Org Service id', 'lf0000000000000001'],
    ['a project id in the company slot', PROJECT_2],
    ['an empty id', ''],
  ])('drops %s and counts it, never listing it', (_label, companyId) => {
    const { companySfids, rejected } = claManagerCompanies(payload(scope('cla-manager', [PROJECT_1, companyId])));

    expect(companySfids.size).toBe(0);
    expect(rejected.not_account_id + rejected.malformed_scope).toBe(1);
  });

  it.each([[[]], [[PROJECT_1]], [[PROJECT_1, COMPANY_A, COMPANY_B]], [undefined]])('drops a scope id shaped %j as malformed', (id) => {
    const { companySfids, rejected } = claManagerCompanies(payload({ Role: 'cla-manager', Type: 'project|organization', ID: id }));

    expect(companySfids.size).toBe(0);
    expect(rejected.malformed_scope).toBe(1);
  });

  it('answers nothing for an empty or missing payload', () => {
    expect(claManagerCompanies(null).companySfids.size).toBe(0);
    expect(claManagerCompanies({}).companySfids.size).toBe(0);
    expect(claManagerCompanies({ Permissions: [{}] }).companySfids.size).toBe(0);
  });
});

describe('isLensAddressableCompanyId', () => {
  it('accepts only the 18-character account id the lens routes key on', () => {
    expect(isLensAddressableCompanyId(COMPANY_A)).toBe(true);
    expect(isLensAddressableCompanyId(COMPANY_A.slice(0, 15))).toBe(false);
    expect(isLensAddressableCompanyId('lf0000000000000001')).toBe(false);
  });
});

describe('OrgClaManagerScopesService', () => {
  const service = new OrgClaManagerScopesService();

  function req(extra: Record<string, unknown> = {}): Request {
    return { ...extra } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    withCacheCalls.length = 0;
    getEffectiveUsername.mockReturnValue('contributor');
    isImpersonating.mockReturnValue(false);
  });

  it('reads the cla-manager role with the caller token', async () => {
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    const sfids = await service.getCompanySfids(req());

    expect([...sfids]).toEqual([COMPANY_A]);
    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), 'https://gw.test/user-service/v1/me/permissions?role=cla-manager', expect.anything());
    expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.not.objectContaining({ bearerToken: expect.anything() }));
  });

  it("forwards the target's token while impersonating", async () => {
    isImpersonating.mockReturnValue(true);
    gatewayFetch.mockResolvedValue(payload());

    await service.getCompanySfids(req({ bearerToken: 'target-user-token' }));

    expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.objectContaining({ bearerToken: 'target-user-token' }));
  });

  it("fails, caching nothing, while impersonating without the target's token", async () => {
    isImpersonating.mockReturnValue(true);
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    await expect(service.getCompanySfids(req())).rejects.toMatchObject({ statusCode: 503, code: 'CLA_MANAGER_SCOPES_LOOKUP_FAILED' });
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });

  it('throws when user-service fails, rather than answering "manages nothing"', async () => {
    gatewayFetch.mockRejectedValue(new Error('timeout'));

    await expect(service.getCompanySfids(req())).rejects.toThrow('timeout');
  });

  it('asks user-service once per request however many callers ask', async () => {
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));
    const one = req();

    await Promise.all([service.getCompanySfids(one), service.getCompanySfids(one)]);

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a non-empty answer for 60 seconds per user', async () => {
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    await service.getCompanySfids(req());
    const second = await service.getCompanySfids(req());

    expect([...second]).toEqual([COMPANY_A]);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(withCacheCalls[0]).toEqual({ key: 'org-cla-manager-scopes:v1:contributor', ttl: 60 });
  });

  it('never stores an empty answer, so a newly added CLA Manager is seen at once', async () => {
    gatewayFetch.mockResolvedValueOnce(payload()).mockResolvedValueOnce(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    await service.getCompanySfids(req());
    expect(cacheStore.size).toBe(0);
    const second = await service.getCompanySfids(req());

    expect([...second]).toEqual([COMPANY_A]);
    expect(gatewayFetch).toHaveBeenCalledTimes(2);
  });

  it('never stores a failure', async () => {
    gatewayFetch.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    await expect(service.getCompanySfids(req())).rejects.toThrow();
    const second = await service.getCompanySfids(req());

    expect([...second]).toEqual([COMPANY_A]);
  });

  it('keys the cache by the effective user, so an impersonated answer is the target', async () => {
    getEffectiveUsername.mockReturnValue('target');
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    await service.getCompanySfids(req());

    expect(withCacheCalls[0].key).toBe('org-cla-manager-scopes:v1:target');
  });

  it('answers nothing, with no lookup, without an authenticated username', async () => {
    getEffectiveUsername.mockReturnValue(null);

    const sfids = await service.getCompanySfids(req());

    expect(sfids.size).toBe(0);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
