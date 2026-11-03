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

  it('takes the company half of a project|organization cla-manager-designee scope', () => {
    const { companySfids } = claManagerCompanies(payload(scope('cla-manager-designee', [PROJECT_1, COMPANY_A])));

    expect([...companySfids]).toEqual([COMPANY_A]);
  });

  it('lists the companies of both roles, each once', () => {
    const { companySfids } = claManagerCompanies(
      payload(
        scope('cla-manager', [PROJECT_1, COMPANY_A]),
        scope('cla-manager-designee', [PROJECT_2, COMPANY_B]),
        scope('cla-manager-designee', [PROJECT_2, COMPANY_A])
      )
    );

    expect([...companySfids].sort()).toEqual([COMPANY_A, COMPANY_B].sort());
  });

  it.each(['cla-signatory', 'company-admin', undefined])('ignores a %s scope even if the role filter is not applied upstream', (role) => {
    const { companySfids } = claManagerCompanies(payload({ Role: role, Type: 'project|organization', ID: [PROJECT_1, COMPANY_A] }));

    expect(companySfids.size).toBe(0);
  });

  it.each(['cla-manager', 'cla-manager-designee'])('ignores a %s scope that is not project|organization', (role) => {
    const { companySfids } = claManagerCompanies(payload(scope(role, [COMPANY_A], 'organization')));

    expect(companySfids.size).toBe(0);
  });

  it('drops and counts a cla-manager-designee scope on an Org Service id', () => {
    const { companySfids, rejected } = claManagerCompanies(payload(scope('cla-manager-designee', [PROJECT_1, 'lf0000000000000001'])));

    expect(companySfids.size).toBe(0);
    expect(rejected).toEqual({ malformed_scope: 0, not_account_id: 1 });
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

  function roleOf(url: string): string | undefined {
    return new URL(url).searchParams.get('role') ?? undefined;
  }

  function respondByRole(byRole: Record<string, unknown>) {
    gatewayFetch.mockImplementation(async (_req: Request, url: string) => {
      const answer = byRole[roleOf(url) ?? ''];
      if (answer instanceof Error) throw answer;
      return answer;
    });
  }

  it('asks user-service once per entry role, one role per call, with the caller token', async () => {
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    const sfids = await service.getCompanySfids(req());

    expect([...sfids]).toEqual([COMPANY_A]);
    expect(gatewayFetch).toHaveBeenCalledTimes(2);
    const urls = gatewayFetch.mock.calls.map((call) => call[1] as string);
    for (const url of urls) {
      expect(url).not.toMatch(/,|%2C/i);
      expect(new URL(url).searchParams.getAll('role')).toHaveLength(1);
      expect(url.startsWith('https://gw.test/user-service/v1/me/permissions?role=')).toBe(true);
    }
    expect(urls.map(roleOf).sort()).toEqual(['cla-manager', 'cla-manager-designee']);
    for (const call of gatewayFetch.mock.calls) {
      expect(call[2]).toEqual(expect.not.objectContaining({ bearerToken: expect.anything() }));
    }
  });

  it('lists a cla-manager scope from one answer and a cla-manager-designee scope from the other', async () => {
    respondByRole({
      'cla-manager': payload(scope('cla-manager', [PROJECT_1, COMPANY_A])),
      'cla-manager-designee': payload(scope('cla-manager-designee', [PROJECT_1, COMPANY_B])),
    });

    const sfids = await service.getCompanySfids(req());

    expect([...sfids].sort()).toEqual([COMPANY_A, COMPANY_B].sort());
    expect(cacheStore.get('org-cla-manager-scopes:v1:contributor')).toEqual(expect.arrayContaining([COMPANY_A, COMPANY_B]));
  });

  it.each(['cla-manager', 'cla-manager-designee'])('fails the whole lookup, caching nothing, when the %s call fails', async (failing) => {
    const failure = Object.assign(new Error('Failed to read CLA manager scopes'), { statusCode: 422, code: 'CLA_MANAGER_SCOPES_LOOKUP_FAILED' });
    const other = failing === 'cla-manager' ? 'cla-manager-designee' : 'cla-manager';
    respondByRole({ [failing]: failure, [other]: payload(scope(other, [PROJECT_1, COMPANY_A])) });

    await expect(service.getCompanySfids(req())).rejects.toBe(failure);
    expect(cacheStore.size).toBe(0);
  });

  it("forwards the target's token on both calls while impersonating", async () => {
    isImpersonating.mockReturnValue(true);
    gatewayFetch.mockResolvedValue(payload());

    await service.getCompanySfids(req({ bearerToken: 'target-user-token' }));

    expect(gatewayFetch).toHaveBeenCalledTimes(2);
    for (const call of gatewayFetch.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ bearerToken: 'target-user-token' }));
    }
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

    expect(gatewayFetch).toHaveBeenCalledTimes(2);
  });

  it('reuses a non-empty answer for 60 seconds per user', async () => {
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));

    await service.getCompanySfids(req());
    const second = await service.getCompanySfids(req());

    expect([...second]).toEqual([COMPANY_A]);
    expect(gatewayFetch).toHaveBeenCalledTimes(2);
    expect(withCacheCalls[0]).toEqual({ key: 'org-cla-manager-scopes:v1:contributor', ttl: 60 });
  });

  it('never stores an empty answer, so a newly added CLA Manager is seen at once', async () => {
    gatewayFetch.mockResolvedValue(payload());

    await service.getCompanySfids(req());
    expect(cacheStore.size).toBe(0);
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A])));
    const second = await service.getCompanySfids(req());

    expect([...second]).toEqual([COMPANY_A]);
    expect(gatewayFetch).toHaveBeenCalledTimes(4);
  });

  it('never stores a failure', async () => {
    gatewayFetch.mockResolvedValue(payload(scope('cla-manager', [PROJECT_1, COMPANY_A]))).mockRejectedValueOnce(new Error('timeout'));

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
