// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service imports the `@lfx-one/shared/utils` barrel, whose graph reaches Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest (as in clas.controller.spec.ts).
import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Upstream docs the stubbed query service answers with, keyed by resource type (set per test). */
const { control, upstreamContacts, proxyRequest } = vi.hoisted(() => {
  const upstreamContacts: Record<string, unknown>[] = [];
  const MEMBERSHIP = { uid: 'membership-1', status: 'active', project_slug: 'foundation-one', project_name: 'Foundation One' };
  const ENDED_MEMBERSHIP = { uid: 'membership-ended', status: 'Expired', project_slug: 'foundation-two', project_name: 'Foundation Two' };
  // A second live membership, so a role held on two foundations actually reaches the aggregation.
  const SECOND_MEMBERSHIP = { uid: 'membership-2', status: 'active', project_slug: 'foundation-three', project_name: 'Foundation Three' };
  // `gate` holds the upstream read open; `storable` records what the cache wrapper was told it may persist.
  const control: { gate: Promise<void> | null; storable: boolean[] } = { gate: null, storable: [] };
  return {
    control,
    upstreamContacts,
    // Answer by the `type` param rather than call order, so the fixture does not depend on the
    // service's Promise.all ordering.
    proxyRequest: vi.fn((_req: unknown, _service: string, _path: string, _method: string, params: { type?: string }) =>
      Promise.resolve({
        resources: (params.type === 'key_contact' ? upstreamContacts : [MEMBERSHIP, SECOND_MEMBERSHIP, ENDED_MEMBERSHIP]).map((data) => ({ data })),
        page_token: null,
      })
    ),
  };
});

// Drive the real page callback once so the `type` above is what decides the answer.
vi.mock('../helpers/query-service.helper', () => ({
  fetchAllQueryResources: async (_req: unknown, fetchPage: (token?: string) => Promise<{ resources: { data: unknown }[] }>) => {
    await control.gate;
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
// It records the `storable` fence the service hands it, which is what a write's eviction acts through.
vi.mock('./valkey.service', () => ({
  withPerUserCache: async (
    _ns: string,
    _user: string,
    _key: string,
    _ttl: number,
    compute: () => unknown,
    _accept: unknown,
    storable?: (value: unknown) => boolean
  ) => {
    const value = await compute();
    control.storable.push(storable ? storable(value) : true);
    return value;
  },
}));

import { evictPerUserOrgFetch, resetSingleFlightForTests } from '../utils/single-flight';
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

  it('stays unidentified when the address lookup resolved with no address and no assignment matched', async () => {
    // An LF account with no company email here: its username cannot rule out assignments recorded without one.
    upstream([contact({})]);

    const result = await service.getKeyContactsForPerson(req, ORG_UID, { username: 'jdoe', emails: [], emailsStatus: 'resolved' });

    expect(result).toEqual({ assignments: [], status: 'unidentified' });
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

describe('OrgPeopleKeyContactsService getActiveEmployees', () => {
  const service = new OrgPeopleKeyContactsService();
  const req = {} as Request;

  beforeEach(() => upstream([]));

  it('lists only people holding a role on an active membership, one per address', async () => {
    upstream([
      contact({ username: 'fperson' }),
      contact({ uid: 'contact-2', email: 'first.person@VENDOR-CORP.example', username: 'FPerson', role: 'Legal Contact' }),
      // Still an active role, but on an expired membership: the person behind it is not a key contact today.
      contact({ uid: 'contact-3', membership_uid: 'membership-ended', email: 'lapsed@vendor-corp.example', first_name: 'Lapsed', last_name: 'Contact' }),
    ]);

    const employees = await service.getActiveEmployees(req, ORG_UID);

    expect(employees).toEqual([expect.objectContaining({ email: 'first.person@vendor-corp.example', fullName: 'First Person', lfUsername: 'fperson' })]);
  });

  // #4401: the All Employees Key Contact column renders `roles` from this producer. The directory folds
  // them in with addKeyContactRoles, which no-ops on a missing array, so dropping the field here would
  // empty every Key Contact cell without failing a directory test.
  it('carries the roles the person holds, deduped across memberships and sorted', async () => {
    upstream([
      contact({ username: 'fperson' }),
      contact({ uid: 'contact-2', username: 'fperson', role: 'Legal Contact' }),
      // Same role on a second LIVE foundation membership — one pill, not two.
      contact({ uid: 'contact-3', membership_uid: 'membership-2', username: 'fperson', role: 'Billing Contact' }),
      // Active role, expired membership: not a role they hold today, so not in the column either.
      contact({ uid: 'contact-4', membership_uid: 'membership-ended', username: 'fperson', role: 'PR Contact' }),
    ]);

    const [employee] = await service.getActiveEmployees(req, ORG_UID);

    expect(employee.roles).toEqual(['Billing Contact', 'Legal Contact']);
  });

  it('leaves the username unset when the assignments at one address disagree on it', async () => {
    upstream([contact({ username: 'fperson' }), contact({ uid: 'contact-2', username: 'someone-else', role: 'Legal Contact' })]);

    const [employee] = await service.getActiveEmployees(req, ORG_UID);

    expect(employee.lfUsername).toBeNull();
  });
});

describe('OrgPeopleKeyContactsService getKeyContacts cache fence', () => {
  const service = new OrgPeopleKeyContactsService();
  const req = {} as Request;

  beforeEach(() => {
    upstream([contact({})]);
    control.gate = null;
    control.storable.length = 0;
    resetSingleFlightForTests();
  });

  it('lets an undisturbed read persist', async () => {
    await service.getKeyContacts(req, ORG_UID);

    expect(control.storable).toEqual([true]);
  });

  // The All Employees directory reads through this entry and a key-contact write evicts it. The eviction
  // only works on a flight that is registered, so a read already in flight when the write lands must be
  // served to its own caller but not stored over the delete.
  it('does not persist a read that a write evicted while it was in flight', async () => {
    let release!: () => void;
    control.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = service.getKeyContacts(req, ORG_UID);
    evictPerUserOrgFetch('org-people-kc:v1', 'caller', ORG_UID);
    release();

    expect((await pending).assignments).toHaveLength(1);
    expect(control.storable).toEqual([false]);
  });

  it('joins a concurrent read instead of starting a second upstream fetch', async () => {
    proxyRequest.mockClear();
    let release!: () => void;
    control.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = service.getKeyContacts(req, ORG_UID);
    const second = service.getKeyContacts(req, ORG_UID);
    release();
    await Promise.all([first, second]);

    // One read is two upstream calls (contacts and memberships), not four.
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });
});
