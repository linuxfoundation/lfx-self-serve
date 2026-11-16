// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, readOrgFormerUsernames, resolveOrgLensEdit, cacheStorable } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  readOrgFormerUsernames: vi.fn(),
  resolveOrgLensEdit: vi.fn(),
  cacheStorable: { last: undefined as boolean | undefined },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./org-lens-key-contacts.service', () => ({ OrgLensKeyContactsService: class {} }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({}) } }));
vi.mock('../helpers/org-people-employment.helper', () => ({ readOrgFormerUsernames }));
// Pass-through cache: every read runs its loader so the mapping under test is exercised directly; the store
// decision is recorded so a test can assert what would be cached.
vi.mock('./valkey.service', () => ({
  withPerUserCache: async (
    _ns: string,
    _user: string,
    _org: string,
    _ttl: number,
    loader: () => Promise<unknown>,
    _accept?: unknown,
    storable?: (value: unknown) => boolean
  ) => {
    const value = await loader();
    cacheStorable.last = storable ? storable(value) : true;
    return value;
  },
  invalidatePerUserCache: vi.fn(),
}));
vi.mock('../helpers/org-lens-edit-access.helper', () => ({ resolveOrgLensEdit }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'ada' }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { SYNTHETIC_ORG_ACCOUNT_ID as ORG_UID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensAccessService } from './org-lens-access.service';

const req = {} as Request;

// lfx-self-serve#4627 — the Access tab's Employment filter reads `isFormer` off each listed principal.
describe('OrgLensAccessService.listAccessUsers — former employees who still hold access', () => {
  beforeEach(() => {
    proxyRequest.mockReset();
    readOrgFormerUsernames.mockReset();
    resolveOrgLensEdit.mockResolvedValue({ kind: 'allowed' });
    cacheStorable.last = undefined;
    proxyRequest.mockResolvedValue({
      writers: [{ email: 'ada@acme-motors.example', username: 'Ada', name: 'Ada Lovelace' }],
      auditors: [
        { email: 'grace@acme-motors.example', username: 'grace', name: 'Grace Hopper' },
        { email: 'invitee@acme-motors.example', name: 'Pending Invitee' },
      ],
    });
  });

  it("flags an accepted principal whose username is one of the account's former employees, and nobody else", async () => {
    readOrgFormerUsernames.mockResolvedValue(['grace', 'someone-else']);

    const { users } = await new OrgLensAccessService().listAccessUsers(req, ORG_UID);

    expect(users.map((user) => [user.email, user.isFormer])).toEqual([
      ['ada@acme-motors.example', false],
      ['grace@acme-motors.example', true],
      ['invitee@acme-motors.example', false],
    ]);
    expect(readOrgFormerUsernames).toHaveBeenCalledWith(expect.anything(), ORG_UID);
    expect(cacheStorable.last).toBe(true);
  });

  it('keeps the address, name, role and summary of a former principal as they were', async () => {
    readOrgFormerUsernames.mockResolvedValue(['grace']);

    const { users, summary } = await new OrgLensAccessService().listAccessUsers(req, ORG_UID);

    expect(users.find((user) => user.isFormer)).toMatchObject({ email: 'grace@acme-motors.example', name: 'Grace Hopper', role: 'viewer' });
    expect(summary).toEqual({ totalUsers: 3, administrators: 1, viewers: 1 });
  });

  it('flags nobody former, marks the employment classification unavailable and caches nothing when the former employees read fails', async () => {
    readOrgFormerUsernames.mockRejectedValue(new Error('warehouse down'));

    const list = await new OrgLensAccessService().listAccessUsers(req, ORG_UID);

    expect(list.users.every((user) => user.isFormer === false)).toBe(true);
    expect(list.employmentUnavailable).toBe(true);
    expect(cacheStorable.last).toBe(false);
  });

  it('leaves the employment classification available when the former employees read succeeds', async () => {
    readOrgFormerUsernames.mockResolvedValue([]);

    const list = await new OrgLensAccessService().listAccessUsers(req, ORG_UID);

    expect('employmentUnavailable' in list).toBe(false);
  });

  it('matches a mixed-case, padded settings username against the lowercased former employees', async () => {
    proxyRequest.mockResolvedValue({ auditors: [{ email: 'grace@acme-motors.example', username: '  GrAce ', name: 'Grace Hopper' }] });
    readOrgFormerUsernames.mockResolvedValue(['grace']);

    const { users } = await new OrgLensAccessService().listAccessUsers(req, ORG_UID);

    expect(users).toEqual([expect.objectContaining({ username: 'grace', isFormer: true })]);
  });

  it('flags former principals on the refreshed list a write returns', async () => {
    readOrgFormerUsernames.mockResolvedValue(['grace']);

    const { users } = await new OrgLensAccessService().listAccessUsers(req, ORG_UID, true);

    expect(users.filter((user) => user.isFormer).map((user) => user.email)).toEqual(['grace@acme-motors.example']);
  });
});

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
