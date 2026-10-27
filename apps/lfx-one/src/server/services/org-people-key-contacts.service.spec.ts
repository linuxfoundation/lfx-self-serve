// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Upstream docs the stubbed query service answers with, keyed by resource type (set per test). */
const { upstreamContacts, proxyRequest } = vi.hoisted(() => {
  const upstreamContacts: Record<string, unknown>[] = [];
  const MEMBERSHIP = { uid: 'membership-1', status: 'active', project_slug: 'foundation-one', project_name: 'Foundation One' };
  return {
    upstreamContacts,
    // Answer by the `type` param rather than call order, so the fixture does not depend on the
    // service's Promise.all ordering.
    proxyRequest: vi.fn((_req: unknown, _service: string, _path: string, _method: string, params: { type?: string }) =>
      Promise.resolve({
        resources: (params.type === 'key_contact' ? upstreamContacts : [MEMBERSHIP]).map((data) => ({ data })),
        page_token: null,
      })
    ),
  };
});

// Drive the real page callback once so the `type` above is what decides the answer.
vi.mock('../helpers/query-service.helper', () => ({
  fetchAllQueryResources: async (_req: unknown, fetchPage: (token?: string) => Promise<{ resources: { data: unknown }[] }>) => {
    const response = await fetchPage(undefined);
    return response.resources.map((resource) => resource.data);
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'caller' }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
// Exercise the real read path, not the cache: every call recomputes from the stubbed query service.
vi.mock('./valkey.service', () => ({
  withPerUserCache: (_ns: string, _user: string, _key: string, _ttl: number, compute: () => unknown) => compute(),
}));

import { OrgPeopleKeyContactsService } from './org-people-key-contacts.service';

const ORG_UID = '001410000000000AAA';

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

function upstream(contacts: Record<string, unknown>[]): void {
  upstreamContacts.length = 0;
  upstreamContacts.push(...contacts);
}

describe('OrgPeopleKeyContactsService getKeyContactsForPerson', () => {
  const service = new OrgPeopleKeyContactsService();
  const req = {} as Request;

  beforeEach(() => {
    proxyRequest.mockClear();
    upstream([]);
  });

  it('matches a person on their address, ignoring case and surrounding space', async () => {
    upstream([contact({}), contact({ uid: 'contact-2', email: 'someone.else@vendor-corp.example', role: 'Legal Contact' })]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, {
      emails: ['  FIRST.PERSON@vendor-corp.example '],
      emailsStatus: 'resolved',
    });

    expect(result.status).toBe('resolved');
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
      emailsStatus: 'resolved',
    });

    // 'rroe' shares the address but not the username; contact-3 has no username, so it falls back to the address.
    expect(result.assignments.map((a) => a.role).sort()).toEqual(['Billing Contact', 'PR Contact']);
  });

  it('reports an identity with neither key as unidentified without reading upstream', async () => {
    upstream([contact({})]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { username: '  ', emails: ['', '   '], emailsStatus: 'unavailable' });

    expect(result).toEqual({ assignments: [], status: 'unidentified' });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('reports a fully identified person with no matching assignment as a verified empty list', async () => {
    upstream([contact({})]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { emails: ['nobody@vendor-corp.example'], emailsStatus: 'resolved' });

    expect(result).toEqual({ assignments: [], status: 'resolved' });
  });

  // The decisive case: a username alone cannot rule out the assignments upstream records without one,
  // so an unmatched partial identity must never be reported as "holds no roles".
  it.each([
    { label: 'the address lookup errored', emailsStatus: 'failed' as const, expected: 'failed' },
    { label: 'no address was available', emailsStatus: 'unavailable' as const, expected: 'unidentified' },
  ])('does not claim an empty list from a username-only identity when $label', async ({ emailsStatus, expected }) => {
    upstream([contact({})]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { username: 'jdoe', emails: [], emailsStatus });

    expect(result).toEqual({ assignments: [], status: expected });
  });

  it('still trusts a username-only identity that did match, whatever the address lookup did', async () => {
    upstream([contact({ username: 'jdoe' })]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { username: 'jdoe', emails: [], emailsStatus: 'failed' });

    expect(result.status).toBe('resolved');
    expect(result.assignments.map((a) => a.role)).toEqual(['Billing Contact']);
  });
});
