// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so runtime collaborators (constants used at import time) and heavier services
// need mocking to isolate searchOrganizationsWithCdp from real network/DB behavior.
const { proxyRequest, findOrganizationByName, findOrganizationByDomain, loggerWarning, snowflakeExecute, withOrgCache } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  snowflakeExecute: vi.fn(),
  // Pass-through: the cache is not what these tests are about, so the fetcher always runs.
  withOrgCache: vi.fn((_id: string, _sub: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  findOrganizationByName: vi.fn(),
  findOrganizationByDomain: vi.fn(),
  loggerWarning: vi.fn(),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./cdp.service', () => ({
  CdpService: class {
    public findOrganizationByName = findOrganizationByName;
    public findOrganizationByDomain = findOrganizationByDomain;
  },
}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute: snowflakeExecute }) },
}));
vi.mock('./valkey.service', () => ({ withOrgCache, withOrgCompactCache: vi.fn(), valkeyService: {} }));
// The `@lfx-one/shared` barrel pulls in Angular-dependent modules that need `@angular/compiler`
// for JIT, unavailable in this plain vitest/Node runtime — mock the subset organization.service.ts
// actually imports (all type-only except isValidDomain, per the utils barrel exception below).
vi.mock('@lfx-one/shared', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({ ORG_LENS_ACCOUNT_CONTEXT_FETCH_CONCURRENCY: 5, VALKEY_CACHE: {}, CDP_LOOKUP_TIMEOUT_MS: 3000 }));
vi.mock('@lfx-one/shared/utils', () => ({
  isValidDomain: (value: string) => /^[^\s.]+(\.[^\s.]+)+$/.test(value),
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: loggerWarning,
    debug: vi.fn(),
    info: vi.fn(),
    sanitize: (v: unknown) => v,
  },
}));

import type { Request } from 'express';

import { OrganizationService } from './organization.service';

const req = {} as unknown as Request;

describe('OrganizationService.searchOrganizationsWithCdp', () => {
  let service: OrganizationService;

  beforeEach(() => {
    proxyRequest.mockReset();
    findOrganizationByName.mockReset();
    findOrganizationByDomain.mockReset();
    loggerWarning.mockReset();
    service = new OrganizationService();
  });

  it('prepends a CDP name hit ahead of Clearbit results and skips the domain lookup for a non-host-shaped query', async () => {
    proxyRequest.mockResolvedValueOnce({ suggestions: [{ name: 'Acme Corp Inc', domain: 'acme-corp.example', logo: '' }] });
    findOrganizationByName.mockResolvedValueOnce({ id: 'cdp-1', name: 'Acme Corp', domain: '', logo: '' });

    const result = await service.searchOrganizationsWithCdp(req, 'Acme Corp');

    expect(findOrganizationByDomain).not.toHaveBeenCalled();
    expect(result[0]).toEqual({ id: 'cdp-1', name: 'Acme Corp', domain: '', logo: '' });
    expect(result).toHaveLength(2);
  });

  it('calls the domain lookup for a host-shaped query and dedupes when both lookups hit the same org', async () => {
    proxyRequest.mockResolvedValueOnce({ suggestions: [] });
    findOrganizationByName.mockResolvedValueOnce({ id: 'cdp-1', name: 'Acme Corp', domain: 'acme-corp.example', logo: '' });
    findOrganizationByDomain.mockResolvedValueOnce({ id: 'cdp-1', name: 'Acme Corp', domain: 'acme-corp.example', logo: '' });

    const result = await service.searchOrganizationsWithCdp(req, 'acme-corp.example');

    expect(findOrganizationByDomain).toHaveBeenCalledWith(req, 'acme-corp.example');
    expect(result).toHaveLength(1);
  });

  it('strips the path from a scheme-less host+path query before the domain lookup', async () => {
    proxyRequest.mockResolvedValueOnce({ suggestions: [] });
    findOrganizationByName.mockResolvedValueOnce(null);
    findOrganizationByDomain.mockResolvedValueOnce({ id: 'cdp-1', name: 'Acme Corp', domain: 'acme-corp.example', logo: '' });

    await service.searchOrganizationsWithCdp(req, 'acme-corp.example/careers');

    expect(findOrganizationByDomain).toHaveBeenCalledWith(req, 'acme-corp.example');
  });

  it('returns CDP-only results when Clearbit rejects but a CDP hit exists', async () => {
    proxyRequest.mockRejectedValueOnce(new Error('upstream down'));
    findOrganizationByName.mockResolvedValueOnce({ id: 'cdp-1', name: 'Acme Corp', domain: '', logo: '' });
    findOrganizationByDomain.mockResolvedValueOnce(null);

    const result = await service.searchOrganizationsWithCdp(req, 'Acme Corp');

    expect(result).toEqual([{ id: 'cdp-1', name: 'Acme Corp', domain: '', logo: '' }]);
    expect(loggerWarning).toHaveBeenCalled();
  });

  it('rethrows the Clearbit error when Clearbit rejects and no CDP hit exists', async () => {
    const clearbitError = new Error('upstream down');
    proxyRequest.mockRejectedValueOnce(clearbitError);
    findOrganizationByName.mockResolvedValueOnce(null);
    findOrganizationByDomain.mockResolvedValueOnce(null);

    await expect(service.searchOrganizationsWithCdp(req, 'Acme Corp')).rejects.toThrow('upstream down');
  });

  it('returns the unaffected Clearbit result when both CDP lookups reject', async () => {
    proxyRequest.mockResolvedValueOnce({ suggestions: [{ name: 'Acme Corp Inc', domain: 'acme-corp.example', logo: '' }] });
    findOrganizationByName.mockRejectedValueOnce(new Error('cdp down'));
    findOrganizationByDomain.mockRejectedValueOnce(new Error('cdp down'));

    const result = await service.searchOrganizationsWithCdp(req, 'acme-corp.example');

    expect(result).toEqual([{ name: 'Acme Corp Inc', domain: 'acme-corp.example', logo: '' }]);
    expect(loggerWarning).toHaveBeenCalled();
  });

  it('degrades to the Clearbit-only result when a CDP lookup hangs past the timeout budget', async () => {
    vi.useFakeTimers();
    try {
      proxyRequest.mockResolvedValueOnce({ suggestions: [{ name: 'Acme Corp Inc', domain: 'acme-corp.example', logo: '' }] });
      findOrganizationByName.mockReturnValueOnce(
        new Promise(() => {
          // never resolves — simulates a stalled CDP lookup for the timeout test below
        })
      );
      findOrganizationByDomain.mockResolvedValueOnce(null);

      const resultPromise = service.searchOrganizationsWithCdp(req, 'Acme Corp');
      await vi.advanceTimersByTimeAsync(3000);
      const result = await resultPromise;

      expect(result).toEqual([{ name: 'Acme Corp Inc', domain: 'acme-corp.example', logo: '' }]);
      expect(loggerWarning).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// #4225 — `CDEV_ORG_ID` is not the view's grain, so this read can match several accounts and the
// caller takes the first. The ordering is the whole correctness story; assert the SQL shape.
describe('OrganizationService.getOrgLensAccountContextByCdevOrgId', () => {
  const CDEV_ORG = '0b7d6b1e-6a2f-4a1f-9c66-9d9a0f0d1234';

  beforeEach(() => {
    snowflakeExecute.mockReset();
    withOrgCache.mockClear();
  });

  it('pins a deterministic single row, preferring a member account over a sibling', async () => {
    snowflakeExecute.mockResolvedValue({ rows: [] });

    await new OrganizationService().getOrgLensAccountContextByCdevOrgId(CDEV_ORG);

    const [sql, binds] = snowflakeExecute.mock.calls[0];
    expect(sql).toContain('WHERE CDEV_ORG_ID = ?');
    expect(sql).toContain('ORDER BY IS_MEMBER DESC NULLS LAST, ACCOUNT_ID ASC');
    expect(sql).toContain('LIMIT 1');
    // One placeholder, one bind — the id is never interpolated into the SQL.
    expect(sql.match(/\?/g)).toHaveLength(1);
    expect(binds).toEqual([CDEV_ORG]);
  });

  it('maps the row to the account context the caller reads `isMember` from', async () => {
    snowflakeExecute.mockResolvedValue({ rows: [{ ACCOUNT_ID: '001', ACCOUNT_NAME: 'Acme Motors', IS_MEMBER: true, CDEV_ORG_ID: CDEV_ORG }] });

    const result = await new OrganizationService().getOrgLensAccountContextByCdevOrgId(CDEV_ORG);

    expect(result).toMatchObject({ accountId: '001', accountName: 'Acme Motors', isMember: true });
  });

  it('answers null for an organization no LF account points at, rather than throwing', async () => {
    snowflakeExecute.mockResolvedValue({ rows: [] });

    await expect(new OrganizationService().getOrgLensAccountContextByCdevOrgId(CDEV_ORG)).resolves.toBeNull();
  });

  it('never queries for an empty id', async () => {
    await expect(new OrganizationService().getOrgLensAccountContextByCdevOrgId('')).resolves.toBeNull();

    expect(snowflakeExecute).not.toHaveBeenCalled();
  });
});
