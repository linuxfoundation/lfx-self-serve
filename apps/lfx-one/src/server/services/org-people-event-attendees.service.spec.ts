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

import type { CompactOrgEventAttendeesRawCache, OrgEventsFilters } from '@lfx-one/shared/interfaces';

import { OrgPeopleEventAttendeesService } from './org-people-event-attendees.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = 'acct-a';

const DEFAULT_PICK: Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'> = {
  range: '730d',
  attribution: 'company_email',
  participation: 'registered',
};

let service: OrgPeopleEventAttendeesService;
let hasCoverage: boolean;

/** The cache key of the compact read for a pick. */
function compactKey(pick: Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'> = DEFAULT_PICK): string {
  return buildOrgCacheKey(ACCOUNT, `people-event-attendees:v5:${pick.range}:${pick.attribution}:${pick.participation}`)!;
}

/**
 * Two people at the same event plus a second event, so a round trip has to survive the event
 * dictionary rather than just echoing rows back.
 */
function mockWarehouse(): void {
  execute.mockImplementation(async (query: string) => {
    if (query.includes('TIME_RANGE')) {
      return {
        rows: [{ ATTENDEES_COUNT: 5, SPEAKERS_COUNT: 1, EVENTS_COUNT: 2, FOUNDATIONS_COUNT: 1 }],
      };
    }
    if (query.includes('HAS_COMPANY_EMAIL_COVERAGE')) {
      return { rows: [{ HAS_COMPANY_EMAIL_COVERAGE: hasCoverage }] };
    }
    if (query.includes('SELECT DISTINCT FOUNDATION_ID')) {
      return { rows: [{ FOUNDATION_ID: 'foundation-one', FOUNDATION_NAME: 'Foundation One' }] };
    }
    if (query.includes('SELECT DISTINCT EVENT_ID')) {
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
  hasCoverage = true;
  mockWarehouse();
  service = new OrgPeopleEventAttendeesService();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

describe('OrgPeopleEventAttendeesService response', () => {
  it('returns person × event rows keyed by participantRef, the dbt summary and the served attribution', async () => {
    const response = await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(response.accountId).toBe(ACCOUNT);
    expect(response.servedAttribution).toBe('company_email');
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
    expect(queries.find((query) => query.includes('SELECT PARTICIPANT_REF'))).not.toMatch(/HAS_COMPANY_EMAIL\b(?!_)/);
  });

  it('carries no address on any field, whatever the warehouse sent', async () => {
    execute.mockImplementation(async (query: string) => {
      if (query.includes('TIME_RANGE') || query.includes('HAS_COMPANY_EMAIL_COVERAGE') || query.includes('SELECT DISTINCT')) {
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

    const summaryCall = execute.mock.calls.find(([query]) => (query as string).includes('TIME_RANGE'))!;
    expect(summaryCall[1]).toEqual([ACCOUNT, '90d', 'all', 'attended']);
    for (const [sql, binds] of execute.mock.calls as [string, string[]][]) {
      expect(sql.match(/\?/g)?.length ?? 0).toBe(binds.length);
    }
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

  it('keys the served attribution, so the coverage fallback never shares the company-email entry', async () => {
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);
    expect(cacheValues.has(compactKey())).toBe(true);

    hasCoverage = false;
    cacheValues.delete(buildOrgCacheKey(ACCOUNT, 'events-coverage:v1')!);
    await service.getEventAttendees(ACCOUNT, DEFAULT_PICK);

    expect(cacheValues.has(compactKey({ ...DEFAULT_PICK, attribution: 'account' }))).toBe(true);
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

/** The nine row-level conjunction flags dbt computes: (registered | attended | registered or attended) AND (company email | account | any relation). */
function countsFlags(fixture: {
  companyEmail?: boolean;
  accountCredited?: boolean;
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
}): Record<string, number> {
  const registered = fixture.registered !== false;
  const attended = fixture.attended === true;
  const credited = {
    VERIFIED: fixture.companyEmail !== false || fixture.roster === true,
    COMPANY_EMAIL: fixture.companyEmail !== false,
    ACCOUNT: fixture.accountCredited === true,
    ALL: fixture.companyEmail !== false || fixture.accountCredited === true || fixture.roster === true,
  };
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
  accountCredited?: boolean;
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
  /** The legacy `IS_LISTABLE` flag dbt keeps for the previous release; the read must ignore it. */
  listable?: boolean;
  /** The row's `IS_COUNTED_SPEAKER_*` flags: an ACCEPTED talk credited under that attribution. All false for a submitted-only or elsewhere-credited talk. */
  speaker?: { verified?: boolean; companyEmail?: boolean; account?: boolean; all?: boolean };
  account?: string;
}

/** The real SQL against SQLite: the boundaries of the ended-only rule, the range window and each predicate are exercised, not their spelling. */
describe('OrgPeopleEventAttendeesService predicates (SQLite)', () => {
  let database: SqlDatabase;

  function addRow(fixture: ParticipationFixture): void {
    const date = dayOffset(fixture.days);
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
      IS_COUNTED_SPEAKER_VERIFIED: fixture.speaker?.verified ? 1 : 0,
      IS_COUNTED_SPEAKER_COMPANY_EMAIL: fixture.speaker?.companyEmail ? 1 : 0,
      IS_COUNTED_SPEAKER_ACCOUNT: fixture.speaker?.account ? 1 : 0,
      IS_COUNTED_SPEAKER_ALL: fixture.speaker?.all ? 1 : 0,
      IS_LISTABLE: fixture.listable === false ? 0 : 1,
    };
    const columns = Object.keys(record);
    database.prepare(`INSERT INTO ORG_EVENT_PARTICIPATION (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(record));
  }

  function setCoverage(covered: boolean): void {
    database
      .prepare(
        'INSERT INTO ORG_EVENT_PARTICIPATION_SUMMARY (ACCOUNT_ID, TIME_RANGE, ATTRIBUTION, PARTICIPATION, ATTENDEES_COUNT, HAS_COMPANY_EMAIL_COVERAGE) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(ACCOUNT, '730d', 'company_email', 'registered', 7, covered ? 1 : 0);
  }

  const read = (
    pick: Partial<Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'>> = {}
  ): ReturnType<OrgPeopleEventAttendeesService['getEventAttendees']> => service.getEventAttendees(ACCOUNT, { ...DEFAULT_PICK, ...pick });

  const refs = async (pick: Partial<Pick<OrgEventsFilters, 'range' | 'attribution' | 'participation'>> = {}): Promise<number[]> =>
    (await read(pick)).details.map((row) => row.participantRef).sort((a, b) => a - b);

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(
      `CREATE TABLE ORG_EVENT_PARTICIPATION (
        ACCOUNT_ID TEXT, EVENT_ID TEXT, PARTICIPANT_REF INTEGER, PERSON_KEY TEXT, DISPLAY_NAME TEXT, JOB_TITLE TEXT,
        EVENT_NAME TEXT, EVENT_LOCATION TEXT, EVENT_CITY TEXT, EVENT_COUNTRY TEXT, EVENT_URL TEXT,
        EVENT_START_DATE TEXT, EVENT_END_DATE TEXT, EVENT_DATE TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT,
        IS_COUNTED_REGISTERED_VERIFIED INTEGER, IS_COUNTED_REGISTERED_COMPANY_EMAIL INTEGER, IS_COUNTED_REGISTERED_ACCOUNT INTEGER, IS_COUNTED_REGISTERED_ALL INTEGER,
        IS_COUNTED_ATTENDED_VERIFIED INTEGER, IS_COUNTED_ATTENDED_COMPANY_EMAIL INTEGER, IS_COUNTED_ATTENDED_ACCOUNT INTEGER, IS_COUNTED_ATTENDED_ALL INTEGER,
        IS_COUNTED_ALL_VERIFIED INTEGER, IS_COUNTED_ALL_COMPANY_EMAIL INTEGER, IS_COUNTED_ALL_ACCOUNT INTEGER, IS_COUNTED_ALL_ALL INTEGER,
        IS_COUNTED_SPEAKER_VERIFIED INTEGER, IS_COUNTED_SPEAKER_COMPANY_EMAIL INTEGER, IS_COUNTED_SPEAKER_ACCOUNT INTEGER, IS_COUNTED_SPEAKER_ALL INTEGER, IS_LISTABLE INTEGER
      )`
    );
    database.exec(
      `CREATE TABLE ORG_EVENT_PARTICIPATION_SUMMARY (
        ACCOUNT_ID TEXT, TIME_RANGE TEXT, ATTRIBUTION TEXT, PARTICIPATION TEXT,
        ATTENDEES_COUNT INTEGER, LISTED_ATTENDEES_COUNT INTEGER, SPEAKERS_COUNT INTEGER, EVENTS_COUNT INTEGER, FOUNDATIONS_COUNT INTEGER,
        HAS_COMPANY_EMAIL_COVERAGE INTEGER
      )`
    );
    execute.mockReset();
    execute.mockImplementation(async (query: string, binds: string[]) => {
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
    setCoverage(true);
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

  it('applies the attribution predicate to each way a person can be related to the company', async () => {
    addRow({ ref: 1, days: -5, companyEmail: true });
    addRow({ ref: 2, days: -5, companyEmail: false, accountCredited: true });
    addRow({ ref: 3, days: -5, companyEmail: false, roster: true });
    addRow({ ref: 4, days: -5, companyEmail: false });

    expect(await refs({ attribution: 'company_email' })).toEqual([1]);
    expect(await refs({ attribution: 'account' })).toEqual([2]);
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
    addRow({ ref: 5, days: -5, companyEmail: false, accountCredited: true });

    expect(await refs({ participation: 'all' })).toEqual([1, 2, 4]);
    expect(await refs({ participation: 'all', attribution: 'account' })).toEqual([5]);
    expect(await refs({ participation: 'all', attribution: 'all' })).toEqual([1, 2, 4, 5]);
  });

  it('flags a Speaker only for an accepted talk the served attribution credits', async () => {
    const speakers = async (attribution: 'company_email' | 'account' | 'all'): Promise<number[]> =>
      (await read({ attribution })).details
        .filter((row) => row.isSpeaker)
        .map((row) => row.participantRef)
        .sort((a, b) => a - b);

    // Person 1: an accepted talk credited only to the account at one event, a submitted-only talk at another. Not a company-email Speaker.
    addRow({ ref: 1, days: -5, speaker: { account: true, all: true } });
    addRow({ ref: 1, days: -6 });
    // Person 2: an accepted talk credited by company email.
    addRow({ ref: 2, days: -5, speaker: { companyEmail: true, all: true } });
    // Person 3: no talk.
    addRow({ ref: 3, days: -5 });

    expect(await speakers('company_email')).toEqual([2]);
    expect(await speakers('account')).toEqual([]);
    expect(await speakers('all')).toEqual([1, 2]);
  });

  it('counts account-credited talks as Speaker under account attribution', async () => {
    addRow({ ref: 1, days: -5, companyEmail: false, accountCredited: true, speaker: { account: true, all: true } });
    addRow({ ref: 2, days: -5, companyEmail: false, accountCredited: true, speaker: { companyEmail: true, all: true } });
    addRow({ ref: 3, days: -5, companyEmail: false, accountCredited: true });

    const response = await read({ attribution: 'account' });

    expect(response.details.filter((row) => row.isSpeaker).map((row) => row.participantRef)).toEqual([1]);
  });

  it('lists everyone the selection credits, whatever the legacy listable flag says', async () => {
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 2, days: -5, name: 'Account Registrant', companyEmail: false, accountCredited: true, listable: false });

    const response = await read({ attribution: 'all' });

    expect(response.details.map((row) => [row.participantRef, row.displayName])).toEqual([
      [1, 'Person 1'],
      [2, 'Account Registrant'],
    ]);
  });

  it('Company email or employee (verified) leaves out people credited only by what they named on their registration', async () => {
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 2, days: -5, companyEmail: false, roster: true });
    addRow({ ref: 3, days: -5, companyEmail: false, accountCredited: true });
    addRow({ ref: 4, days: -5, companyEmail: false, accountCredited: true, speaker: { account: true, all: true } });
    addRow({ ref: 5, days: -5, speaker: { verified: true, companyEmail: true, all: true } });

    const response = await read({ attribution: 'verified' });

    expect(response.details.map((row) => row.participantRef).sort((a, b) => a - b)).toEqual([1, 2, 5]);
    expect(response.details.filter((row) => row.isSpeaker).map((row) => row.participantRef)).toEqual([5]);
    expect(response.servedAttribution).toBe('verified');
  });

  it("never reads another account's rows", async () => {
    addRow({ ref: 1, days: -5 });
    addRow({ ref: 2, days: -5, account: 'acct-b' });

    expect(await refs()).toEqual([1]);
  });

  it('narrows the foundation and event options to the same filtered rows', async () => {
    addRow({ ref: 1, days: -5, foundationId: 'foundation-one' });
    addRow({ ref: 2, days: -6, foundationId: 'foundation-two', companyEmail: false });
    addRow({ ref: 3, days: -400, foundationId: 'foundation-two' });

    const response = await read({ range: '90d' });

    expect(response.foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'Foundation One' }]);
    expect(response.eventOptions.map((option) => option.eventId)).toEqual(['event--5']);
  });

  it('serves the account attribution when the company has no company-email data', async () => {
    database.exec('DELETE FROM ORG_EVENT_PARTICIPATION_SUMMARY');
    setCoverage(false);
    addRow({ ref: 1, days: -5, companyEmail: true });
    addRow({ ref: 2, days: -5, companyEmail: false, accountCredited: true });

    const response = await read();

    expect(response.servedAttribution).toBe('account');
    expect(response.details.map((row) => row.participantRef)).toEqual([2]);
  });

  it('reads the summary row of the picked range, attribution and participation only', async () => {
    database
      .prepare(
        'INSERT INTO ORG_EVENT_PARTICIPATION_SUMMARY (ACCOUNT_ID, TIME_RANGE, ATTRIBUTION, PARTICIPATION, ATTENDEES_COUNT, LISTED_ATTENDEES_COUNT, SPEAKERS_COUNT, EVENTS_COUNT, FOUNDATIONS_COUNT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(ACCOUNT, '90d', 'all', 'attended', 11, 4, 2, 3, 1);

    const response = await read({ range: '90d', attribution: 'all', participation: 'attended' });

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
