// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac } from 'crypto';

import type {
  OrgAccessUser,
  OrgAllEmployeeCountedRow,
  OrgAllEmployeeRowInternal,
  OrgAllEmployeesInternalResponse,
  OrgAllEmployeesResponse,
  OrgCommitFilters,
  OrgLensTimeRange,
  KeyContactEmployee,
} from '@lfx-one/shared/interfaces';
import type * as CompactCacheUtils from '@lfx-one/shared/utils/compact-cache.utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so runtime collaborators are mocked. The four source services are constructed in
// OrgPeopleDirectoryService's constructor, so they must be mocked at module level.
const {
  getAllEmployeesInternal,
  resolveOrgScope,
  getFormerUsernames,
  getTeamMemberPersonKeys,
  fetchAllOrgSeats,
  getKeyContactEmployees,
  getAccessPrincipals,
  getEffectiveUsername,
  cache,
} = vi.hoisted(() => ({
  getAllEmployeesInternal: vi.fn(),
  resolveOrgScope: vi.fn(),
  getFormerUsernames: vi.fn(),
  getTeamMemberPersonKeys: vi.fn(),
  fetchAllOrgSeats: vi.fn(),
  getKeyContactEmployees: vi.fn(),
  getAccessPrincipals: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'tester' as string | null),
  cache: {
    serveHits: false,
    entry: null as string | null,
    accept: null as ((value: unknown) => boolean) | null,
    readThroughs: 0,
    /** Namespace of every read-through, in call order. */
    namespaces: [] as string[],
    /** JSON of the rows handed to the encoder — the uncached stored rows, every code count included. */
    encodedRows: null as string | null,
  },
}));

vi.mock('./org-lens-people.service', () => ({
  OrgLensPeopleService: class {
    public getAllEmployeesInternal = getAllEmployeesInternal;
    public resolveOrgScope = resolveOrgScope;
    public getFormerUsernames = getFormerUsernames;
    public getTeamMemberPersonKeys = getTeamMemberPersonKeys;
  },
}));
vi.mock('./org-lens-board-committee.service', () => ({
  OrgLensBoardCommitteeService: class {
    public fetchAllOrgSeats = fetchAllOrgSeats;
  },
}));
vi.mock('./org-lens-key-contacts.service', () => ({
  OrgLensKeyContactsService: class {
    public getEmployees = getKeyContactEmployees;
  },
}));
vi.mock('./org-lens-access.service', () => ({
  OrgLensAccessService: class {
    public getAccessPrincipals = getAccessPrincipals;
  },
}));
// A miniature Valkey: JSON in, JSON out, with the service's own `accept` guard deciding whether a
// stored entry is a hit. That is what makes a "cache hit" here the real thing — encoded,
// serialized, guarded and decoded — instead of the fetcher's own object handed straight back.
//
// Writes are always captured (the guard tests read the stored entry), but SERVING a hit is opt-in
// per test: the merge tests below are about the merge and several of them call `run()` more than
// once expecting a fresh computation each time.
vi.mock('./valkey.service', () => ({
  withPerUserCache: async (
    ns: string,
    _user: string,
    _org: string,
    _ttl: number,
    fetcher: () => Promise<unknown>,
    accept?: (value: unknown) => boolean,
    storable?: (value: unknown) => boolean
  ) => {
    cache.readThroughs += 1;
    cache.namespaces.push(ns);
    cache.accept = accept ?? null;
    if (cache.serveHits && cache.entry !== null) {
      const stored = JSON.parse(cache.entry);
      if (!accept || accept(stored)) return stored;
    }
    const fresh = await fetcher();
    if (!storable || storable(fresh)) cache.entry = JSON.stringify(fresh);
    return fresh;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));

// The `@lfx-one/shared/*` barrels pull Angular into this node-environment suite, so the handful of
// runtime values the service imports are stubbed here (same approach as ai.service.spec.ts /
// committee-engagement.service.spec.ts). `isBoardCategory` and `splitDisplayName` mirror the real
// implementations, since the merge's board-vs-committee split and name fill depend on their behaviour.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// The stored column list is re-exported from its REAL module, so the guard and round-trip tests run
// against the writer's actual contract rather than a copy that could silently drift from it.
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('@lfx-one/shared/constants/org-lens-cache.constants')),
  ...(await vi.importActual<object>('@lfx-one/shared/constants/org-commit-filters.constants')),
  ...(await vi.importActual<object>('@lfx-one/shared/constants/org-people.constants')),
  VALKEY_CACHE: {
    ORG_PEOPLE_DIRECTORY_NAMESPACE: 'org-people-dir:v6',
    ORG_LENS_PERUSER_TTL_SECONDS: 30,
  },
  DEFAULT_ORG_TEAM_MEMBERS: 'exclude',
  isBoardCategory: (category: string | null | undefined) => (category ?? '').trim().toLowerCase() === 'board',
}));
// The compact-cache helpers and the filter-safety predicates are re-exported from their REAL
// modules: the round-trip tests below are only meaningful against the actual encoder, and the
// coalescing's fail-closed rule against the actual allowlists.
vi.mock('@lfx-one/shared/utils', async () => {
  const compact = await vi.importActual<typeof CompactCacheUtils>('@lfx-one/shared/utils/compact-cache.utils');
  return {
    ...compact,
    ...(await vi.importActual<object>('@lfx-one/shared/utils/org-selector.utils')),
    ...(await vi.importActual<object>('@lfx-one/shared/utils/org-people-stats.utils')),
    // The real encoder, observed: what goes IN is the independent truth the round-trip test compares
    // the decoded response against. Comparing a hit with a miss alone cannot catch an unfaithful
    // codec, because the miss path returns the decoded envelope too.
    toColumnar: (rows: readonly Record<string, unknown>[], keys: readonly string[]) => {
      cache.encodedRows = JSON.stringify(rows);
      return compact.toColumnar(rows, keys);
    },
    splitDisplayName: (name: string | null): [string | null, string | null] => {
      const trimmed = (name ?? '').trim();
      if (!trimmed || trimmed.includes('@')) return [null, null];
      const parts = trimmed.split(/\s+/);
      return parts.length === 1 ? [parts[0], null] : [parts[0], parts.slice(1).join(' ')];
    },
  };
});

import { DEFAULT_ORG_COMMIT_FILTERS } from '@lfx-one/shared/constants';
import { toColumnar } from '@lfx-one/shared/utils';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { evictPerUserOrgFetch, resetSingleFlightForTests } from '../utils/single-flight';
import { logger } from './logger.service';
import { OrgPeopleDirectoryService, resolveMergeKey } from './org-people-directory.service';
import { toWireRow } from './org-people-wire.mapper';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
const req = {} as never;
const FILTERS: OrgCommitFilters = { projectScope: 'all', commitScope: 'all', metric: 'commits' };

function storedRow(over: Partial<OrgAllEmployeeRowInternal> = {}): OrgAllEmployeeRowInternal {
  return {
    personKey: 'lfnEMOUiFenugGty80',
    lfid: 'lfnEMOUiFenugGty80',
    lfUsername: 'dclarke',
    cdpMemberId: null,
    name: 'Devon Clarke',
    firstName: 'Devon',
    lastName: 'Clarke',
    title: 'VP Product',
    email: 'dclarke@lfx-partner.example',
    emails: ['dclarke@lfx-partner.example'],
    avatarUrl: null,
    sources: ['snowflake'],
    seatsCount: 22,
    boardSeatsCount: 2,
    committeeSeatsCount: 20,
    commitsCount: 0,
    mergedCommitsCount: 0,
    codeActivitiesCount: 0,
    eventsCount: 13,
    coursesCount: 0,
    engagedFoundationIds: [],
    ...over,
  };
}

function baseResponse(rows: OrgAllEmployeeRowInternal[]): OrgAllEmployeesInternalResponse {
  return { accountId: ACCOUNT, rows, foundations: [] };
}

function seat(over: Record<string, unknown> = {}): never {
  return {
    uid: 'seat-1',
    committee_uid: 'c-1',
    committee_name: 'WG Identity & Trust',
    committee_category: 'Working Group',
    first_name: 'Devon',
    last_name: 'Clarke',
    email: 'dclarke@contractor.lfx-partner.example',
    username: 'dclarke',
    role_name: 'LF Staff',
    voting_status: 'Observer',
    appointed_by: 'None',
    organization_id: ACCOUNT,
    is_org_editable: false,
    ...over,
  } as never;
}

function accessUser(over: Partial<OrgAccessUser> = {}): OrgAccessUser {
  return {
    email: 'dqualls@lfx-partner.example',
    username: 'dqualls',
    name: 'Dano Qualls',
    initials: 'DQ',
    avatarUrl: null,
    jobTitle: null,
    role: 'admin',
    inviteStatus: 'accepted',
    isPending: false,
    ...over,
  };
}

async function run(range: OrgLensTimeRange | null = '365d', filters: OrgCommitFilters = FILTERS): Promise<OrgAllEmployeesResponse> {
  return new OrgPeopleDirectoryService().getLive(req, ACCOUNT, range, filters);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSingleFlightForTests();
  cache.serveHits = false;
  cache.entry = null;
  cache.accept = null;
  cache.readThroughs = 0;
  cache.namespaces = [];
  cache.encodedRows = null;
  getEffectiveUsername.mockReturnValue('tester');
  getAllEmployeesInternal.mockResolvedValue(baseResponse([]));
  // The scope served (lfx-self-serve-ops#1219): `all` unless a test grants the account an Insights organization.
  resolveOrgScope.mockResolvedValue('all');
  getFormerUsernames.mockResolvedValue([]);
  getTeamMemberPersonKeys.mockResolvedValue({ excluded: null, unavailable: false });
  fetchAllOrgSeats.mockResolvedValue([]);
  getKeyContactEmployees.mockResolvedValue([] as KeyContactEmployee[]);
  getAccessPrincipals.mockResolvedValue([]);
});

describe('resolveMergeKey', () => {
  it('prefers the verified identity over the address', () => {
    expect(resolveMergeKey({ lfUsername: 'dclarke', email: 'anything@example.com' })).toBe('identity:dclarke');
  });

  it('lowercases and trims the username', () => {
    expect(resolveMergeKey({ lfUsername: '  DClArKe ' })).toBe('identity:dclarke');
  });

  it('falls back to the lowercased address when no username is present', () => {
    expect(resolveMergeKey({ lfUsername: null, email: 'Dclarke@Lfx-Partner.Example' })).toBe('email:dclarke@lfx-partner.example');
  });

  it('falls back when the username is blank rather than treating whitespace as an identity', () => {
    expect(resolveMergeKey({ lfUsername: '   ', email: 'a@b.com' })).toBe('email:a@b.com');
  });

  it('yields no key when neither is present', () => {
    expect(resolveMergeKey({ lfUsername: null, email: null })).toBeNull();
  });

  it('never produces an identity key that collides with an email key', () => {
    expect(resolveMergeKey({ lfUsername: 'dqualls' })).not.toBe(resolveMergeKey({ email: 'dqualls' }));
  });
});

describe('OrgPeopleDirectoryService.merge — identity matching (US1)', () => {
  it('merges an access principal into the stored row on username, not address (the Dano case)', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          personKey: '0032M00003ZzRIsQAN',
          lfid: '0032M00003ZzRIsQAN',
          lfUsername: 'dqualls',
          name: 'Dano Qualls',
          email: 'dqualls@contractor.lfx-partner.example',
          emails: ['dqualls@contractor.lfx-partner.example'],
          seatsCount: 3,
          boardSeatsCount: 0,
          committeeSeatsCount: 3,
          eventsCount: 6,
        }),
      ])
    );
    getAccessPrincipals.mockResolvedValue([accessUser()]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(expect.arrayContaining(['snowflake', 'access']));
  });

  it('merges a committee seat into the stored row on username (the Devon case)', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat()]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
  });

  it('collapses a person arriving from three sources into one row (the Jamie Ortiz case)', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'jortiz', name: 'Jamie Ortiz', email: 'jortiz@vendor-corp.example', emails: ['jortiz@vendor-corp.example'] })])
    );
    fetchAllOrgSeats.mockResolvedValue([
      seat({ email: 'jamie.ortiz@vendor-corp.example', username: 'jortiz' }),
      seat({ uid: 'seat-2', email: 'jamie.ortiz@lfx-partner.example', username: 'jortiz', committee_category: 'Board' }),
    ]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(expect.arrayContaining(['snowflake', 'committee', 'board']));
  });

  it('keeps the stored personKey so a merged row stays expandable', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat()]);

    const { rows } = await run();

    expect(rows[0].personKey).toBe('lfnEMOUiFenugGty80');
    expect(rows[0].personKey).not.toMatch(/^live-/);
  });
});

describe('OrgPeopleDirectoryService.merge — access badge is server-attributed', () => {
  it('stamps the merged principal\u2019s badge on the row', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          lfUsername: 'dqualls',
          name: 'Dano Qualls',
          email: 'dqualls@contractor.lfx-partner.example',
          emails: ['dqualls@contractor.lfx-partner.example'],
        }),
      ])
    );
    getAccessPrincipals.mockResolvedValue([accessUser()]);

    const { rows } = await run();

    expect(rows[0].accessBadge).toBe('admin');
  });

  it('marks a pending principal as invited rather than by role', async () => {
    getAccessPrincipals.mockResolvedValue([accessUser({ username: null, inviteStatus: 'pending', isPending: true })]);

    const { rows } = await run();

    expect(rows[0].accessBadge).toBe('invited');
  });

  it('leaves the badge unset on a person the merge attributed no access to', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));

    const { rows } = await run();

    expect(rows[0].accessBadge).toBeUndefined();
  });

  it('does not stamp one person\u2019s badge onto another who shares an address', async () => {
    // Two distinct identities, one shared address. Only the person the access principal actually
    // resolves to may carry the badge — an address-based join could not tell them apart.
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          personKey: 'p-dano',
          lfUsername: 'dqualls',
          name: 'Dano Qualls',
          email: 'shared@lfx-partner.example',
          emails: ['shared@lfx-partner.example'],
        }),
        storedRow({
          personKey: 'p-riley',
          lfUsername: 'rfoster',
          name: 'Riley Foster',
          email: 'shared@lfx-partner.example',
          emails: ['shared@lfx-partner.example'],
        }),
      ])
    );
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'shared@lfx-partner.example', username: 'rfoster', name: 'Riley Foster' })]);

    const { rows } = await run();

    const dano = rows.find((r) => r.lfUsername === 'dqualls');
    const riley = rows.find((r) => r.lfUsername === 'rfoster');
    expect(riley?.accessBadge).toBe('admin');
    expect(dano?.accessBadge).toBeUndefined();
  });
});

describe('OrgPeopleDirectoryService.merge — identity-less rows fold into the identity that owns the address', () => {
  it('absorbs a live seat that reports no username, at an address the person already owns', async () => {
    // The regression this covers: sources disagree on whether they report an identity, so the same
    // person at the same address landed on two rows -- one keyed on identity, one on the address.
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          lfUsername: 'dqualls',
          name: 'Dano Qualls',
          email: 'dqualls@contractor.lfx-partner.example',
          emails: ['dqualls@contractor.lfx-partner.example'],
          seatsCount: 3,
          committeeSeatsCount: 3,
        }),
      ])
    );
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'dqualls@contractor.lfx-partner.example', first_name: 'Dano', last_name: 'Qualls' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].lfUsername).toBe('dqualls');
    expect(rows[0].sources).toEqual(expect.arrayContaining(['snowflake', 'committee']));
  });

  it('keeps the stored counters authoritative when absorbing', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'dclarke@lfx-partner.example' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].seatsCount).toBe(22);
  });

  it('adds the orphan\u2019s counts when the surviving row is itself live-only', async () => {
    fetchAllOrgSeats.mockResolvedValue([
      seat({ username: 'liveonly', email: 'live@example.com' }),
      seat({ uid: 'seat-2', username: null, email: 'live@example.com' }),
    ]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].seatsCount).toBe(2);
  });

  it('does not absorb an address the identity row does not own', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'someone.else@example.com' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });

  it('never absorbs a row that carries its own identity', async () => {
    // Two verified identities at one address stay apart: only identity-less rows are candidates.
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          personKey: 'p-a',
          lfUsername: 'dqualls',
          name: 'Dano Qualls',
          email: 'shared@lfx-partner.example',
          emails: ['shared@lfx-partner.example'],
        }),
        storedRow({
          personKey: 'p-b',
          lfUsername: 'rfoster',
          name: 'Riley Foster',
          email: 'shared@lfx-partner.example',
          emails: ['shared@lfx-partner.example'],
        }),
      ])
    );

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });

  it('leaves an orphan standing when two identities claim its address, rather than picking by order', async () => {
    // Whichever identity is folded first is an upstream accident, so an address with two claimants has
    // no owner: attributing the orphan by insertion order would silently give one person another's data.
    const both = [
      storedRow({ personKey: 'p-a', lfUsername: 'alpha', name: 'Alpha One', email: 'shared@example.com', emails: ['shared@example.com'] }),
      storedRow({ personKey: 'p-b', lfUsername: 'beta', name: 'Beta Two', email: 'other@example.com', emails: ['other@example.com', 'shared@example.com'] }),
    ];

    getAllEmployeesInternal.mockResolvedValue(baseResponse(both));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'shared@example.com' })]);
    const forward = await run();

    vi.clearAllMocks();
    getAllEmployeesInternal.mockResolvedValue(baseResponse([both[1], both[0]]));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'shared@example.com' })]);
    getKeyContactEmployees.mockResolvedValue([]);
    getAccessPrincipals.mockResolvedValue([]);
    const reversed = await run();

    expect(forward.rows).toHaveLength(3);
    expect(reversed.rows).toHaveLength(3);
    // Neither identity absorbed it, so the outcome is identical whichever order they arrived in.
    const committeeHolders = (r: typeof forward) => r.rows.filter((x) => x.sources.includes('committee') && x.lfUsername).length;
    expect(committeeHolders(forward)).toBe(0);
    expect(committeeHolders(reversed)).toBe(0);
  });

  it('never absorbs a stored orphan, which owns activity this fold does not carry', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          personKey: 'p-live-target',
          lfUsername: 'shared',
          name: 'Shared Person',
          email: 'shared@example.com',
          emails: ['shared@example.com'],
          seatsCount: 0,
          boardSeatsCount: 0,
          committeeSeatsCount: 0,
          eventsCount: 0,
        }),
        storedRow({
          personKey: 'p-stored-orphan',
          lfUsername: null,
          name: 'Shared Person',
          email: 'shared@example.com',
          emails: ['shared@example.com'],
          seatsCount: 4,
          eventsCount: 9,
          commitsCount: 7,
          coursesCount: 2,
          engagedFoundationIds: ['f-1'],
        }),
      ])
    );

    const { rows } = await run();

    expect(rows).toHaveLength(2);
    const orphan = rows.find((r) => r.personKey === 'p-stored-orphan');
    // Its activity is still reachable rather than deleted along with the row.
    expect(orphan).toBeDefined();
    expect(orphan?.eventsCount).toBe(9);
    expect(orphan?.commitsCount).toBe(7);
    expect(orphan?.engagedFoundationIds).toEqual(['f-1']);
  });

  it('carries the badge across when an accepted principal has no username', async () => {
    // The one shape that reaches the badge transfer: accepted, so `isPending` is false and the badge is
    // a real role, but with no username, so it keys on the address and arrives as an orphan. Rare enough
    // that it looks like dead code, and representable enough to keep.
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'nobadge', name: 'No Badge', email: 'nobadge@example.com', emails: ['nobadge@example.com'] })])
    );
    getAccessPrincipals.mockResolvedValue([
      accessUser({ email: 'nobadge@example.com', username: null, inviteStatus: 'accepted', isPending: false, role: 'admin' }),
    ]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].accessBadge).toBe('admin');
    expect(rows[0].sources).toEqual(expect.arrayContaining(['snowflake', 'access']));
  });

  it('takes a live orphan\u2019s seat counts before its sources mark the owner as stored', async () => {
    fetchAllOrgSeats.mockResolvedValue([
      seat({ username: 'liveowner', email: 'liveowner@example.com' }),
      seat({ uid: 'seat-2', username: null, email: 'liveowner@example.com' }),
    ]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].seatsCount).toBe(2);
  });
});

describe('OrgPeopleDirectoryService.merge — false-merge protection', () => {
  it('does not merge two different people who share an address', async () => {
    // The Snowflake address→member index links dqualls@lfx-partner.example to Riley Foster's member
    // record. Two distinct usernames must never collapse, whatever their addresses say.
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          personKey: 'p-dano',
          lfUsername: 'dqualls',
          name: 'Dano Qualls',
          email: 'dqualls@lfx-partner.example',
          emails: ['dqualls@lfx-partner.example'],
        }),
        storedRow({
          personKey: 'p-riley',
          lfUsername: 'rfoster',
          name: 'Riley Foster',
          email: 'dqualls@lfx-partner.example',
          emails: ['dqualls@lfx-partner.example'],
        }),
      ])
    );

    const { rows } = await run();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.lfUsername).sort()).toEqual(['dqualls', 'rfoster']);
  });

  it('does not merge an access principal into a person with a different username', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'spateloai', name: 'Sam Patel', email: 'spatel@partner-corp.example', emails: ['spatel@partner-corp.example'] })])
    );
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@lfx-partner.example', username: 'dclarke', name: 'Devon Clarke' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });
});

describe('OrgPeopleDirectoryService.merge — invariants', () => {
  it('a live seat does not increment a stored row\u2019s seat counters', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat(), seat({ uid: 'seat-2', committee_name: 'P&E&IT&Mktg_Ops' })]);

    const { rows } = await run();

    // Devon: stored 22 + two live contractor seats ⇒ 22, not 24.
    expect(rows[0].seatsCount).toBe(22);
    expect(rows[0].committeeSeatsCount).toBe(20);
    expect(rows[0].boardSeatsCount).toBe(2);
  });

  it('a live-only row still accumulates its own live seat counts', async () => {
    fetchAllOrgSeats.mockResolvedValue([
      seat({ username: null, email: 'someone@example.com' }),
      seat({ uid: 'seat-2', username: null, email: 'someone@example.com' }),
    ]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].seatsCount).toBe(2);
  });

  it('sources are de-duplicated', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat({ email: 'DClarke@Lfx-Partner.Example' }), seat({ uid: 'seat-2', email: 'dclarke@lfx-partner.example' })]);

    const { rows } = await run();

    expect(new Set(rows[0].sources).size).toBe(rows[0].sources.length);
  });

  it('lowercases the wire email of a live-only row', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'MixedCase@Example.COM' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('mixedcase@example.com');
  });

  it('a pending invite is not merged into a person, even when the address matches', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'dqualls', name: 'Dano Qualls', email: 'dqualls@lfx-partner.example', emails: ['dqualls@lfx-partner.example'] })])
    );
    getAccessPrincipals.mockResolvedValue([accessUser({ username: null, inviteStatus: 'pending', isPending: true })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });

  // The All Employees page trusts a live row's username for the former-employee join only when the row's
  // first source (the one that created it) is a seat or an access principal. That rests on the merge order
  // here (stored, seats, key contacts, access) and on `sources` surviving the compact cache in order.
  it('lists the creating source first, through the cache too', async () => {
    const keyContact = (email: string, lfUsername: string): KeyContactEmployee => ({
      email,
      firstName: 'Kim',
      lastName: 'Contact',
      fullName: 'Kim Contact',
      jobTitle: null,
      initials: 'KC',
      lfUsername,
    });
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: 'rvega', email: 'rvega@example.com', first_name: 'Rowan', last_name: 'Vega' })]);
    getKeyContactEmployees.mockResolvedValue([keyContact('kim@example.com', 'kim-resolved'), keyContact('rvega@example.com', 'rvega-resolved')]);
    getAccessPrincipals.mockResolvedValue([
      accessUser({ email: 'kim@example.com', username: null, inviteStatus: 'pending', isPending: true }),
      accessUser({ email: 'dclarke@lfx-partner.example', username: 'dclarke' }),
    ]);
    cache.serveHits = true;

    const miss = await run();
    const hit = await run();

    for (const { rows } of [miss, hit]) {
      const byUsername = new Map(rows.map((row) => [row.lfUsername, row]));
      expect(byUsername.get('kim-resolved')?.sources).toEqual(['keyContact', 'access']);
      expect(byUsername.get('rvega')?.sources).toEqual(['committee', 'keyContact']);
      expect(byUsername.get('dclarke')?.sources).toEqual(['snowflake', 'access']);
    }
  });
});

describe('OrgPeopleDirectoryService.merge — no regression for single-source people', () => {
  it('leaves a stored-only person untouched', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(['snowflake']);
    expect(rows[0].seatsCount).toBe(22);
  });

  it('keeps a seat-only person as a live row with its own counts', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'seatonly@example.com' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(['committee']);
    expect(rows[0].personKey).toMatch(/^live-/);
  });

  it('keeps an access-only person as a live row', async () => {
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'accessonly@example.com', username: 'accessonly' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(['access']);
  });

  it('gives records identified only by username distinct keys rather than colliding them', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ username: 'alpha', email: null }), seat({ uid: 'seat-2', username: 'beta', email: null })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.personKey)).size).toBe(2);
  });

  it('passes through a stored row that has neither identity nor address', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow({ lfUsername: null, email: null, emails: [] })]));

    const { rows } = await run();

    expect(rows).toHaveLength(1);
  });
});

describe('OrgPeopleDirectoryService.merge — live-only personKey is a keyed HMAC', () => {
  const previousSecret = process.env['PCC_AUTH0_SECRET'];

  beforeEach(() => {
    process.env['PCC_AUTH0_SECRET'] = 'test-signing-secret';
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env['PCC_AUTH0_SECRET'];
    } else {
      process.env['PCC_AUTH0_SECRET'] = previousSecret;
    }
  });

  it('matches a keyed HMAC-SHA256 of the merge key, not an unkeyed hash or reversible encoding', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ username: 'liveonly', email: 'liveonly@example.com' })]);

    const { rows } = await run();

    const mergeKey = resolveMergeKey({ lfUsername: 'liveonly', email: 'liveonly@example.com' }) as string;
    const expectedDigest = createHmac('sha256', 'test-signing-secret').update(mergeKey).digest('base64url').slice(0, 32);

    expect(rows[0].personKey).toBe(`live-${expectedDigest}`);
    // The old (pre-fix) scheme reversibly base64-encoded the merge key directly — assert this isn't that.
    expect(rows[0].personKey).not.toBe(`live-${Buffer.from(mergeKey).toString('base64url')}`);
  });

  it('changes when the signing secret changes, proving the key is actually used', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ username: 'liveonly', email: 'liveonly@example.com' })]);
    const { rows: rowsWithSecretA } = await run();

    process.env['PCC_AUTH0_SECRET'] = 'a-different-signing-secret';
    const { rows: rowsWithSecretB } = await run();

    expect(rowsWithSecretA[0].personKey).not.toBe(rowsWithSecretB[0].personKey);
  });
});

describe('OrgPeopleDirectoryService.merge — stats count people, not rows (US2)', () => {
  it('counts a person who arrived from two sources exactly once', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@contractor.lfx-partner.example', username: 'dclarke', name: 'Devon Clarke' })]);

    const { rows, stats } = await run();

    expect(rows).toHaveLength(1);
    expect(stats.inGovernance).toBe(1);
    expect(stats.activeInOss).toBe(1);
  });

  it('degrades gracefully when a live source fails, keeping the stored roster', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockRejectedValue(new Error('committee-service down'));

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(['snowflake']);
  });
});

describe('OrgPeopleDirectoryService.getLive — merge-only fields never reach the wire (#2179)', () => {
  it('strips emails and mergedFrom from every row', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@contractor.lfx-partner.example', username: 'dclarke', name: 'Devon Clarke' })]);

    const { rows } = await run();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty('emails');
      expect(row).not.toHaveProperty('mergedFrom');
    }
  });
});

describe('OrgPeopleDirectoryService.getLive — compact cache round trip (GH-1906)', () => {
  // The invariant the compaction rests on: a warm cache must send exactly what the cold one would
  // have. Both are compared against the rows the encoder was handed, NOT against each other — the
  // miss path returns the decoded envelope too, so hit-vs-miss would only prove self-consistency.
  // Compared as JSON because that is the contract: a pre-compaction row carries
  // `accessBadge: undefined`, which the wire drops, so `toStrictEqual` would flag a difference no
  // client can observe. Key order is uniform because every row passes through `toStoredRow` and `toWireRow`.
  it('serves exactly the uncached wire rows on a miss and on a hit, including which fields were absent', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'rvega@lfx-partner.example', username: 'rvega', name: 'Rowan Vega' })]);
    cache.serveHits = true;

    const miss = await run();
    const wire = cache.encodedRows;
    const hit = await run();

    expect(miss.rows.length).toBeGreaterThan(1);
    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(1);
    expect(wire).not.toBeNull();
    // The stored rows carry every code count; the wire carries the one the filters pick, plus the code activities the active tile reads.
    const expected = JSON.stringify((JSON.parse(wire!) as OrgAllEmployeeCountedRow[]).map((row) => toWireRow(row, FILTERS)));
    expect(JSON.stringify(miss.rows)).toBe(expected);
    expect(JSON.stringify(hit.rows)).toBe(expected);
    expect(miss.rows.every((row) => !('mergedCommitsCount' in row) && 'codeActivitiesCount' in row)).toBe(true);
    // One row carries a badge and the rest never had the key at all — both must survive.
    const hitJson = JSON.parse(JSON.stringify(hit.rows)) as Record<string, unknown>[];
    expect(hitJson.some((row) => row['accessBadge'] === 'admin')).toBe(true);
    expect(hitJson.some((row) => !('accessBadge' in row))).toBe(true);
  });

  // A pre-compaction (`org-people-dir:v2`) entry is a wire response with a `rows` array. It must
  // miss and be recomputed, never decoded — the namespace bump is the first line of defence, this
  // guard is the second.
  it('rejects a legacy wire-shaped entry as a miss', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));

    const legacy = await run();
    const accept = cache.accept;

    expect(accept).toBeTypeOf('function');
    expect(accept!(JSON.parse(JSON.stringify(legacy)))).toBe(false);
    expect(accept!(JSON.parse(cache.entry!))).toBe(true);
  });

  // The merge-only fields are asserted absent by the stored column list itself, so a writer that
  // regressed and stored them has to be rejected rather than replayed to the client.
  it('rejects a stored entry whose column list carries a merge-only field', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    await run();
    const stored = JSON.parse(cache.entry!);

    expect(cache.accept!({ ...stored, r: { ...stored.r, k: [...stored.r.k, 'emails'] } })).toBe(false);
  });

  // A row whose required field is corrupt would crash the client on `name.localeCompare`; the
  // pre-compaction guard caught that and the positional one has to keep catching it, including the
  // encoder's "this field was absent" marker standing in for a required string.
  it('rejects a stored row with a corrupt or absent required field', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    await run();
    const stored = JSON.parse(cache.entry!);
    const nameColumn = stored.r.k.indexOf('name');

    const corrupt = JSON.parse(cache.entry!);
    corrupt.r.r[0][nameColumn] = 42;
    expect(cache.accept!(corrupt)).toBe(false);

    // The real encoder's own absence marker, not a hard-coded copy of its private encoding.
    const absent = JSON.parse(cache.entry!);
    absent.r.r[0][nameColumn] = toColumnar([{ name: undefined }], ['name']).r[0][0];
    expect(cache.accept!(absent)).toBe(false);
  });
});

describe('OrgPeopleDirectoryService.getLive — coalescing (GH-1906)', () => {
  // The merge fans out to four upstreams and outlives the 30s entry it produces, so two tabs
  // opening at once must not run it twice.
  it('computes once for concurrent callers with the same principal', async () => {
    let release!: (rows: OrgAllEmployeesInternalResponse) => void;
    getAllEmployeesInternal.mockReturnValue(
      new Promise<OrgAllEmployeesInternalResponse>((resolve) => {
        release = resolve;
      })
    );

    const both = Promise.all([run(), run()]);
    release(baseResponse([storedRow()]));
    const [first, second] = await both;

    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(1);
    // One burst is one read-through: a single cache read and a single serialized write, not one per
    // joined caller on the connection the session store shares.
    expect(cache.readThroughs).toBe(1);
    expect(first).toEqual(second);
    // Each caller rebuilds its own response from the shared stored envelope.
    expect(first).not.toBe(second);
  });

  // The fail-closed rule: `withPerUserCache` refuses to build a key for an unresolvable principal,
  // and the coalescing must refuse on the same terms — a shared bucket keyed on a blank username
  // would hand one caller's permission-filtered roster to another.
  it('does not coalesce callers with no resolvable username', async () => {
    getEffectiveUsername.mockReturnValue(null);
    getAllEmployeesInternal.mockResolvedValueOnce(baseResponse([storedRow()])).mockResolvedValueOnce(baseResponse([storedRow({ name: 'Second Caller Only' })]));

    const [first, second] = await Promise.all([run(), run()]);

    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(2);
    expect(first.rows[0].name).toBe('Devon Clarke');
    expect(second.rows[0].name).toBe('Second Caller Only');
  });

  // A seat reassign evicts the caller's directory flight: the post-reassign read must start fresh
  // rather than join the old computation, and the old one must not store its pre-reassign roster.
  it('an evicted computation neither answers the next read nor writes its result', async () => {
    cache.serveHits = true;
    let release!: (rows: OrgAllEmployeesInternalResponse) => void;
    getAllEmployeesInternal
      .mockReturnValueOnce(
        new Promise<OrgAllEmployeesInternalResponse>((resolve) => {
          release = resolve;
        })
      )
      .mockResolvedValue(baseResponse([storedRow({ name: 'After Reassign' })]));

    const stale = run();
    // The read resolves its organization scope before it starts the computation an eviction drops.
    await vi.waitFor(() => expect(getAllEmployeesInternal).toHaveBeenCalledTimes(1));
    evictPerUserOrgFetch('org-people-dir:v6:365d:all:all', 'tester', ACCOUNT);
    expect((await run()).rows[0].name).toBe('After Reassign');

    release(baseResponse([storedRow({ name: 'Before Reassign' })]));
    expect((await stale).rows[0].name).toBe('Before Reassign');
    expect((await run()).rows[0].name).toBe('After Reassign');
    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(2);
  });

  it('keeps each time range apart: its own stored roster, cache namespace and in-flight computation', async () => {
    let release!: (rows: OrgAllEmployeesInternalResponse) => void;
    getAllEmployeesInternal
      .mockReturnValueOnce(
        new Promise<OrgAllEmployeesInternalResponse>((resolve) => {
          release = resolve;
        })
      )
      .mockResolvedValueOnce(baseResponse([storedRow({ name: 'All Time' })]));

    const recent = run('30d');
    const allTime = await run('all');
    release(baseResponse([storedRow({ name: 'Last 30 Days' })]));

    expect((await recent).rows[0].name).toBe('Last 30 Days');
    expect(allTime.rows[0].name).toBe('All Time');
    expect(getAllEmployeesInternal.mock.calls).toEqual([
      [ACCOUNT, '30d', 'all', 'all'],
      [ACCOUNT, 'all', 'all', 'all'],
    ]);
    expect(cache.namespaces).toEqual(['org-people-dir:v6:30d:all:all', 'org-people-dir:v6:all:all:all']);
  });

  it('keeps each project scope apart, while one entry serves every commit scope and metric, projected per request', async () => {
    getAllEmployeesInternal
      .mockResolvedValueOnce(baseResponse([storedRow({ name: 'LF', commitsCount: 10, mergedCommitsCount: 4, codeActivitiesCount: 25 })]))
      .mockResolvedValueOnce(baseResponse([storedRow({ name: 'Non-LF' })]));
    cache.serveHits = true;

    const commits = await run('365d', { ...FILTERS, projectScope: 'lf' });
    const code = await run('365d', { projectScope: 'lf', commitScope: 'all', metric: 'code' });
    const merged = await run('365d', { projectScope: 'lf', commitScope: 'merged', metric: 'commits' });

    expect([commits, code, merged].map((response) => response.rows[0].commitsCount)).toEqual([10, 25, 4]);
    expect(code.stats.codeContributors).toBe(1);
    expect(getAllEmployeesInternal.mock.calls).toEqual([[ACCOUNT, '365d', 'lf', 'all']]);
    expect(cache.namespaces).toEqual(['org-people-dir:v6:365d:lf:all', 'org-people-dir:v6:365d:lf:all', 'org-people-dir:v6:365d:lf:all']);

    cache.entry = null;
    expect((await run('365d', { ...FILTERS, projectScope: 'non_lf' })).rows[0].name).toBe('Non-LF');
    expect(getAllEmployeesInternal).toHaveBeenLastCalledWith(ACCOUNT, '365d', 'non_lf', 'all');
    expect(cache.namespaces.at(-1)).toBe('org-people-dir:v6:365d:non_lf:all');
  });

  it('serves the unranged roster (no range) from its own cache namespace and stored read', async () => {
    getAllEmployeesInternal
      .mockResolvedValueOnce(baseResponse([storedRow({ name: 'Roster' })]))
      .mockResolvedValueOnce(baseResponse([storedRow({ name: 'Ranged' })]));

    expect((await run(null)).rows[0].name).toBe('Roster');
    expect((await run('365d')).rows[0].name).toBe('Ranged');
    expect(getAllEmployeesInternal.mock.calls).toEqual([
      [ACCOUNT, null, 'all', 'all'],
      [ACCOUNT, '365d', 'all', 'all'],
    ]);
    expect(cache.namespaces).toEqual(['org-people-dir:v6:roster', 'org-people-dir:v6:365d:all:all']);
  });
});

describe('OrgPeopleDirectoryService.getLive — LF engagement under the non-LF project scope', () => {
  const keyContact: KeyContactEmployee = {
    email: 'kay@lfx-partner.example',
    firstName: 'Kay',
    lastName: 'Cee',
    fullName: 'Kay Cee',
    jobTitle: null,
    initials: 'KC',
  };

  beforeEach(() => {
    // The stored non-LF roster carries no seats: seats, events and courses are LF constructs.
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([storedRow({ seatsCount: 0, boardSeatsCount: 0, committeeSeatsCount: 0, eventsCount: 0, commitsCount: 5, codeActivitiesCount: 5 })])
    );
    fetchAllOrgSeats.mockResolvedValue([
      seat(),
      seat({ uid: 'seat-2', username: 'seatonly', email: 'seatonly@lfx-partner.example', first_name: 'Sam', last_name: 'Seat' }),
    ]);
    getKeyContactEmployees.mockResolvedValue([keyContact]);
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@lfx-partner.example', username: 'dclarke', name: 'Devon Clarke' }), accessUser()]);
  });

  it('adds no seat and no live-only row under non_lf, still stamping the access badge on the stored row', async () => {
    const response = await run('365d', { ...FILTERS, projectScope: 'non_lf' });

    expect(fetchAllOrgSeats).not.toHaveBeenCalled();
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({ personKey: 'lfnEMOUiFenugGty80', seatsCount: 0, sources: ['snowflake', 'access'], accessBadge: 'admin' });
    expect(response.stats.inGovernance).toBe(0);
    expect(response.stats.activeInOss).toBe(1);
  });

  it.each(['all', 'lf'] as const)('keeps the live seats and live-only rows under %s', async (projectScope) => {
    const response = await run('365d', { ...FILTERS, projectScope });

    expect(fetchAllOrgSeats).toHaveBeenCalledTimes(1);
    expect(response.rows.map((row) => row.name).sort()).toEqual(['Dano Qualls', 'Devon Clarke', 'Kay Cee', 'Sam Seat']);
    expect(response.rows.find((row) => row.name === 'Sam Seat')?.seatsCount).toBe(1);
    expect(response.stats.inGovernance).toBe(2);
  });

  // The unranged roster has one shared entry — what the Board, Committee and Key Contacts assignment pickers read — so an
  // unranged caller's filters must not shape it: a non-LF request cached there would hand the next picker a
  // roster without seats or live-only people until the entry expired.
  it('serves the full unranged roster to an unfiltered read after a non-LF unranged request', async () => {
    cache.serveHits = true;

    const nonLf = await run(null, { projectScope: 'non_lf', commitScope: 'merged', metric: 'code' });
    const picker = await run(null);

    expect(cache.namespaces).toEqual(['org-people-dir:v6:roster', 'org-people-dir:v6:roster']);
    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(1);
    expect(getAllEmployeesInternal).toHaveBeenCalledWith(ACCOUNT, null, 'all', 'all');
    expect(fetchAllOrgSeats).toHaveBeenCalledTimes(1);
    for (const response of [nonLf, picker]) {
      expect(response.rows.map((row) => row.name).sort()).toEqual(['Dano Qualls', 'Devon Clarke', 'Kay Cee', 'Sam Seat']);
      expect(response.rows.find((row) => row.name === 'Sam Seat')?.seatsCount).toBe(1);
      expect(response.stats.inGovernance).toBe(2);
    }
    expect(nonLf).toStrictEqual(picker);
  });

  // lfx-self-serve#4160: the unranged roster never follows the project scope a caller sends: the pickers keep every
  // seat, key contact, access principal and stored employee.
  it('serves the pickers the full unranged roster even when the caller sends LF projects', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow(),
        // A current employee with no LF code: still on the roster and assignable.
        storedRow({
          personKey: 'non-lf-coder',
          lfid: 'nonlfcoder',
          lfUsername: 'nonlfcoder',
          name: 'Nina Coder',
          email: 'nina@lfx-partner.example',
          emails: ['nina@lfx-partner.example'],
          seatsCount: 0,
          boardSeatsCount: 0,
          committeeSeatsCount: 0,
        }),
      ])
    );

    const picker = await run(null, { ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'lf' });

    expect(getAllEmployeesInternal).toHaveBeenCalledWith(ACCOUNT, null, 'all', 'all');
    expect(cache.namespaces).toEqual(['org-people-dir:v6:roster']);
    expect(fetchAllOrgSeats).toHaveBeenCalledTimes(1);
    expect(picker.rows.map((row) => row.name).sort()).toEqual(['Dano Qualls', 'Devon Clarke', 'Kay Cee', 'Nina Coder', 'Sam Seat']);
    expect(picker.rows.find((row) => row.name === 'Sam Seat')?.seatsCount).toBe(1);
    expect(picker.rows.find((row) => row.name === 'Kay Cee')?.sources).toEqual(['keyContact']);
    expect(picker.rows.find((row) => row.name === 'Nina Coder')?.sources).toEqual(['snowflake']);
    expect(picker.rows.flatMap((row) => row.sources)).toContain('access');
  });
});

describe('OrgPeopleDirectoryService.getLive — the tiles do not follow the code-count option', () => {
  it('counts Code Contributors on the code tile under every option, the commits measure included (lfx-self-serve#4160)', async () => {
    getAllEmployeesInternal.mockResolvedValue(
      baseResponse([
        storedRow({
          eventsCount: 0,
          seatsCount: 0,
          boardSeatsCount: 0,
          committeeSeatsCount: 0,
          commitsCount: 2,
          mergedCommitsCount: 1,
          codeActivitiesCount: 6,
        }),
        // Reviews only: no commit, but code activities.
        storedRow({
          personKey: 'reviewer',
          lfid: 'reviewer',
          lfUsername: 'reviewer',
          name: 'Rae Viewer',
          email: 'rae@lfx-partner.example',
          emails: ['rae@lfx-partner.example'],
          eventsCount: 0,
          seatsCount: 0,
          boardSeatsCount: 0,
          committeeSeatsCount: 0,
          codeActivitiesCount: 3,
        }),
      ])
    );

    const results = await Promise.all(
      [FILTERS, { ...FILTERS, commitScope: 'merged' as const }, { ...FILTERS, metric: 'code' as const }].map((filters) => run('365d', filters))
    );

    // The table's count follows the option: the reviewer has no commit, so the commits measure shows them 0.
    expect(results.map(({ rows }) => rows.map((row) => row.commitsCount))).toEqual([
      [2, 0],
      [1, 0],
      [6, 3],
    ]);
    expect(results.map(({ stats }) => [stats.activeInOss, stats.codeContributors])).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
    ]);
  });
});

// lfx-self-serve#4685
describe('OrgPeopleDirectoryService.getLive — team members filter', () => {
  const teamMember = (personKey: string, over: Partial<OrgAllEmployeeRowInternal> = {}): OrgAllEmployeeRowInternal =>
    storedRow({
      personKey,
      lfid: personKey,
      lfUsername: personKey,
      name: personKey,
      email: `${personKey}@lfx-partner.example`,
      emails: [`${personKey}@lfx-partner.example`],
      ...over,
    });
  const keysFor = async (_account: string, teamMembers: string) =>
    teamMembers === 'exclude' ? { excluded: new Set(['coder', 'speaker']), unavailable: false } : { excluded: null, unavailable: false };
  // `coder` only has code; `speaker` has code and an event.
  const coder = teamMember('coder', { seatsCount: 0, boardSeatsCount: 0, committeeSeatsCount: 0, eventsCount: 0, commitsCount: 5, codeActivitiesCount: 9 });
  const speaker = teamMember('speaker', { seatsCount: 0, boardSeatsCount: 0, committeeSeatsCount: 0, eventsCount: 2, commitsCount: 3, codeActivitiesCount: 4 });

  it("removes team members' code under exclude, keeping who has other engagement, from the same cached directory entry", async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow(), coder, speaker]));
    getTeamMemberPersonKeys.mockImplementation(keysFor);
    cache.serveHits = true;

    const included = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'include');
    const excluded = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude');

    expect(included.rows.map((row) => row.personKey).sort()).toEqual(['coder', 'lfnEMOUiFenugGty80', 'speaker']);
    expect(excluded.rows.map((row) => [row.personKey, row.commitsCount, row.codeActivitiesCount, row.eventsCount])).toEqual(
      expect.arrayContaining([['speaker', 0, 0, 2]])
    );
    expect(excluded.rows.map((row) => row.personKey).sort()).toEqual(['lfnEMOUiFenugGty80', 'speaker']);
    expect([included.stats.codeContributors, excluded.stats.codeContributors]).toEqual([2, 0]);
    expect(excluded.teamMembersUnavailable).toBeUndefined();
    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(1);
  });

  it('keeps a team member with only code listed, without it, when a live source engages them (seat, key contact, access)', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow(), coder]));
    getTeamMemberPersonKeys.mockImplementation(keysFor);
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'coder@lfx-partner.example', username: 'coder', name: 'coder' })]);

    const roster = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude');

    expect(roster.rows.find((row) => row.personKey === 'coder')).toMatchObject({ commitsCount: 0, codeActivitiesCount: 0 });
  });

  it('serves the live roster with everyone, and says so, when the team-member read fails', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow(), coder]));
    getTeamMemberPersonKeys.mockRejectedValue(new Error('Warehouse timeout'));

    const roster = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude');

    expect(roster.rows).toHaveLength(2);
    expect(roster.teamMembersUnavailable).toBe(true);
  });

  it('serves everyone and says so while the team-member flag is unavailable', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow(), coder]));
    getTeamMemberPersonKeys.mockResolvedValue({ excluded: null, unavailable: true });

    const roster = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude');

    expect(roster.rows).toHaveLength(2);
    expect(roster.teamMembersUnavailable).toBe(true);
  });

  it('lists everyone on the unranged roster (the assignment pickers), whatever the pick', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow(), coder]));
    getTeamMemberPersonKeys.mockImplementation(keysFor);

    const roster = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, null, FILTERS, 'exclude');

    expect(roster.rows).toHaveLength(2);
  });
});

// lfx-self-serve#4378: Org Lens access alone leaves a former employee former, whichever employment view is open.
describe('OrgPeopleDirectoryService.getLive — former employees who still hold Org Lens access', () => {
  const grace = accessUser({ email: 'grace@lfx-partner.example', username: 'grace', name: 'Grace Hopper', role: 'viewer', jobTitle: 'Staff Engineer' });

  beforeEach(() => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow()]));
    getAccessPrincipals.mockResolvedValue([grace]);
    // The account's whole former population: Grace's code is older than 30 days and outside LF projects,
    // so the 30d / LF former roster would not list her.
    getFormerUsernames.mockResolvedValue(['grace']);
  });

  it('tags an access-only former employee in a narrow range and scope, keeping the access badge, and the tag survives the cache', async () => {
    cache.serveHits = true;

    const miss = await run('30d', { ...FILTERS, projectScope: 'lf' });
    const hit = await run('30d', { ...FILTERS, projectScope: 'lf' });

    expect(getFormerUsernames).toHaveBeenCalledTimes(1);
    expect(getFormerUsernames).toHaveBeenCalledWith(ACCOUNT);
    for (const response of [miss, hit]) {
      expect(response.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({ sources: ['access'], accessBadge: 'viewer', isFormer: true });
      expect(response.rows.find((row) => row.lfUsername === 'dclarke')?.isFormer).toBeUndefined();
    }
    expect(JSON.stringify(hit)).toBe(JSON.stringify(miss));
  });

  it('sends no address or title for a tagged row on a miss and on a hit', async () => {
    cache.serveHits = true;

    const miss = await run('30d', { ...FILTERS, projectScope: 'lf' });
    const hit = await run('30d', { ...FILTERS, projectScope: 'lf' });

    expect(cache.entry).not.toContain('grace@lfx-partner.example');
    for (const response of [miss, hit]) {
      expect(response.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({ name: 'Grace Hopper', email: null, title: null, isFormer: true });
      expect(JSON.stringify(response)).not.toContain('grace@lfx-partner.example');
    }
  });

  it('names a tagged row by its LF username when its name was its address', async () => {
    getAccessPrincipals.mockResolvedValue([
      accessUser({ email: 'grace@lfx-partner.example', username: 'grace', name: 'grace@lfx-partner.example', role: 'viewer' }),
    ]);
    cache.serveHits = true;

    const miss = await run('30d');
    const hit = await run('30d');

    for (const response of [miss, hit]) {
      expect(response.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({ name: 'grace', email: null, isFormer: true });
      expect(JSON.stringify(response)).not.toContain('grace@lfx-partner.example');
    }
  });

  it('leaves a former employee with a live seat or key-contact role current, with their address', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ username: 'grace', email: 'grace@lfx-partner.example', first_name: 'Grace', last_name: 'Hopper' })]);
    getKeyContactEmployees.mockResolvedValue([
      { email: 'kay@lfx-partner.example', lfUsername: 'kay', firstName: 'Kay', lastName: 'Cee', fullName: 'Kay Cee', jobTitle: null, initials: 'KC' },
    ]);
    getAccessPrincipals.mockResolvedValue([grace, accessUser({ email: 'kay@lfx-partner.example', username: null, name: 'Kay Cee' })]);
    getFormerUsernames.mockResolvedValue(['grace', 'kay']);

    const response = await run('365d');

    expect(response.rows.some((row) => row.isFormer)).toBe(false);
    expect(response.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({ sources: ['committee', 'access'], email: 'grace@lfx-partner.example' });
  });

  // The unranged roster feeds the assignment pickers (Board, Committee and Key Contacts reassign modals), which must not
  // offer someone who left: it is classified like every ranged view.
  it('tags an access-only former employee on the unranged picker roster too, without address or title', async () => {
    cache.serveHits = true;

    const miss = await run(null);
    const hit = await run(null);

    expect(getFormerUsernames).toHaveBeenCalledTimes(1);
    expect(getFormerUsernames).toHaveBeenCalledWith(ACCOUNT);
    expect(cache.namespaces).toEqual(['org-people-dir:v6:roster', 'org-people-dir:v6:roster']);
    expect(cache.entry).not.toContain('grace@lfx-partner.example');
    for (const response of [miss, hit]) {
      expect(response.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({
        sources: ['access'],
        accessBadge: 'viewer',
        isFormer: true,
        email: null,
        title: null,
      });
      expect(response.rows.find((row) => row.lfUsername === 'dclarke')).toMatchObject({ email: 'dclarke@lfx-partner.example' });
      expect(response.rows.find((row) => row.lfUsername === 'dclarke')?.isFormer).toBeUndefined();
    }
  });

  it('does not read former employees under non_lf, where access adds no live-only row', async () => {
    await run('365d', { ...FILTERS, projectScope: 'non_lf' });

    expect(getFormerUsernames).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a ranged view', range: '365d' as const },
    { label: 'the unranged picker roster', range: null },
  ])('serves access-only principals untagged but without address or title when the former read fails, uncached, on $label', async ({ range }) => {
    getAccessPrincipals.mockResolvedValue([
      grace,
      accessUser({ email: 'ann@lfx-partner.example', username: 'ann', name: 'ann@lfx-partner.example', jobTitle: 'Engineer' }),
      accessUser({ email: 'kim@lfx-partner.example', username: null, inviteStatus: 'pending', isPending: true }),
    ]);
    getFormerUsernames.mockRejectedValueOnce(new Error('warehouse down'));
    cache.serveHits = true;

    const failed = await run(range);

    expect(failed.rows.some((row) => row.isFormer)).toBe(false);
    expect(failed.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({
      name: 'Grace Hopper',
      sources: ['access'],
      accessBadge: 'viewer',
      email: null,
      title: null,
    });
    expect(failed.rows.find((row) => row.lfUsername === 'ann')).toMatchObject({ name: 'ann', email: null, title: null });
    // A pending invite has no username, so it could never be tagged and is served as it always is.
    expect(failed.rows.find((row) => row.accessBadge === 'invited')).toMatchObject({ email: 'kim@lfx-partner.example' });
    // A stored row is never an access-only row and keeps its address.
    expect(failed.rows.find((row) => row.lfUsername === 'dclarke')).toMatchObject({ email: 'dclarke@lfx-partner.example' });
    expect(JSON.stringify(failed)).not.toContain('grace@lfx-partner.example');
    expect(JSON.stringify(failed)).not.toContain('ann@lfx-partner.example');
    expect(cache.entry).toBeNull();
    expect(logger.warning).toHaveBeenCalledWith(req, 'get_org_people_directory', expect.stringContaining('Former employees read failed'), expect.anything());

    const recovered = await run(range);

    expect(getFormerUsernames).toHaveBeenCalledTimes(2);
    expect(recovered.rows.find((row) => row.lfUsername === 'grace')?.isFormer).toBe(true);
    expect(recovered.rows.find((row) => row.lfUsername === 'ann')).toMatchObject({ email: 'ann@lfx-partner.example', title: 'Engineer' });
    expect(cache.entry).not.toBeNull();
  });

  // lfx-self-serve#4735: the stored roster's code counts come from the People → Contributors read, so its failure is here.
  it('serves the live sources without caching them when the stored roster read fails, and reads it again next time', async () => {
    getAllEmployeesInternal.mockRejectedValueOnce(new Error('contributors read failed'));
    cache.serveHits = true;

    const failed = await run('365d');

    expect(failed.rows.some((row) => row.lfUsername === 'dclarke')).toBe(false);
    expect(failed.rows.find((row) => row.lfUsername === 'grace')).toMatchObject({ sources: ['access'] });
    expect(cache.entry).toBeNull();
    expect(logger.warning).toHaveBeenCalledWith(req, 'get_org_people_directory', expect.stringContaining('Snowflake roster failed'), expect.anything());

    const recovered = await run('365d');

    expect(getAllEmployeesInternal).toHaveBeenCalledTimes(2);
    expect(recovered.rows.find((row) => row.lfUsername === 'dclarke')).toMatchObject({ sources: ['snowflake'] });
    expect(cache.entry).not.toBeNull();
  });
});

// lfx-self-serve-ops#1219
describe('OrgPeopleDirectoryService.getLive — organization scope', () => {
  it('resolves the requested scope, insights by default, and keys and reads the ranged directory by the scope served', async () => {
    resolveOrgScope.mockImplementation(async (_account: string, scope: string) => scope);

    await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS);
    await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude', 'all');

    expect(resolveOrgScope.mock.calls).toEqual([
      [ACCOUNT, 'insights'],
      [ACCOUNT, 'all'],
    ]);
    expect(getAllEmployeesInternal.mock.calls).toEqual([
      [ACCOUNT, '365d', 'all', 'insights'],
      [ACCOUNT, '365d', 'all', 'all'],
    ]);
    expect(cache.namespaces).toEqual(['org-people-dir:v6:365d:all:insights', 'org-people-dir:v6:365d:all:all']);
  });

  it('serves the all-organizations entry when an insights request resolves to all', async () => {
    await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '30d', FILTERS, 'exclude', 'insights');

    expect(getAllEmployeesInternal).toHaveBeenCalledWith(ACCOUNT, '30d', 'all', 'all');
    expect(cache.namespaces).toEqual(['org-people-dir:v6:30d:all:all']);
  });

  it('leaves the unranged roster unscoped, without resolving the scope', async () => {
    resolveOrgScope.mockImplementation(async (_account: string, scope: string) => scope);

    await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, null, FILTERS, 'exclude', 'insights');

    expect(resolveOrgScope).not.toHaveBeenCalled();
    expect(getAllEmployeesInternal).toHaveBeenCalledWith(ACCOUNT, null, 'all', 'all');
    expect(cache.namespaces).toEqual(['org-people-dir:v6:roster']);
  });

  it('serves the live sources without reading or caching stored code counts when the scope lookup fails, and resolves it again next time', async () => {
    resolveOrgScope.mockImplementation(async (_account: string, scope: string) => scope);
    resolveOrgScope.mockRejectedValueOnce(new Error('warehouse down'));
    getAllEmployeesInternal.mockResolvedValue(baseResponse([storedRow({ commitsCount: 40 })]));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: 'rvega', email: 'rvega@lfx-partner.example', first_name: 'Rowan', last_name: 'Vega' })]);
    getKeyContactEmployees.mockResolvedValue([
      { email: 'kay@lfx-partner.example', lfUsername: 'kay', firstName: 'Kay', lastName: 'Cee', fullName: 'Kay Cee', jobTitle: null, initials: 'KC' },
    ]);
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'ann@lfx-partner.example', username: 'ann', name: 'Ann Lee' })]);
    cache.serveHits = true;

    const failed = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude', 'insights');

    expect(getAllEmployeesInternal).not.toHaveBeenCalled();
    expect(failed.rows.map((row) => row.name).sort()).toEqual(['Ann Lee', 'Kay Cee', 'Rowan Vega']);
    expect(failed.rows.every((row) => row.commitsCount === 0)).toBe(true);
    expect(cache.namespaces).toEqual([]);
    expect(cache.entry).toBeNull();
    expect(logger.warning).toHaveBeenCalledWith(req, 'get_org_people_directory', expect.stringContaining('Organization scope read failed'), expect.anything());

    const recovered = await new OrgPeopleDirectoryService().getLive(req, ACCOUNT, '365d', FILTERS, 'exclude', 'insights');

    expect(getAllEmployeesInternal).toHaveBeenCalledWith(ACCOUNT, '365d', 'all', 'insights');
    expect(recovered.rows.find((row) => row.lfUsername === 'dclarke')).toMatchObject({ commitsCount: 40 });
    expect(cache.namespaces).toEqual(['org-people-dir:v6:365d:all:insights']);
    expect(cache.entry).not.toBeNull();
  });
});

// lfx-self-serve#4735: the stored roster leaves out a current employee whose only engagement was code the live window has
// passed (`getAllEmployeesInternal`). Their Org Lens access is current state, so it alone lists them, the way it lists any
// principal with no engagement in the range: as an access-only row with no code and no stored identity.
describe('OrgPeopleDirectoryService.getLive — a current employee dropped for code the window has passed', () => {
  it('stays off the roster without live access', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([]));

    const { rows } = await run('30d');

    expect(rows).toEqual([]);
  });

  it('is listed once, access-only, with no code, when they still hold Org Lens access', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([]));
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@lfx-partner.example', username: 'dclarke', name: 'Devon Clarke', role: 'viewer' })]);

    const { rows } = await run('30d');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lfUsername: 'dclarke',
      lfid: null,
      sources: ['access'],
      accessBadge: 'viewer',
      commitsCount: 0,
      codeActivitiesCount: 0,
      seatsCount: 0,
      eventsCount: 0,
      coursesCount: 0,
    });
    expect(rows[0].personKey).toMatch(/^live-/);
    expect(rows[0].isFormer).toBeUndefined();
  });

  it('is listed former, without address or title, when they left and still hold access', async () => {
    getAllEmployeesInternal.mockResolvedValue(baseResponse([]));
    getAccessPrincipals.mockResolvedValue([
      accessUser({ email: 'dclarke@lfx-partner.example', username: 'dclarke', name: 'Devon Clarke', role: 'viewer', jobTitle: 'VP Product' }),
    ]);
    getFormerUsernames.mockResolvedValue(['dclarke']);

    const { rows } = await run('30d');

    expect(rows).toEqual([expect.objectContaining({ lfUsername: 'dclarke', sources: ['access'], isFormer: true, email: null, title: null, commitsCount: 0 })]);
  });
});
