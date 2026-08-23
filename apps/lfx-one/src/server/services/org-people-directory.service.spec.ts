// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac } from 'crypto';

import type { OrgAccessUser, OrgAllEmployeeRow, OrgAllEmployeesResponse, KeyContactEmployee } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so runtime collaborators are mocked. The four source services are constructed in
// OrgPeopleDirectoryService's constructor, so they must be mocked at module level. `withPerUserCache`
// is stubbed to a pass-through so tests exercise the merge rather than the cache.
const { getAllEmployees, fetchAllOrgSeats, getKeyContactEmployees, getAccessPrincipals } = vi.hoisted(() => ({
  getAllEmployees: vi.fn(),
  fetchAllOrgSeats: vi.fn(),
  getKeyContactEmployees: vi.fn(),
  getAccessPrincipals: vi.fn(),
}));

vi.mock('./org-lens-people.service', () => ({
  OrgLensPeopleService: class {
    public getAllEmployees = getAllEmployees;
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
vi.mock('./valkey.service', () => ({
  withPerUserCache: (_ns: string, _user: string, _org: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
}));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'tester' }));

// The `@lfx-one/shared/*` barrels pull Angular into this node-environment suite, so the handful of
// runtime values the service imports are stubbed here (same approach as ai.service.spec.ts /
// committee-engagement.service.spec.ts). `isBoardCategory` and `splitDisplayName` mirror the real
// implementations, since the merge's board-vs-committee split and name fill depend on their behaviour.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({
  VALKEY_CACHE: { ORG_PEOPLE_DIRECTORY_NAMESPACE: 'org-people-directory', ORG_LENS_PERUSER_TTL_SECONDS: 60 },
  EMPTY_ORG_ALL_EMPLOYEES_RESPONSE: {
    accountId: '',
    rows: [],
    stats: { activeInOss: 0, inGovernance: 0, codeContributors: 0, eventAttendees: 0, trainees: 0 },
    foundations: [],
  },
  isBoardCategory: (category: string | null | undefined) => (category ?? '').trim().toLowerCase() === 'board',
}));
vi.mock('@lfx-one/shared/utils', () => ({
  splitDisplayName: (name: string | null): [string | null, string | null] => {
    const trimmed = (name ?? '').trim();
    if (!trimmed || trimmed.includes('@')) return [null, null];
    const parts = trimmed.split(/\s+/);
    return parts.length === 1 ? [parts[0], null] : [parts[0], parts.slice(1).join(' ')];
  },
}));

import { OrgPeopleDirectoryService, resolveMergeKey } from './org-people-directory.service';

const ACCOUNT = '0014100000Te2ovAAB';
const req = {} as never;

function storedRow(over: Partial<OrgAllEmployeeRow> = {}): OrgAllEmployeeRow {
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
    eventsCount: 13,
    coursesCount: 0,
    engagedFoundationIds: [],
    ...over,
  };
}

function baseResponse(rows: OrgAllEmployeeRow[]): OrgAllEmployeesResponse {
  return { accountId: ACCOUNT, rows, stats: { activeInOss: 0, inGovernance: 0, codeContributors: 0, eventAttendees: 0, trainees: 0 }, foundations: [] };
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

async function run(): Promise<OrgAllEmployeesResponse> {
  return new OrgPeopleDirectoryService().getLive(req, ACCOUNT);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAllEmployees.mockResolvedValue(baseResponse([]));
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
    getAllEmployees.mockResolvedValue(
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
    expect(rows[0].emails).toEqual(expect.arrayContaining(['dqualls@contractor.lfx-partner.example', 'dqualls@lfx-partner.example']));
  });

  it('merges a committee seat into the stored row on username (the Devon case)', async () => {
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat()]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].emails).toEqual(expect.arrayContaining(['dclarke@lfx-partner.example', 'dclarke@contractor.lfx-partner.example']));
  });

  it('collapses a person arriving from three sources into one row (the Jamie Ortiz case)', async () => {
    getAllEmployees.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'jortiz', name: 'Jamie Ortiz', email: 'jortiz@vendor-corp.example', emails: ['jortiz@vendor-corp.example'] })])
    );
    fetchAllOrgSeats.mockResolvedValue([
      seat({ email: 'jamie.ortiz@vendor-corp.example', username: 'jortiz' }),
      seat({ uid: 'seat-2', email: 'jamie.ortiz@lfx-partner.example', username: 'jortiz', committee_category: 'Board' }),
    ]);

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].emails).toHaveLength(3);
  });

  it('keeps the stored personKey so a merged row stays expandable', async () => {
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat()]);

    const { rows } = await run();

    expect(rows[0].personKey).toBe('lfnEMOUiFenugGty80');
    expect(rows[0].personKey).not.toMatch(/^live-/);
  });
});

describe('OrgPeopleDirectoryService.merge — access badge is server-attributed', () => {
  it('stamps the merged principal\u2019s badge on the row', async () => {
    getAllEmployees.mockResolvedValue(
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
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));

    const { rows } = await run();

    expect(rows[0].accessBadge).toBeUndefined();
  });

  it('does not stamp one person\u2019s badge onto another who shares an address', async () => {
    // Two distinct identities, one shared address. Only the person the access principal actually
    // resolves to may carry the badge — an address-based join could not tell them apart.
    getAllEmployees.mockResolvedValue(
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
    getAllEmployees.mockResolvedValue(
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
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
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
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'someone.else@example.com' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });

  it('never absorbs a row that carries its own identity', async () => {
    // Two verified identities at one address stay apart: only identity-less rows are candidates.
    getAllEmployees.mockResolvedValue(
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

    getAllEmployees.mockResolvedValue(baseResponse(both));
    fetchAllOrgSeats.mockResolvedValue([seat({ username: null, email: 'shared@example.com' })]);
    const forward = await run();

    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(baseResponse([both[1], both[0]]));
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
    getAllEmployees.mockResolvedValue(
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
    getAllEmployees.mockResolvedValue(
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
    getAllEmployees.mockResolvedValue(
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
    getAllEmployees.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'spateloai', name: 'Sam Patel', email: 'spatel@partner-corp.example', emails: ['spatel@partner-corp.example'] })])
    );
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@lfx-partner.example', username: 'dclarke', name: 'Devon Clarke' })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });
});

describe('OrgPeopleDirectoryService.merge — invariants', () => {
  it('a live seat does not increment a stored row\u2019s seat counters', async () => {
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
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

  it('sources are de-duplicated and emails are lowercased and unique', async () => {
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockResolvedValue([seat({ email: 'DClarke@Lfx-Partner.Example' }), seat({ uid: 'seat-2', email: 'dclarke@lfx-partner.example' })]);

    const { rows } = await run();

    expect(new Set(rows[0].sources).size).toBe(rows[0].sources.length);
    expect(new Set(rows[0].emails).size).toBe(rows[0].emails.length);
    expect(rows[0].emails.every((e) => e === e.toLowerCase())).toBe(true);
  });

  it('a pending invite is not merged into a person, even when the address matches', async () => {
    getAllEmployees.mockResolvedValue(
      baseResponse([storedRow({ lfUsername: 'dqualls', name: 'Dano Qualls', email: 'dqualls@lfx-partner.example', emails: ['dqualls@lfx-partner.example'] })])
    );
    getAccessPrincipals.mockResolvedValue([accessUser({ username: null, inviteStatus: 'pending', isPending: true })]);

    const { rows } = await run();

    expect(rows).toHaveLength(2);
  });
});

describe('OrgPeopleDirectoryService.merge — no regression for single-source people', () => {
  it('leaves a stored-only person untouched', async () => {
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));

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
    getAllEmployees.mockResolvedValue(baseResponse([storedRow({ lfUsername: null, email: null, emails: [] })]));

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
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
    getAccessPrincipals.mockResolvedValue([accessUser({ email: 'dclarke@contractor.lfx-partner.example', username: 'dclarke', name: 'Devon Clarke' })]);

    const { rows, stats } = await run();

    expect(rows).toHaveLength(1);
    expect(stats.inGovernance).toBe(1);
    expect(stats.activeInOss).toBe(1);
  });

  it('degrades gracefully when a live source fails, keeping the stored roster', async () => {
    getAllEmployees.mockResolvedValue(baseResponse([storedRow()]));
    fetchAllOrgSeats.mockRejectedValue(new Error('committee-service down'));

    const { rows } = await run();

    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual(['snowflake']);
  });
});
