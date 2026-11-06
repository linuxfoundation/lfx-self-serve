// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

// The real `@lfx-one/shared/utils` barrel transitively pulls Angular-only code that can't load in
// this server-only vitest environment. Spread the submodules this path actually uses — the real
// implementations, so the cache round trip below exercises the true encode/decode, not stubs.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/compact-cache.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/url.utils')),
  ...(await import('../../../../../packages/shared/src/utils/object.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-events-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
// A minimal in-memory Valkey so a write really is serialized and a read really is parsed back —
// the only way a warm-vs-cold divergence can show up at all.
vi.mock('ioredis', () => ({
  default: class {
    public status = 'ready';
    public on(): this {
      return this;
    }
    public async get(key: string): Promise<string | null> {
      return cacheValues.get(key) ?? null;
    }
    public async set(key: string, value: string): Promise<void> {
      cacheValues.set(key, value);
    }
    public async quit(): Promise<void> {
      /* No connection in this fixture. */
    }
  },
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn() }));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));

import type { CompactOrgEventAttendeesRawCache, OrgEventAttendeesResponse, OrgEventsFilters } from '@lfx-one/shared/interfaces';

import { OrgPeopleEventAttendeesService } from './org-people-event-attendees.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = 'acct-a';

const DEFAULT_PICK: Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'> = {
  range: '730d',
  attribution: 'verified',
  participation: 'registered',
};

let service: OrgPeopleEventAttendeesService;

/** The cache key of the compact read for a pick. */
function compactKey(pick: Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'> = DEFAULT_PICK): string {
  return buildOrgCacheKey(ACCOUNT, `people-event-attendees:v6:${pick.range}:${pick.attribution}:${pick.participation}`)!;
}

/**
 * Two people at the same event plus a second event, so a round trip has to survive the event
 * dictionary rather than just echoing rows back.
 */
function mockWarehouse(): void {
  execute.mockImplementation(async (query: string) => {
    if (query.includes('ORG_EVENT_PARTICIPATION_SUMMARY')) {
      return {
        rows: [{ ATTENDEES_COUNT: 5, SPEAKERS_COUNT: 1, EVENTS_COUNT: 2, FOUNDATIONS_COUNT: 1 }],
      };
    }
    if (query.includes('SELECT DISTINCT p.FOUNDATION_ID')) {
      return { rows: [{ FOUNDATION_ID: 'foundation-one', FOUNDATION_NAME: 'Foundation One' }] };
    }
    if (query.includes('SELECT DISTINCT p.EVENT_ID')) {
      return { rows: [{ EVENT_ID: 'event-one', EVENT_NAME: 'Community Summit', EVENT_DATE: '2026-04-10' }] };
    }
    return {
      rows: [
        {
          PARTICIPANT_REF: 1,
          PERSON_KEY: 'person-one',
          DISPLAY_NAME: 'Ada Lovelace',
          JOB_TITLE: 'Engineer',
          EVENT_ID: 'event-one',
          EVENT_NAME: 'Community Summit',
          EVENT_LOCATION: 'Austin Convention Center',
          EVENT_CITY: 'Austin',
          EVENT_COUNTRY: 'USA',
          EVENT_URL: 'regfox.com/community-summit',
          EVENT_START_DATE: '2026-04-08',
          EVENT_END_DATE: '2026-04-10',
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
          IS_SPEAKER: true,
        },
        {
          PARTICIPANT_REF: 2,
          PERSON_KEY: null,
          DISPLAY_NAME: null,
          JOB_TITLE: null,
          EVENT_ID: 'event-one',
          EVENT_NAME: 'Community Summit',
          EVENT_LOCATION: 'Austin Convention Center',
          EVENT_CITY: 'Austin',
          EVENT_COUNTRY: 'USA',
          EVENT_URL: 'regfox.com/community-summit',
          EVENT_START_DATE: '2026-04-08',
          EVENT_END_DATE: '2026-04-10',
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
          IS_SPEAKER: false,
        },
        {
          PARTICIPANT_REF: 2,
          PERSON_KEY: null,
          DISPLAY_NAME: null,
          JOB_TITLE: null,
          EVENT_ID: 'event-two',
          EVENT_NAME: null,
          EVENT_LOCATION: null,
          EVENT_CITY: null,
          EVENT_COUNTRY: null,
          EVENT_URL: null,
          EVENT_START_DATE: null,
          EVENT_END_DATE: null,
          FOUNDATION_ID: null,
          FOUNDATION_NAME: null,
          IS_SPEAKER: null,
        },
      ],
    };
  });
}

beforeEach(() => {
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  execute.mockReset();
  cacheValues.clear();
  ValkeyService.resetInstance();
  mockWarehouse();
  service = new OrgPeopleEventAttendeesService();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

describe('OrgPeopleEventAttendeesService response', () => {
  it('returns person × event rows keyed by participantRef and the dbt summary', async () => {
    const response = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(response.accountId).toBe(ACCOUNT);
    expect(response.summary).toEqual({ attendeesCount: 5, speakersCount: 1, eventsCount: 2, foundationsCount: 1 });
    expect(response.details.map((row) => [row.participantRef, row.eventId])).toEqual([
      [1, 'event-one'],
      [2, 'event-one'],
      [2, 'event-two'],
    ]);
    expect(response.foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'Foundation One' }]);
    expect(response.eventOptions).toEqual([{ eventId: 'event-one', eventName: 'Community Summit' }]);
  });

  it('labels a person with no name neutrally and keeps a roster-less person non-linkable', async () => {
    const { details } = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(details[0]).toMatchObject({ personKey: 'person-one', displayName: 'Ada Lovelace', jobTitle: 'Engineer', isSpeaker: true });
    expect(details[1]).toMatchObject({ personKey: null, displayName: 'Registered attendee', jobTitle: null, isSpeaker: false });
  });

  it('reads no listable predicate and no listed count: everyone credited is listed (lfx-self-serve#5158)', async () => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    const queries = execute.mock.calls.map(([query]) => query as string);
    expect(queries.some((query) => query.includes('IS_LISTABLE') || query.includes('LISTED_ATTENDEES_COUNT'))).toBe(false);
    expect(queries.find((query) => query.includes('SELECT p.PARTICIPANT_REF'))).not.toMatch(/HAS_COMPANY_EMAIL\b(?!_)/);
  });

  it('carries no address on any field, whatever the warehouse sent', async () => {
    execute.mockImplementation(async (query: string) => {
      if (query.includes('ORG_EVENT_PARTICIPATION_SUMMARY') || query.includes('SELECT DISTINCT')) {
        return { rows: [] };
      }
      return {
        rows: [
          {
            PARTICIPANT_REF: 1,
            PERSON_KEY: null,
            DISPLAY_NAME: 'ada@company.test',
            JOB_TITLE: 'ada@company.test',
            EVENT_ID: 'event-one',
            EVENT_NAME: 'Community Summit',
            EVENT_LOCATION: null,
            EVENT_CITY: null,
            EVENT_COUNTRY: null,
            EVENT_URL: null,
            EVENT_START_DATE: '2026-04-08',
            EVENT_END_DATE: '2026-04-10',
            FOUNDATION_ID: null,
            FOUNDATION_NAME: null,
            IS_SPEAKER: false,
          },
        ],
      };
    });

    const response = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(response.details[0].displayName).toBe('Registered attendee');
    expect(JSON.stringify(response)).not.toContain('@');
  });

  it('reads the summary row of the picked range, attribution and participation, with one bind per placeholder', async () => {
    await service.getEventAttendees(ACCOUNT, { range: '90d', attribution: 'all', participation: 'attended' });

    const summaryCall = execute.mock.calls.find(([query]) => (query as string).includes('ORG_EVENT_PARTICIPATION_SUMMARY'))!;
    expect(summaryCall[1]).toEqual([ACCOUNT, '90d', 'all', 'attended']);
    for (const [sql, binds] of execute.mock.calls as [string, string[]][]) {
      expect(sql.match(/\?/g)?.length ?? 0).toBe(binds.length);
    }
  });

  // lfx-self-serve#5315: Self-reported only is person-level, decided once by dbt in ORG_EVENT_PARTICIPATION_RANGED (which the
  // summary counts too); every row read joins it on the picked range instead of re-deriving the rule with a subquery.
  it('joins the ranged person-level table under Self-reported only, binding the picked range, and no other attribution does', async () => {
    await service.getEventAttendees(ACCOUNT, { range: '90d', attribution: 'self_reported', participation: 'attended' });

    const rowReads = (execute.mock.calls as [string, string[]][]).filter(([query]) => !query.includes('ORG_EVENT_PARTICIPATION_SUMMARY'));
    expect(rowReads).toHaveLength(3);
    for (const [sql, binds] of rowReads) {
      expect(sql).toContain('INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION_RANGED r');
      expect(sql).toContain('r.TIME_RANGE = ?');
      expect(sql).toContain('r.IS_COUNTED_ATTENDED_SELF_REPORTED = TRUE');
      expect(sql).not.toMatch(/EXISTS\s*\(/);
      expect(sql.match(/\?/g)?.length ?? 0).toBe(binds.length);
      expect(binds).toEqual(['90d', ACCOUNT]);
    }
    expect(rowReads.find(([query]) => query.includes('SELECT p.PARTICIPANT_REF'))![0]).toContain(
      'p.IS_COUNTED_SPEAKER_SELF_REPORTED = TRUE AND r.IS_COUNTED_SPEAKER_SELF_REPORTED = TRUE'
    );

    execute.mockClear();
    await service.getEventAttendees(ACCOUNT, { range: '90d', attribution: 'all', participation: 'attended' });
    expect(execute.mock.calls.some(([query]) => (query as string).includes('ORG_EVENT_PARTICIPATION_RANGED'))).toBe(false);
  });

  it('returns zeros when the account has no summary row', async () => {
    execute.mockImplementation(async () => ({ rows: [] }));

    const response = await service.getEventAttendees(ACCOUNT, { ...DEFAULT_PICK, attribution: 'all' });

    expect(response.summary).toEqual({ attendeesCount: 0, speakersCount: 0, eventsCount: 0, foundationsCount: 0 });
    expect(response.details).toEqual([]);
  });

  it('returns the empty response for no account', async () => {
    const response = await service.getEventAttendees('', DEFAULT_PICK);

    expect(response.details).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('OrgPeopleEventAttendeesService cache keys', () => {
  it('serves a repeated identical pick from the cache', async () => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const warehouseReads = execute.mock.calls.length;

    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it.each([
    ['range', { range: '90d' }],
    ['attribution', { attribution: 'all' }],
    ['participation', { participation: 'attended' }],
  ] as const)('keeps a different %s out of the same entry', async (_filter, change) => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const warehouseReads = execute.mock.calls.length;

    await service.getEventAttendees(ACCOUNT, { ...DEFAULT_PICK, ...change });

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('keys the picked attribution and reads no coverage flag (lfx-self-serve#5315 removed the company-email fallback)', async () => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(cacheValues.has(compactKey())).toBe(true);
    expect(execute.mock.calls.some(([query]) => (query as string).includes('COVERAGE'))).toBe(false);
  });
});

describe('OrgPeopleEventAttendeesService compact cache (GH-1906)', () => {
  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    const fromMiss = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    // `toStrictEqual` distinguishes null from undefined from an absent key; the serialized
    // comparison additionally pins key order, which the object literals fix and a decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it('rebuilds every event-level column the detail rows no longer carry, on the cache-hit path', async () => {
    // Deliberately the SECOND call: only a read-back exercises the decoder at all.
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const warehouseReads = execute.mock.calls.length;

    const { details } = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(details[0]).toEqual({
      participantRef: 1,
      personKey: 'person-one',
      displayName: 'Ada Lovelace',
      jobTitle: 'Engineer',
      eventId: 'event-one',
      eventName: 'Community Summit',
      eventLocation: 'Austin Convention Center',
      eventCity: 'Austin',
      eventCountry: 'USA',
      eventUrl: 'https://regfox.com/community-summit',
      foundationId: 'foundation-one',
      foundationName: 'Foundation One',
      eventStartDate: '2026-04-08',
      eventEndDate: '2026-04-10',
      isSpeaker: true,
    });
    expect(details.map((row) => row.eventId)).toEqual(['event-one', 'event-one', 'event-two']);
    // Two of the three detail rows share an event, so the stored dictionary has to be shorter than the detail table.
    const stored = JSON.parse(cacheValues.get(compactKey())!) as CompactOrgEventAttendeesRawCache;
    expect(stored.events.r.length).toBe(2);
    expect(stored.details.r.length).toBe(3);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const stored = JSON.parse(cacheValues.get(compactKey())!) as CompactOrgEventAttendeesRawCache;
    stored.details.k = [...stored.details.k, 'PERSON_KEY'];
    cacheValues.set(compactKey(), JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it.each([
    [
      'an index past the end of the dictionary',
      (stored: CompactOrgEventAttendeesRawCache) => (stored.detailEvents = stored.detailEvents.map(() => stored.events.r.length)),
    ],
    ['a negative index', (stored: CompactOrgEventAttendeesRawCache) => (stored.detailEvents = stored.detailEvents.map(() => -1))],
    ['a non-integer index', (stored: CompactOrgEventAttendeesRawCache) => (stored.detailEvents = stored.detailEvents.map(() => 1.5))],
    ['an index array shorter than the rows', (stored: CompactOrgEventAttendeesRawCache) => (stored.detailEvents = stored.detailEvents.slice(0, -1))],
  ])('treats a stored entry with %s as a miss', async (_label, corrupt) => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const stored = JSON.parse(cacheValues.get(compactKey())!) as CompactOrgEventAttendeesRawCache;
    corrupt(stored);
    cacheValues.set(compactKey(), JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('round-trips an empty result unchanged', async () => {
    // The empty envelope has to survive its own guard: rejecting it would make an org with no rows refetch forever.
    execute.mockImplementation(async () => ({ rows: [] }));
    const fromMiss = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(fromHit).toStrictEqual(fromMiss);
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  // Every required cell the guard checks, crossed with every way a cell can be corrupt, so dropping any one check fails a case.
  it.each(
    (
      [
        ['details', 'PARTICIPANT_REF', 'a string', 'ref'],
        ['details', 'PARTICIPANT_REF', 'absent', '\u0000'],
        ['details', 'PERSON_KEY', 'a number', 42],
        ['details', 'PERSON_KEY', 'an object', {}],
        ['events', 'EVENT_ID', 'absent', '\u0000'],
        ['events', 'EVENT_ID', 'a number', 42],
      ] as const
    ).map((entry) => [...entry])
  )('treats a stored entry whose required %s.%s cell is %s as a miss', async (table, column, _label, corrupt) => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    const stored = JSON.parse(cacheValues.get(compactKey())!) as CompactOrgEventAttendeesRawCache;
    const target = stored[table as 'details' | 'events'];
    const index = target.k.indexOf(column as string);
    target.r = target.r.map((row) => row.map((cell, position) => (position === index ? (corrupt as never) : cell)));
    cacheValues.set(compactKey(), JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('caches rows whose PERSON_KEY is null instead of missing forever', async () => {
    // The detail query does not filter a null person key (people without a roster match have none), and the
    // uncached mapper passes it straight through; a guard demanding a string would make it a permanent miss.
    const fromMiss = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    expect(fromMiss.details.some((row) => row.personKey === null)).toBe(true);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('treats a pre-participation cached entry as a miss rather than decoding it', async () => {
    const legacy = { attendeeRows: [], detailRows: [{ PERSON_KEY: 'stale' }], foundationRows: [], eventRows: [] };
    cacheValues.set(compactKey(), JSON.stringify(legacy));

    const response = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(response.details.map((row) => row.participantRef)).toEqual([1, 2, 2]);
  });
});

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: (string | number | null)[]): unknown;
    all(...values: string[]): Record<string, unknown>[];
  };
  close(): void;
}

// node:sqlite needs Node >= 22.13; this app's Node typings predate the module, hence the local shape.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqlDatabase };

/** ISO date `days` from today (UTC) — fixtures stay valid whenever the suite runs. */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The nine row-level conjunction flags dbt computes: (registered | attended | registered or attended) AND (Employee match |
 * Self-reported only | All). Employee match is a company email or a roster LF account; Self-reported only is All AND NOT
 * Employee match on the same row.
 */
function countsFlags(fixture: {
  companyEmail?: boolean;
  selfReported?: boolean;
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
}): Record<string, number> {
  const registered = fixture.registered !== false;
  const attended = fixture.attended === true;
  const verified = fixture.companyEmail !== false || fixture.roster === true;
  const all = verified || fixture.selfReported === true;
  const credited = { VERIFIED: verified, SELF_REPORTED: all && !verified, ALL: all };
  return Object.fromEntries(
    Object.entries(credited).flatMap(([suffix, flag]) => [
      [`IS_COUNTED_REGISTERED_${suffix}`, registered && flag ? 1 : 0],
      [`IS_COUNTED_ATTENDED_${suffix}`, attended && flag ? 1 : 0],
      [`IS_COUNTED_ALL_${suffix}`, (registered || attended) && flag ? 1 : 0],
    ])
  );
}

interface ParticipationFixture {
  ref: number;
  /** Days from today of the event (negative = past); the event id is derived from it. */
  days: number;
  name?: string | null;
  foundationId?: string;
  foundationName?: string;
  companyEmail?: boolean;
  /** Linked only through the organization named on the registration. */
  selfReported?: boolean;
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
  /** The legacy `IS_LISTABLE` flag dbt keeps for the previous release; the read must ignore it. */
  listable?: boolean;
  /** The row's speaker flags: an ACCEPTED talk credited with an Employee match (`verified`) or by any relation (`all`). */
  speaker?: { verified?: boolean; all?: boolean };
  account?: string;
}

type AttendeesPick = Partial<Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'>>;

/** The real SQL against SQLite: the boundaries of the ended-only rule, the range window and each predicate are exercised, not their spelling. */
describe('OrgPeopleEventAttendeesService predicates (SQLite)', () => {
  let database: SqlDatabase;

  function addRow(fixture: ParticipationFixture): void {
    const date = dayOffset(fixture.days);
    const speakerVerified = fixture.speaker?.verified === true;
    const speakerAll = speakerVerified || fixture.speaker?.all === true;
    const record: Record<string, string | number | null> = {
      ACCOUNT_ID: fixture.account ?? ACCOUNT,
      EVENT_ID: `event-${fixture.days}`,
      PARTICIPANT_REF: fixture.ref,
      PERSON_KEY: null,
      DISPLAY_NAME: fixture.name === undefined ? `Person ${fixture.ref}` : fixture.name,
      JOB_TITLE: null,
      EVENT_NAME: `Event ${fixture.days}`,
      EVENT_LOCATION: null,
      EVENT_CITY: null,
      EVENT_COUNTRY: null,
      EVENT_URL: null,
      EVENT_START_DATE: date,
      EVENT_END_DATE: date,
      EVENT_DATE: date,
      FOUNDATION_ID: fixture.foundationId ?? 'foundation-one',
      FOUNDATION_NAME: fixture.foundationName ?? (fixture.foundationId === 'foundation-two' ? 'Foundation Two' : 'Foundation One'),
      ...countsFlags(fixture),
      IS_COUNTED_SPEAKER_VERIFIED: speakerVerified ? 1 : 0,
      IS_COUNTED_SPEAKER_SELF_REPORTED: speakerAll && !speakerVerified ? 1 : 0,
      IS_COUNTED_SPEAKER_ALL: speakerAll ? 1 : 0,
      IS_LISTABLE: fixture.listable === false ? 0 : 1,
    };
    const columns = Object.keys(record);
    database.prepare(`INSERT INTO ORG_EVENT_PARTICIPATION (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(record));
  }

  const read = (pick: AttendeesPick = {}): Promise<OrgEventAttendeesResponse> => service.getEventAttendees(ACCOUNT, { ...DEFAULT_PICK, ...pick });

  const refs = async (pick: AttendeesPick = {}): Promise<number[]> => (await read(pick)).details.map((row) => row.participantRef).sort((a, b) => a - b);

  const rowKeys = async (pick: AttendeesPick = {}): Promise<string[]> => (await read(pick)).details.map((row) => `${row.participantRef}@${row.eventId}`).sort();

  const speakers = async (pick: AttendeesPick = {}): Promise<number[]> =>
    [...new Set((await read(pick)).details.filter((row) => row.isSpeaker).map((row) => row.participantRef))].sort((a, b) => a - b);

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(
      `CREATE TABLE ORG_EVENT_PARTICIPATION (
        ACCOUNT_ID TEXT, EVENT_ID TEXT, PARTICIPANT_REF INTEGER, PERSON_KEY TEXT, DISPLAY_NAME TEXT, JOB_TITLE TEXT,
        EVENT_NAME TEXT, EVENT_LOCATION TEXT, EVENT_CITY TEXT, EVENT_COUNTRY TEXT, EVENT_URL TEXT,
        EVENT_START_DATE TEXT, EVENT_END_DATE TEXT, EVENT_DATE TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT,
        IS_COUNTED_REGISTERED_VERIFIED INTEGER, IS_COUNTED_REGISTERED_SELF_REPORTED INTEGER, IS_COUNTED_REGISTERED_ALL INTEGER,
        IS_COUNTED_ATTENDED_VERIFIED INTEGER, IS_COUNTED_ATTENDED_SELF_REPORTED INTEGER, IS_COUNTED_ATTENDED_ALL INTEGER,
        IS_COUNTED_ALL_VERIFIED INTEGER, IS_COUNTED_ALL_SELF_REPORTED INTEGER, IS_COUNTED_ALL_ALL INTEGER,
        IS_COUNTED_SPEAKER_VERIFIED INTEGER, IS_COUNTED_SPEAKER_SELF_REPORTED INTEGER, IS_COUNTED_SPEAKER_ALL INTEGER, IS_LISTABLE INTEGER
      )`
    );
    database.exec(
      `CREATE TABLE ORG_EVENT_PARTICIPATION_SUMMARY (
        ACCOUNT_ID TEXT, TIME_RANGE TEXT, ATTRIBUTION TEXT, PARTICIPATION TEXT,
        ATTENDEES_COUNT INTEGER, LISTED_ATTENDEES_COUNT INTEGER, SPEAKERS_COUNT INTEGER, EVENTS_COUNT INTEGER, FOUNDATIONS_COUNT INTEGER
      )`
    );
    // dbt's ORG_EVENT_PARTICIPATION_RANGED: one row per (account, range, person) with an ended in-range row counted under All;
    // a Self-reported only flag is "counted under All in the range AND no Employee match row in the range", per participation.
    database.exec(
      `CREATE TABLE ORG_EVENT_PARTICIPATION_RANGED (
        ACCOUNT_ID TEXT, TIME_RANGE TEXT, PARTICIPANT_REF INTEGER,
        IS_COUNTED_REGISTERED_SELF_REPORTED INTEGER, IS_COUNTED_ATTENDED_SELF_REPORTED INTEGER,
        IS_COUNTED_ALL_SELF_REPORTED INTEGER, IS_COUNTED_SPEAKER_SELF_REPORTED INTEGER
      )`
    );
    execute.mockReset();
    execute.mockImplementation(async (query: string, binds: string[]) => {
      // Rebuilt before every read, the way dbt would build it from the rows the test inserted.
      database.exec(`DELETE FROM ORG_EVENT_PARTICIPATION_RANGED;
        INSERT INTO ORG_EVENT_PARTICIPATION_RANGED
        SELECT p.ACCOUNT_ID, rg.TIME_RANGE, p.PARTICIPANT_REF,
               MAX(p.IS_COUNTED_REGISTERED_ALL) = 1 AND MAX(p.IS_COUNTED_REGISTERED_VERIFIED) = 0,
               MAX(p.IS_COUNTED_ATTENDED_ALL) = 1 AND MAX(p.IS_COUNTED_ATTENDED_VERIFIED) = 0,
               MAX(p.IS_COUNTED_ALL_ALL) = 1 AND MAX(p.IS_COUNTED_ALL_VERIFIED) = 0,
               MAX(p.IS_COUNTED_SPEAKER_ALL) = 1 AND MAX(p.IS_COUNTED_SPEAKER_VERIFIED) = 0
        FROM ORG_EVENT_PARTICIPATION p
        INNER JOIN (
          SELECT '30d' AS TIME_RANGE, 30 AS DAYS UNION ALL SELECT '90d', 90 UNION ALL SELECT '365d', 365
          UNION ALL SELECT '730d', 730 UNION ALL SELECT 'all', NULL
        ) rg ON rg.DAYS IS NULL OR p.EVENT_DATE >= date('now', '-' || rg.DAYS || ' day')
        WHERE p.EVENT_DATE < date('now')
        GROUP BY p.ACCOUNT_ID, rg.TIME_RANGE, p.PARTICIPANT_REF
        HAVING MAX(p.IS_COUNTED_ALL_ALL) = 1 OR MAX(p.IS_COUNTED_SPEAKER_ALL) = 1`);
      const translated = query
        .replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')
        .replaceAll(/DATEADD\(day, -(\d+), CURRENT_DATE\(\)\)/g, "date('now', '-$1 day')")
        .replaceAll('CURRENT_DATE()', "date('now')");
      // SQLite has no BOOLEAN: hand the service true/false for the flag columns, as Snowflake does.
      const rows = database
        .prepare(translated)
        .all(...binds)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([column, value]) => [column, /^(HAS|IS)_/.test(column) && typeof value === 'number' ? value === 1 : value])
          )
        );
      return { rows };
    });
  });

  afterEach(() => {
    database.close();
  });

  it('keeps only ended events: yesterday counts, today and tomorrow do not', async () => {
    addRow({ ref: 1, days: -1 });
    addRow({ ref: 2, days: 0 });
    addRow({ ref: 3, days: 1 });

    const response = await read({ range: 'all' });

    expect(response.details.map((row) => row.participantRef)).toEqual([1]);
    expect(response.eventOptions.map((option) => option.eventId)).toEqual(['event--1']);
    expect(response.foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'Foundation One' }]);
  });

  it('offers one foundation when its name is stored padded on some rows', async () => {
    addRow({ ref: 1, days: -1 });
    addRow({ ref: 2, days: -2, foundationName: ' \tFoundation One\u00A0\n' });

    const response = await read({ range: 'all' });

    expect(response.foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'Foundation One' }]);
  });

  it('windows the range on the event date and leaves all time open', async () => {
    addRow({ ref: 1, days: -29 });
    addRow({ ref: 2, days: -31 });
    addRow({ ref: 3, days: -400 });
    addRow({ ref: 4, days: -800 });

    expect(await refs({ range: '30d' })).toEqual([1]);
    expect(await refs({ range: '90d' })).toEqual([1, 2]);
    expect(await refs({ range: '365d' })).toEqual([1, 2]);
    expect(await refs({ range: '730d' })).toEqual([1, 2, 3]);
    expect(await refs({ range: 'all' })).toEqual([1, 2, 3, 4]);
  });

  it('applies the attribution predicate to each way a person can be linked to the organization', async () => {
    addRow({ ref: 1, days: -5, companyEmail: true });
    addRow({ ref: 2, days: -5, companyEmail: false, selfReported: true });
    addRow({ ref: 3, days: -5, companyEmail: false, roster: true });
    addRow({ ref: 4, days: -5, companyEmail: false });

    expect(await refs({ attribution: 'verified' })).toEqual([1, 3]);
    expect(await refs({ attribution: 'self_reported' })).toEqual([2]);
    expect(await refs({ attribution: 'all' })).toEqual([1, 2, 3]);
  });

  it('separates registered from attended, and a rejected registration is neither', async () => {
    addRow({ ref: 1, days: -5, attended: true });
    addRow({ ref: 2, days: -5 });
    addRow({ ref: 3, days: -5, registered: false });

    expect(await refs({ participation: 'registered' })).toEqual([1, 2]);
    expect(await refs({ participation: 'attended' })).toEqual([1]);
  });

  it('lists everyone who registered or attended when Count is All, through the ALL flag of the attribution', async () => {
    addRow({ ref: 1, days: -5, attended: true });
    addRow({ ref: 2, days: -5 });
    addRow({ ref: 3, days: -5, registered: false });
    addRow({ ref: 4, days: -5, registered: false, attended: true });
    addRow({ ref: 5, days: -5, companyEmail: false, selfReported: true });

    expect(await refs({ participation: 'all' })).toEqual([1, 2, 4]);
    expect(await refs({ participation: 'all', attribution: 'self_reported' })).toEqual([5]);
    expect(await refs({ participation: 'all', attribution: 'all' })).toEqual([1, 2, 4, 5]);
  });

  // lfx-self-serve#5315: Self-reported only is person-level, like its summary row. A person with an Employee match anywhere in the
  // range and participation is counted under Employee match only, so people add up: Employee match + Self-reported only = All.
  it('lists a person who is an Employee match at one event and self-reported at another under Employee match only', async () => {
    addRow({ ref: 7, days: -5 });
    addRow({ ref: 7, days: -10, companyEmail: false, selfReported: true });
    addRow({ ref: 8, days: -6, companyEmail: false, selfReported: true });
    addRow({ ref: 8, days: -12, companyEmail: false, selfReported: true });

    expect(await rowKeys({ attribution: 'verified' })).toEqual(['7@event--5']);
    expect(await rowKeys({ attribution: 'self_reported' })).toEqual(['8@event--12', '8@event--6']);
    expect(await rowKeys({ attribution: 'all' })).toEqual(['7@event--10', '7@event--5', '8@event--12', '8@event--6']);

    const people = async (attribution: OrgEventsFilters['attribution']): Promise<number> => new Set(await refs({ attribution })).size;
    expect(await people('verified')).toBe(1);
    expect(await people('self_reported')).toBe(1);
    expect((await people('verified')) + (await people('self_reported'))).toBe(await people('all'));
  });

  it('applies the person-level rule within the picked range and participation only', async () => {
    // Person 9: Employee match only outside a 90-day range, self-reported inside it.
    addRow({ ref: 9, days: -400 });
    addRow({ ref: 9, days: -10, companyEmail: false, selfReported: true });
    // Person 10: registered with an Employee match but did not attend; attended where only self-reported.
    addRow({ ref: 10, days: -20 });
    addRow({ ref: 10, days: -30, companyEmail: false, selfReported: true, attended: true });

    expect(await refs({ range: '90d', attribution: 'self_reported' })).toEqual([9]);
    expect(await refs({ range: '730d', attribution: 'self_reported' })).toEqual([]);
    expect(await refs({ range: '90d', attribution: 'self_reported', participation: 'attended' })).toEqual([10]);
    expect(await refs({ range: '90d', attribution: 'verified', participation: 'attended' })).toEqual([]);
  });

  it('flags a Speaker only for an accepted talk the picked attribution credits', async () => {
    // Person 1: self-reported registrant with an accepted talk credited only through the named organization.
    addRow({ ref: 1, days: -5, companyEmail: false, selfReported: true, speaker: { all: true } });
    addRow({ ref: 1, days: -6, companyEmail: false, selfReported: true });
    // Person 2: an accepted talk credited with an Employee match.
    addRow({ ref: 2, days: -5, speaker: { verified: true } });
    // Person 3: no talk.
    addRow({ ref: 3, days: -5 });

    expect(await speakers({ attribution: 'verified' })).toEqual([2]);
    expect(await speakers({ attribution: 'self_reported' })).toEqual([1]);
    expect(await speakers({ attribution: 'all' })).toEqual([1, 2]);
  });

  it('does not flag a Speaker under Self-reported only for someone who spoke with an Employee match', async () => {
    addRow({ ref: 1, days: -5, companyEmail: false, selfReported: true, speaker: { all: true } });
    addRow({ ref: 2, days: -5, companyEmail: false, selfReported: true, speaker: { verified: true } });
    addRow({ ref: 3, days: -5, companyEmail: false, selfReported: true });

    expect(await refs({ attribution: 'self_reported' })).toEqual([1, 2, 3]);
    expect(await speakers({ attribution: 'self_reported' })).toEqual([1]);
  });

  it('does not flag a Speaker under Self-reported only for someone verified as a speaker at another event in the range', async () => {
    // Person 1: accepted talk with an Employee match at one event, self-reported accepted talk at another.
    addRow({ ref: 1, days: -5, companyEmail: false, selfReported: true, speaker: { verified: true } });
    addRow({ ref: 1, days: -8, companyEmail: false, selfReported: true, speaker: { all: true } });
    // Person 2: the same self-reported talk, with the Employee match talk outside a 90-day range.
    addRow({ ref: 2, days: -400, companyEmail: false, selfReported: true, speaker: { verified: true } });
    addRow({ ref: 2, days: -8, companyEmail: false, selfReported: true, speaker: { all: true } });

    expect(await rowKeys({ range: '90d', attribution: 'self_reported' })).toEqual(['1@event--5', '1@event--8', '2@event--8']);
    expect(await speakers({ range: '90d', attribution: 'self_reported' })).toEqual([2]);
    expect(await speakers({ range: '730d', attribution: 'self_reported' })).toEqual([]);
  });

  it('lists exactly the people the ranged table counts as Self-reported only, the set the summary counts', async () => {
    // Mixed: Employee match at one event, self-reported at another (not listed), next to people only ever self-reported.
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 1, days: -10, companyEmail: false, selfReported: true });
    addRow({ ref: 2, days: -6, companyEmail: false, selfReported: true, attended: true });
    addRow({ ref: 3, days: -7, companyEmail: false, selfReported: true });
    addRow({ ref: 3, days: -9, attended: true, registered: false });

    for (const participation of ['registered', 'attended', 'all'] as const) {
      const listed = [...new Set(await refs({ range: '90d', attribution: 'self_reported', participation }))];
      const column = `IS_COUNTED_${participation.toUpperCase()}_SELF_REPORTED`;
      const counted = database
        .prepare(`SELECT PARTICIPANT_REF FROM ORG_EVENT_PARTICIPATION_RANGED WHERE ACCOUNT_ID = ? AND TIME_RANGE = ? AND ${column} = 1 ORDER BY 1`)
        .all(ACCOUNT, '90d')
        .map((row) => row['PARTICIPANT_REF']);
      expect(listed).toEqual(counted);
    }
    expect(await refs({ range: '90d', attribution: 'self_reported', participation: 'registered' })).toEqual([2, 3]);
    expect(await refs({ range: '90d', attribution: 'self_reported', participation: 'attended' })).toEqual([2]);
    expect(await refs({ range: '90d', attribution: 'self_reported', participation: 'all' })).toEqual([2]);
  });

  it('lists everyone the selection credits, whatever the legacy listable flag says', async () => {
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 2, days: -5, name: 'Self-reported Registrant', companyEmail: false, selfReported: true, listable: false });

    const response = await read({ attribution: 'all' });

    expect(response.details.map((row) => [row.participantRef, row.displayName])).toEqual([
      [1, 'Person 1'],
      [2, 'Self-reported Registrant'],
    ]);
  });

  it('Employee match (verified) leaves out people linked only by what they named on their registration', async () => {
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 2, days: -5, companyEmail: false, roster: true });
    addRow({ ref: 3, days: -5, companyEmail: false, selfReported: true });
    addRow({ ref: 4, days: -5, companyEmail: false, selfReported: true, speaker: { all: true } });
    addRow({ ref: 5, days: -5, speaker: { verified: true } });

    const response = await read({ attribution: 'verified' });

    expect(response.details.map((row) => row.participantRef).sort((a, b) => a - b)).toEqual([1, 2, 5]);
    expect(response.details.filter((row) => row.isSpeaker).map((row) => row.participantRef)).toEqual([5]);
  });

  it("never reads another account's rows", async () => {
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 2, days: -5, account: 'acct-b' });
    addRow({ ref: 3, days: -5, companyEmail: false, selfReported: true });
    // Another account's Employee match row for person 3 must not hide them here.
    addRow({ ref: 3, days: -6, account: 'acct-b' });

    expect(await refs()).toEqual([1]);
    expect(await refs({ attribution: 'self_reported' })).toEqual([3]);
  });

  it('narrows the foundation and event options to the same filtered rows', async () => {
    addRow({ ref: 1, days: -5, foundationId: 'foundation-one' });
    addRow({ ref: 2, days: -6, foundationId: 'foundation-two', companyEmail: false });
    addRow({ ref: 3, days: -400, foundationId: 'foundation-two' });

    const response = await read({ range: '90d' });

    expect(response.foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'Foundation One' }]);
    expect(response.eventOptions.map((option) => option.eventId)).toEqual(['event--5']);
  });

  it('reads the summary row of the picked range, attribution and participation only', async () => {
    database
      .prepare(
        'INSERT INTO ORG_EVENT_PARTICIPATION_SUMMARY (ACCOUNT_ID, TIME_RANGE, ATTRIBUTION, PARTICIPATION, ATTENDEES_COUNT, LISTED_ATTENDEES_COUNT, SPEAKERS_COUNT, EVENTS_COUNT, FOUNDATIONS_COUNT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(ACCOUNT, '90d', 'self_reported', 'attended', 11, 4, 2, 3, 1);

    const response = await read({ range: '90d', attribution: 'self_reported', participation: 'attended' });

    expect(response.summary).toEqual({ attendeesCount: 11, speakersCount: 2, eventsCount: 3, foundationsCount: 1 });
  });

  it('reads the registered-or-attended summary row when Count is All', async () => {
    const insertSummary = database.prepare(
      'INSERT INTO ORG_EVENT_PARTICIPATION_SUMMARY (ACCOUNT_ID, TIME_RANGE, ATTRIBUTION, PARTICIPATION, ATTENDEES_COUNT, LISTED_ATTENDEES_COUNT, SPEAKERS_COUNT, EVENTS_COUNT, FOUNDATIONS_COUNT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertSummary.run(ACCOUNT, '730d', 'all', 'registered', 8, 3, 2, 4, 2);
    insertSummary.run(ACCOUNT, '730d', 'all', 'all', 13, 5, 2, 6, 3);

    const response = await read({ range: '730d', attribution: 'all', participation: 'all' });

    expect(response.summary).toEqual({ attendeesCount: 13, speakersCount: 2, eventsCount: 6, foundationsCount: 3 });
  });
});
