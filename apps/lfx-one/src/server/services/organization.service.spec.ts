// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so runtime collaborators (constants used at import time) and heavier services
// need mocking to isolate searchOrganizationsWithCdp from real network/DB behavior.
const { proxyRequest, findOrganizationByName, findOrganizationByDomain, loggerWarning } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
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
  SnowflakeService: { getInstance: () => ({}) },
}));
// The `@lfx-one/shared` barrel pulls in Angular-dependent modules that need `@angular/compiler`
// for JIT, unavailable in this plain vitest/Node runtime — mock the subset organization.service.ts
// actually imports (all type-only except isValidDomain, per the utils barrel exception below).
vi.mock('@lfx-one/shared', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({ ORG_LENS_ACCOUNT_CONTEXT_FETCH_CONCURRENCY: 5, VALKEY_CACHE: {} }));
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
});
