// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchAllQueryResources } = vi.hoisted(() => ({ fetchAllQueryResources: vi.fn() }));

vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'caller' }));
vi.mock('./microservice-proxy.service', () => ({ MicroserviceProxyService: class {} }));
// Exercise the real read path, not the cache: every call recomputes from the stubbed query service.
vi.mock('./valkey.service', () => ({
  withPerUserCache: (_ns: string, _user: string, _key: string, _ttl: number, compute: () => unknown) => compute(),
}));

import { OrgPeopleKeyContactsService } from './org-people-key-contacts.service';

const ORG_UID = '001410000000000AAA';
const MEMBERSHIP = { uid: 'membership-1', status: 'active', project_slug: 'foundation-one', project_name: 'Foundation One' };

/** One upstream key_contact doc; `username` is left off unless a test is about username matching. */
function contact(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    uid: 'contact-1',
    membership_uid: 'membership-1',
    email: 'First.Person@vendor-corp.example',
    first_name: 'First',
    last_name: 'Person',
    role: 'Billing Contact',
    status: 'active',
    ...overrides,
  };
}

describe('OrgPeopleKeyContactsService getKeyContactsForPerson', () => {
  const service = new OrgPeopleKeyContactsService();
  const req = {} as Request;

  function upstream(contacts: Record<string, unknown>[]): void {
    fetchAllQueryResources.mockReset();
    fetchAllQueryResources.mockImplementation((_req: unknown, page: unknown, opts?: unknown) => {
      void page;
      void opts;
      return Promise.resolve(fetchAllQueryResources.mock.calls.length === 1 ? contacts : [MEMBERSHIP]);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches a person on their address, ignoring case and surrounding space', async () => {
    upstream([contact({}), contact({ uid: 'contact-2', email: 'someone.else@vendor-corp.example', role: 'Legal Contact' })]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { emails: ['  FIRST.PERSON@vendor-corp.example '] });

    expect(result.identified).toBe(true);
    expect(result.assignments.map((a) => a.role)).toEqual(['Billing Contact']);
  });

  it('lets the username decide when both sides carry one, so a shared address cannot pull in another person', async () => {
    upstream([
      contact({ username: 'jdoe' }),
      contact({ uid: 'contact-2', username: 'rroe', role: 'Legal Contact' }),
      contact({ uid: 'contact-3', role: 'PR Contact' }),
    ]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, {
      username: 'JDoe',
      emails: ['first.person@vendor-corp.example'],
    });

    // 'rroe' shares the address but not the username; contact-3 has no username, so it falls back to the address.
    expect(result.assignments.map((a) => a.role).sort()).toEqual(['Billing Contact', 'PR Contact']);
  });

  it('reports an identity with neither key as unidentified without reading upstream', async () => {
    upstream([contact({})]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { username: '  ', emails: ['', '   '] });

    expect(result).toEqual({ assignments: [], identified: false });
    expect(fetchAllQueryResources).not.toHaveBeenCalled();
  });

  it('reports a person with no matching assignment as identified and empty', async () => {
    upstream([contact({})]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { emails: ['nobody@vendor-corp.example'] });

    expect(result).toEqual({ assignments: [], identified: true });
  });
});
