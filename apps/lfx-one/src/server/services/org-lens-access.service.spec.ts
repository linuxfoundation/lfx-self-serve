// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./org-lens-key-contacts.service', () => ({ OrgLensKeyContactsService: class {} }));
// Pass-through cache: every read runs its loader so the mapping under test is exercised directly.
vi.mock('./valkey.service', () => ({
  withPerUserCache: (_ns: string, _user: string, _org: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  invalidatePerUserCache: vi.fn(),
}));
vi.mock('../helpers/org-lens-edit-access.helper', () => ({ resolveOrgLensEdit: vi.fn() }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'ada' }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { SYNTHETIC_ORG_ACCOUNT_ID as ORG_UID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensAccessService } from './org-lens-access.service';

const req = {} as Request;

describe('OrgLensAccessService.getAccessPrincipals — display names', () => {
  beforeEach(() => proxyRequest.mockReset());

  it('returns plain-text names, stripping markup and invisible characters from upstream values', async () => {
    proxyRequest.mockResolvedValue({
      writers: [{ email: 'grace@acme-motors.example', username: 'grace', name: '<img src="https://h.example/p.gif"><a href="https://h.example">x</a>' }],
      auditors: [
        { email: 'ada@acme-motors.example', username: 'ada', name: 'Ada\u202E Lovelace' },
        { email: '<b>@acme-motors.example', name: '' },
      ],
    });

    const users = await new OrgLensAccessService().getAccessPrincipals(req, ORG_UID);

    for (const user of users) {
      expect(user.name).not.toMatch(/[<>]/);
      expect(user.name).not.toContain('\u202E');
    }
    expect(users.map((u) => u.name)).toEqual(expect.arrayContaining(['Ada Lovelace', 'b']));
  });

  it('never falls back to a raw email that carries markup', async () => {
    proxyRequest.mockResolvedValue({ auditors: [{ email: '<>@acme-motors.example', name: '' }] });

    const [user] = await new OrgLensAccessService().getAccessPrincipals(req, ORG_UID);

    expect(user.name).toBe('@acme-motors.example');
  });
});
