// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeServiceOrgSeat, CommitteeServiceOrgSeatPage } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-groups.service.spec.ts: the collaborators are constructed in
// `OrgLensBoardCommitteeService`'s constructor, so they must be mocked at module level.
const { proxyRequest, getEffectiveUsername } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'tester' as string | null),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./org-lens-key-contacts.service', () => ({ OrgLensKeyContactsService: class {} }));
vi.mock('./org-lens-memberships.service', () => ({ OrgLensMembershipsService: class {} }));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../helpers/avatar.helper', () => ({ resolveSeatAvatar: vi.fn(() => null) }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));

// A miniature Valkey rather than a pass-through: JSON in, JSON out, with the service's own `accept`
// guard deciding whether a stored entry is a hit. That is what makes a "cache hit" here the real
// thing — encoded, serialized, guarded and decoded — instead of the fetcher's own object handed
// straight back, which would test nothing about the stored shape.
const cache = vi.hoisted(() => ({ entry: null as string | null, accept: null as ((value: unknown) => boolean) | null, readThroughs: 0 }));
vi.mock('./valkey.service', () => ({
  invalidateOrgGroupsCache: vi.fn(),
  withPerUserCache: async (_ns: string, _user: string, _org: string, _ttl: number, fetcher: () => Promise<unknown>, accept?: (value: unknown) => boolean) => {
    cache.readThroughs += 1;
    cache.accept = accept ?? null;
    if (cache.entry !== null) {
      const stored = JSON.parse(cache.entry);
      if (!accept || accept(stored)) return stored;
    }
    const fresh = await fetcher();
    cache.entry = JSON.stringify(fresh);
    return fresh;
  },
}));

// The `@lfx-one/shared/*` barrels pull Angular into this node-environment suite. The compact-cache
// helpers and the filter-safety predicates are re-exported from their REAL modules: the whole point
// of these tests is that a seat survives the actual encoder, not a restatement of it.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// The stored column lists are re-exported from their REAL module, so the guard tests run against
// the writer's actual contract rather than a copy that could silently drift from it.
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('@lfx-one/shared/constants/org-lens-cache.constants')),
  isBoardCategory: (category: string | null | undefined) => (category ?? '').trim().toLowerCase() === 'board',
  VALKEY_CACHE: { ORG_SEATS_NAMESPACE: 'org-seats:v2', ORG_LENS_PERUSER_TTL_SECONDS: 30 },
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('@lfx-one/shared/utils/compact-cache.utils')),
  ...(await vi.importActual<object>('@lfx-one/shared/utils/org-selector.utils')),
}));

import type { Request } from 'express';

import { resetSingleFlightForTests } from '../utils/single-flight';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';

const ORG = '0014100000Te2ovAAB';
const req = {} as unknown as Request;

/** A promise the test settles by hand, so a second caller can arrive while the first drain is still pending. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A fully populated seat, as committee-service returns one. */
function seat(over: Partial<CommitteeServiceOrgSeat> = {}): CommitteeServiceOrgSeat {
  return {
    uid: 'seat-1',
    committee_uid: 'c-1',
    committee_name: 'WG Identity & Trust',
    committee_category: 'Working Group',
    project_uid: 'p-1',
    project_slug: 'identity',
    first_name: 'Devon',
    last_name: 'Clarke',
    email: 'dclarke@lfx-partner.example',
    job_title: 'VP Product',
    role_name: 'Member',
    voting_status: 'Voting Rep',
    appointed_by: 'Membership Entitlement',
    organization_id: ORG,
    is_org_editable: true,
    reason: null,
    avatar: 'https://avatars.lfx-partner.example/dclarke.png',
    username: 'dclarke',
    ...over,
  };
}

/**
 * A seat whose optional fields never arrived at all — the case the cache has to reproduce exactly,
 * since `JSON.stringify` drops an undefined-valued key on the uncached path.
 */
function sparseSeat(): CommitteeServiceOrgSeat {
  return {
    uid: 'seat-3',
    committee_uid: 'c-2',
    committee_name: 'Governing Board',
    committee_category: 'Board',
    first_name: 'Rowan',
    last_name: 'Vega',
    email: 'rvega@lfx-partner.example',
    role_name: 'Director',
    voting_status: 'Voting Rep',
    appointed_by: 'Membership Entitlement',
    organization_id: ORG,
    is_org_editable: false,
  };
}

function page(seats: CommitteeServiceOrgSeat[]): CommitteeServiceOrgSeatPage {
  return { seats, page_token: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSingleFlightForTests();
  cache.entry = null;
  cache.accept = null;
  cache.readThroughs = 0;
  getEffectiveUsername.mockReturnValue('tester');
});

describe('OrgLensBoardCommitteeService.fetchAllOrgSeats — cache round trip (GH-1906)', () => {
  // The invariant the compaction rests on: what a cache hit returns has to be what the drain
  // returned. Seats share a committee (so the dictionary is exercised) and one arrives without its
  // optional fields (so the absent-vs-null distinction is exercised).
  it('returns seats deep-equal to the uncached drain, including avatar and organization_id', async () => {
    const drained = [seat(), seat({ uid: 'seat-2', email: 'mrivas@lfx-partner.example', username: 'mrivas' }), sparseSeat()];
    proxyRequest.mockResolvedValue(page(drained));
    const service = new OrgLensBoardCommitteeService();

    const miss = await service.fetchAllOrgSeats(req, ORG);
    const hit = await service.fetchAllOrgSeats(req, ORG);

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    // Against the DRAINED roster, not hit-vs-miss: the miss path returns the decoded envelope too, so
    // comparing the two only proves the encoder is self-consistent, not that it is faithful.
    expect(miss).toStrictEqual(drained);
    expect(hit).toStrictEqual(drained);
    expect(hit[0].avatar).toBe('https://avatars.lfx-partner.example/dclarke.png');
    expect(hit[0].organization_id).toBe(ORG);
    expect(hit[0].committee_name).toBe('WG Identity & Trust');
  });

  // committee-service copies committee/project fields onto each member record, so members of one
  // committee can disagree — a pre-backfill member with no `project_uid`, or one a failed re-sync left
  // in another category. The dictionary must not collapse them: with the stale member FIRST, a
  // uid-keyed dictionary stamped its values onto the whole committee, dropping every member's
  // foundation and moving seats between the Board and Committee tabs.
  it('keeps each seat’s own committee fields when members of one committee disagree', async () => {
    const stale = seat({ uid: 'seat-0' });
    delete stale.project_uid;
    delete stale.project_slug;
    // …and `organization_id` is no exception: it rides in the same dictionary, so a seat that
    // disagrees keeps its own value instead of inheriting the first seat's.
    const drained = [stale, seat(), seat({ uid: 'seat-4', committee_category: 'Board' }), seat({ uid: 'seat-5', organization_id: '0014100000OtherAAA' })];
    proxyRequest.mockResolvedValue(page(drained));
    const service = new OrgLensBoardCommitteeService();

    const miss = await service.fetchAllOrgSeats(req, ORG);
    const hit = await service.fetchAllOrgSeats(req, ORG);

    expect(miss).toStrictEqual(drained);
    expect(hit).toStrictEqual(drained);
  });

  // `toEqual` ignores keys whose value is `undefined`, so field PRESENCE is asserted
  // directly: a seat that arrived without `job_title`/`avatar` must come back without them, not
  // carrying nulls the uncached response never had.
  it('reproduces which fields were absent, not just their values', async () => {
    proxyRequest.mockResolvedValue(page([sparseSeat()]));
    const service = new OrgLensBoardCommitteeService();

    const miss = await service.fetchAllOrgSeats(req, ORG);
    const hit = await service.fetchAllOrgSeats(req, ORG);

    expect(Object.keys(hit[0]).sort()).toEqual(Object.keys(miss[0]).sort());
    expect('job_title' in hit[0]).toBe(false);
    expect('avatar' in hit[0]).toBe(false);
    expect('project_uid' in hit[0]).toBe(false);
  });

  // A pre-compaction (`org-seats:v1`) entry is a plain seat array. It must miss and be re-drained,
  // never decoded — the namespace bump is the first line of defence, this guard is the second.
  it('rejects a legacy seat-array entry as a miss', async () => {
    proxyRequest.mockResolvedValue(page([seat()]));
    const service = new OrgLensBoardCommitteeService();
    await service.fetchAllOrgSeats(req, ORG);

    expect(cache.accept).toBeTypeOf('function');
    expect(cache.accept!([seat()])).toBe(false);
    expect(cache.accept!(JSON.parse(cache.entry!))).toBe(true);
  });

  // An out-of-range committee index would otherwise decode into a seat with no committee identity
  // at all, which the Board/Committee split then silently misfiles.
  it('rejects an entry whose committee index points past the dictionary', async () => {
    proxyRequest.mockResolvedValue(page([seat()]));
    const service = new OrgLensBoardCommitteeService();
    await service.fetchAllOrgSeats(req, ORG);
    const stored = JSON.parse(cache.entry!);

    stored.s.r[0][stored.s.k.indexOf('c')] = 7;

    expect(cache.accept!(stored)).toBe(false);
  });

  // Corrupt or foreign entries that fromColumnar would otherwise decode "successfully" into seats
  // silently missing their committee: a duplicated `c` column lets a later out-of-range index
  // overwrite the valid first one, and an empty committee row decodes to no committee fields at all.
  it.each([
    [
      'a duplicated committee-index column',
      (stored: { s: { k: string[]; r: unknown[][] } }) => {
        stored.s.k = [...stored.s.k, 'c'];
        stored.s.r = stored.s.r.map((row) => [...row, 99]);
      },
    ],
    [
      'an empty committee row',
      (stored: { c: { k: string[]; r: unknown[][] } }) => {
        stored.c.r = [[]];
      },
    ],
    [
      'a committee table missing a column',
      (stored: { c: { k: string[]; r: unknown[][] } }) => {
        stored.c.k = stored.c.k.slice(1);
        stored.c.r = stored.c.r.map((row) => row.slice(1));
      },
    ],
  ])('rejects an entry with %s', async (_label, corrupt) => {
    proxyRequest.mockResolvedValue(page([seat()]));
    const service = new OrgLensBoardCommitteeService();
    await service.fetchAllOrgSeats(req, ORG);
    const stored = JSON.parse(cache.entry!);

    corrupt(stored);

    expect(cache.accept!(stored)).toBe(false);
  });
});

describe('OrgLensBoardCommitteeService.fetchAllOrgSeats — coalescing (GH-1906)', () => {
  // Two tabs opening at once must not drain committee-service twice; the drain outlives the 30s
  // entry it produces, so the cache alone cannot prevent this.
  it('drains once for concurrent callers with the same principal', async () => {
    const gate = deferred<CommitteeServiceOrgSeatPage>();
    proxyRequest.mockReturnValue(gate.promise);
    const service = new OrgLensBoardCommitteeService();

    const both = Promise.all([service.fetchAllOrgSeats(req, ORG), service.fetchAllOrgSeats(req, ORG)]);
    gate.resolve(page([seat()]));
    const [first, second] = await both;

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    // One burst is one read-through: a single cache read and a single serialized write, not one per
    // joined caller on the connection the session store shares.
    expect(cache.readThroughs).toBe(1);
    expect(first).toEqual(second);
    // Each caller rebuilds its own array from the shared stored envelope, so no consumer can
    // mutate another's roster.
    expect(first).not.toBe(second);
  });

  // The fail-closed rule: `withPerUserCache` refuses to build a key for an unresolvable principal
  // and fetches directly, and the coalescing must refuse on exactly the same terms — a shared
  // bucket keyed on a blank username would serve one caller's filtered roster to another.
  it('does not coalesce callers with no resolvable username', async () => {
    getEffectiveUsername.mockReturnValue(null);
    const gate = deferred<CommitteeServiceOrgSeatPage>();
    proxyRequest.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(page([seat({ uid: 'seat-2' })]));
    const service = new OrgLensBoardCommitteeService();

    const both = Promise.all([service.fetchAllOrgSeats(req, ORG), service.fetchAllOrgSeats(req, ORG)]);
    gate.resolve(page([seat()]));
    const [first, second] = await both;

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(first[0].uid).toBe('seat-1');
    expect(second[0].uid).toBe('seat-2');
  });
});
