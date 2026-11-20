// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { GetOrgEventsOptions, OrgLensRollUpScope } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, cacheValues } = vi.hoisted(() => ({ execute: vi.fn(), cacheValues: new Map<string, string>() }));

// Narrow the shared barrels to the modules this service actually reads: the full barrels reach
// Angular-dependent code that will not load in the plain-Node server environment.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/date-time.utils')),
  ...(await import('../../../../../packages/shared/src/utils/url.utils')),
  // Needed by the real valkey.service, which this spec exercises rather than stubs.
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  // `isObjectRow` backs the `accept` predicates this service passes to the cache. Omitting it does not fail
  // loudly: vitest throws from INSIDE `getJson`'s try, which fails soft to a cache miss, so every read would
  // miss and the cache assertions here would assert against a cache that never hits.
  ...(await import('../../../../../packages/shared/src/utils/object.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-events-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
  ...(await import('../../../../../packages/shared/src/constants/org-events-filters.constants')),
  ...(await import('../../../../../packages/shared/src/constants/org-lens-time-range.constants')),
}));
// Only the query-string reader of the real helper is needed; the rest pulls barrels this environment cannot load.
vi.mock('../helpers/validation.helper', () => ({
  getStringQueryParam: (req: Request, name: string): string | undefined => {
    const value = req.query[name];
    return typeof value === 'string' ? value : undefined;
  },
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
/**
 * The REAL `withOrgCache` over a Map-backed Redis, as `org-lens-people.service.spec.ts` does. A stub that
 * always calls the fetcher cannot tell a cached read from an uncached one.
 */
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
vi.mock('./valkey.service', async () => {
  const actual = await vi.importActual<typeof import('./valkey.service')>('./valkey.service');
  return {
    ...actual,
    withOrgCache: <T>(
      account: string,
      key: string,
      ttl: number,
      fetcher: () => Promise<T>,
      accept?: (value: unknown) => boolean,
      storable?: (value: T) => boolean
    ): Promise<T> => actual.ValkeyService.getInstance().withCache(actual.buildOrgCacheKey(account, key), ttl, fetcher, accept, storable),
  };
});
const { checkLFStaff } = vi.hoisted(() => ({ checkLFStaff: vi.fn() }));
// Mocked rather than exercised: the real module pulls in NATS config this fixture has no use for,
// and the behaviour under test is "what does the service do with the answer", not how it is derived.
vi.mock('./persona-detection.service', () => ({
  PersonaDetectionService: class {
    public checkLFStaff = checkLFStaff;
  },
}));

vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));

import { OrgLensEventsService } from './org-lens-events.service';
import { ValkeyService } from './valkey.service';

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

const ACCOUNT = 'acct-a';
const OTHER_ACCOUNT = 'acct-b';
const REQ = {} as Request;

/** ISO date `days` from today (UTC) — fixtures stay valid whenever the suite runs. */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function listOptions(overrides: Partial<GetOrgEventsOptions> = {}): GetOrgEventsOptions {
  return {
    isPast: false,
    pageSize: 25,
    offset: 0,
    sortField: 'EVENT_START_DATE',
    sortOrder: 'ASC',
    participation: 'registered',
    eventScope: 'activity',
    foundation: '',
    range: '730d',
    ...overrides,
  };
}

function insert(table: string, record: Record<string, string | number | null>): void {
  const columns = Object.keys(record);
  database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(record));
}

interface EventFixture {
  eventId?: string;
  name?: string;
  isPast?: boolean;
  /** Days from today of the event date (negative = past). */
  daysFromToday?: number;
  foundationId?: string;
  foundationName?: string;
  account?: string;
  registered?: { verified?: number };
  attended?: { verified?: number };
  /** Distinct people who registered or attended; defaults to the larger of the registered and attended counts. */
  registeredOrAttended?: { verified?: number };
  footprint?: { verified?: boolean };
  sponsor?: boolean;
  speakers?: { accepted?: number; submitted?: number };
}

function addEvent(fixture: EventFixture = {}): string {
  const eventId = fixture.eventId ?? 'event-one';
  const daysFromToday = fixture.daysFromToday ?? (fixture.isPast ? -10 : 10);
  const date = dayOffset(daysFromToday);
  insert('ORG_EVENTS', {
    ACCOUNT_ID: fixture.account ?? ACCOUNT,
    FAMILY_ACCOUNT_ID: ACCOUNT,
    EVENT_ID: eventId,
    EVENT_NAME: fixture.name ?? 'Community Summit',
    FOUNDATION_ID: fixture.foundationId ?? 'foundation-one',
    FOUNDATION_NAME: fixture.foundationName ?? 'Foundation One',
    EVENT_START_DATE: date,
    EVENT_END_DATE: date,
    EVENT_DATE: date,
    IS_PAST_EVENT: daysFromToday < 0 ? 1 : 0,
    EVENT_LOCATION: 'Austin Convention Center',
    EVENT_CITY: 'Austin',
    EVENT_COUNTRY: 'USA',
    EVENT_URL: 'https://events.example.test/summit',
    EVENT_REGISTRATION_URL: 'https://events.example.test/register',
    EVENT_REGISTRATIONS_GOAL: 10000,
    ORG_SPEAKER_ACCEPTED_COUNT: fixture.speakers?.accepted ?? 0,
    ORG_SPEAKER_SUBMITTED_COUNT: fixture.speakers?.submitted ?? 0,
    IS_ORG_SPONSOR: fixture.sponsor ? 1 : 0,
    REGISTERED_COUNT_VERIFIED: fixture.registered?.verified ?? 0,
    ATTENDED_COUNT_VERIFIED: fixture.attended?.verified ?? 0,
    ALL_COUNT_VERIFIED: fixture.registeredOrAttended?.verified ?? Math.max(fixture.registered?.verified ?? 0, fixture.attended?.verified ?? 0),
    HAS_FOOTPRINT_VERIFIED: fixture.footprint?.verified === false ? 0 : 1,
  });
  return eventId;
}

interface ParticipantFixture {
  ref: number;
  eventId?: string;
  name?: string | null;
  title?: string | null;
  companyEmail?: boolean;
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
  /** The legacy `IS_LISTABLE` flag dbt keeps for the previous release; the drawer must ignore it. */
  listable?: boolean;
  account?: string;
  crossRef?: number;
}

/** The three row-level conjunction flags dbt computes for Employee match: (registered | attended | registered or attended). */
function countsFlags(fixture: { companyEmail?: boolean; roster?: boolean; registered?: boolean; attended?: boolean }): Record<string, number> {
  const registered = fixture.registered !== false;
  const attended = fixture.attended === true;
  const verified = fixture.companyEmail !== false || fixture.roster === true;
  const credited = { VERIFIED: verified };
  return Object.fromEntries(
    Object.entries(credited).flatMap(([suffix, flag]) => [
      [`IS_COUNTED_REGISTERED_${suffix}`, registered && flag ? 1 : 0],
      [`IS_COUNTED_ATTENDED_${suffix}`, attended && flag ? 1 : 0],
      [`IS_COUNTED_ALL_${suffix}`, (registered || attended) && flag ? 1 : 0],
    ])
  );
}

function addParticipant(fixture: ParticipantFixture): void {
  insert('ORG_EVENT_PARTICIPATION', {
    ACCOUNT_ID: fixture.account ?? ACCOUNT,
    FAMILY_ACCOUNT_ID: ACCOUNT,
    EVENT_ID: fixture.eventId ?? 'event-one',
    PARTICIPANT_REF: fixture.ref,
    CROSS_ACCOUNT_PARTICIPANT_REF: fixture.crossRef ?? fixture.ref,
    DISPLAY_NAME: fixture.name === undefined ? `Person ${fixture.ref}` : fixture.name,
    JOB_TITLE: fixture.title === undefined ? 'Engineer' : fixture.title,
    ...countsFlags(fixture),
    IS_LISTABLE: fixture.listable === false ? 0 : 1,
  });
}

function addSpeaker(
  speakerId: string,
  first: string | null,
  last: string | null,
  status: 'Accepted' | 'Submitted',
  eventId = 'event-one',
  account = ACCOUNT
): void {
  const name = [first, last].filter(Boolean).join(' ') || null;
  // The warehouse's speaker grain: one row per organization, event and speaker; titles only for roster-linked speakers.
  database
    .prepare(
      `INSERT INTO ORG_EVENT_SPEAKERS VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (ACCOUNT_ID, EVENT_ID, SPEAKER_REF) DO UPDATE SET IS_SPEAKER_ACCEPTED = MAX(IS_SPEAKER_ACCEPTED, excluded.IS_SPEAKER_ACCEPTED)`
    )
    .run(account, ACCOUNT, eventId, speakerRef(speakerId), status === 'Accepted' ? 1 : 0, name?.includes('@') ? null : name);
}

const speakerRefs = new Map<string, number>();

function speakerRef(speakerId: string): number {
  if (!speakerRefs.has(speakerId)) speakerRefs.set(speakerId, 1048576 + speakerRefs.size);
  return speakerRefs.get(speakerId) ?? 0;
}

let database: SqlDatabase;
let service: OrgLensEventsService;

beforeEach(() => {
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  cacheValues.clear();
  ValkeyService.resetInstance();
  database = new DatabaseSync(':memory:');
  database.exec(
    `CREATE TABLE ORG_EVENTS (
      ACCOUNT_ID TEXT, FAMILY_ACCOUNT_ID TEXT, EVENT_ID TEXT, EVENT_NAME TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT,
      EVENT_START_DATE TEXT, EVENT_END_DATE TEXT, EVENT_DATE TEXT, IS_PAST_EVENT INTEGER,
      EVENT_LOCATION TEXT, EVENT_CITY TEXT, EVENT_COUNTRY TEXT, EVENT_URL TEXT, EVENT_REGISTRATION_URL TEXT,
      EVENT_REGISTRATIONS_GOAL INTEGER, ORG_SPEAKER_ACCEPTED_COUNT INTEGER, ORG_SPEAKER_SUBMITTED_COUNT INTEGER, IS_ORG_SPONSOR INTEGER,
      REGISTERED_COUNT_VERIFIED INTEGER, ATTENDED_COUNT_VERIFIED INTEGER, ALL_COUNT_VERIFIED INTEGER, HAS_FOOTPRINT_VERIFIED INTEGER
    )`
  );
  database.exec(
    `CREATE TABLE ORG_EVENT_PARTICIPATION (
      ACCOUNT_ID TEXT, FAMILY_ACCOUNT_ID TEXT, EVENT_ID TEXT, PARTICIPANT_REF INTEGER, CROSS_ACCOUNT_PARTICIPANT_REF INTEGER, DISPLAY_NAME TEXT, JOB_TITLE TEXT,
      IS_COUNTED_REGISTERED_VERIFIED INTEGER, IS_COUNTED_ATTENDED_VERIFIED INTEGER, IS_COUNTED_ALL_VERIFIED INTEGER,
      IS_LISTABLE INTEGER
    )`
  );
  database.exec(
    `CREATE TABLE ORG_EVENT_SPEAKERS (
      ACCOUNT_ID TEXT, FAMILY_ACCOUNT_ID TEXT, EVENT_ID TEXT, SPEAKER_REF INTEGER, IS_SPEAKER_ACCEPTED INTEGER, DISPLAY_NAME TEXT, JOB_TITLE TEXT,
      PRIMARY KEY (ACCOUNT_ID, EVENT_ID, SPEAKER_REF)
    )`
  );

  // Run the service's real SQL against SQLite rather than asserting on query strings; only the dialect is translated.
  execute.mockImplementation(async (query: string, binds: string[]) => {
    const translated = query
      .replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')
      .replaceAll(/DATEADD\(day, -(\d+), CURRENT_DATE\(\)\)/g, "date('now', '-$1 day')")
      .replaceAll('CURRENT_DATE()', "date('now')")
      .replaceAll('ILIKE', 'LIKE');
    // SQLite has no BOOLEAN: hand the service true/false for the flag columns, as Snowflake does.
    const rows = database
      .prepare(translated)
      .all(...binds)
      .map((row) =>
        Object.fromEntries(Object.entries(row).map(([column, value]) => [column, /^(HAS|IS)_/.test(column) && typeof value === 'number' ? value === 1 : value]))
      );
    return { rows };
  });

  checkLFStaff.mockResolvedValue(false);
  service = new OrgLensEventsService();
});

afterEach(() => {
  database.close();
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('OrgLensEventsService list — option columns', () => {
  beforeEach(() => {
    addEvent({
      registered: { verified: 3 },
      attended: { verified: 1 },
      registeredOrAttended: { verified: 4 },
      isPast: true,
    });
  });

  it.each([
    ['registered', 3],
    ['attended', 1],
    ['all', 4],
  ] as const)('serves the %s count on the Past tab', async (participation, expected) => {
    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, participation }));

    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([expected]);
  });

  it('keeps one bind per placeholder in every query it builds', async () => {
    await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, foundation: 'foundation-one', searchQuery: 'summit', status: 'registered' }));
    await service.getOrgEventsSummary(REQ, ACCOUNT, {
      participation: 'registered',
      scope: 'all',
      foundation: 'foundation-one',
      range: '90d',
    });
    await service.getOrgEventFoundations(REQ, ACCOUNT, { scope: 'activity' });
    await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { participation: 'registered', searchQuery: 'ada' });
    await service.getEventSpeakers(REQ, ACCOUNT, 'event-one', 'ada');

    for (const [sql, binds] of execute.mock.calls as [string, string[]][]) {
      expect(sql.match(/\?/g)?.length ?? 0).toBe(binds.length);
    }
  });
});

describe('OrgLensEventsService list — upcoming and past', () => {
  it('counts registrations on the Upcoming tab whatever participation is picked', async () => {
    addEvent({ registered: { verified: 4 }, attended: { verified: 0 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, participation: 'attended' }));

    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([4]);
  });

  it('counts registrations on the Upcoming tab when Count is All', async () => {
    addEvent({ registered: { verified: 4 }, registeredOrAttended: { verified: 7 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, participation: 'all' }));

    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([4]);
  });

  it('ignores the range on the Upcoming tab', async () => {
    addEvent({ eventId: 'far-future', daysFromToday: 900, registered: { verified: 1 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, range: '30d' }));

    expect(list.data.map((event) => event.eventId)).toEqual(['far-future']);
  });

  it('windows the Past tab by the range and leaves all time open', async () => {
    addEvent({ eventId: 'recent', daysFromToday: -10, registered: { verified: 1 } });
    addEvent({ eventId: 'old', daysFromToday: -200, registered: { verified: 1 } });
    addEvent({ eventId: 'ancient', daysFromToday: -900, registered: { verified: 1 } });

    const past = (range: GetOrgEventsOptions['range']): Promise<string[]> =>
      service
        .getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, range, sortField: 'EVENT_NAME' }))
        .then((response) => response.data.map((event) => event.eventId).sort());

    expect(await past('30d')).toEqual(['recent']);
    expect(await past('365d')).toEqual(['old', 'recent']);
    expect(await past('730d')).toEqual(['old', 'recent']);
    expect(await past('all')).toEqual(['ancient', 'old', 'recent']);
  });

  it('lists only events with activity by default, and the involvement-only rows under eventScope=all', async () => {
    addEvent({ eventId: 'mine', registered: { verified: 2 } });
    addEvent({ eventId: 'others', footprint: { verified: false } });

    const activity = await service.getOrgEvents(REQ, ACCOUNT, listOptions());
    const all = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ eventScope: 'all', sortField: 'EVENT_NAME' }));

    expect(activity.data.map((event) => event.eventId)).toEqual(['mine']);
    expect(all.data.map((event) => event.eventId)).toEqual(['mine', 'others']);
  });

  it('pages in a stable order when events share the sort value, so no event repeats or vanishes between pages', async () => {
    for (const eventId of ['event-b', 'event-c', 'event-a']) addEvent({ eventId, daysFromToday: 10 });

    const pages: string[] = [];
    for (const offset of [0, 1, 2]) {
      const page = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ pageSize: 1, offset, sortField: 'EVENT_START_DATE' }));
      pages.push(...page.data.map((event) => event.eventId));
    }

    expect(pages).toEqual(['event-a', 'event-b', 'event-c']);
  });
  it('narrows to a foundation', async () => {
    addEvent({ eventId: 'one', foundationId: 'foundation-one' });
    addEvent({ eventId: 'two', foundationId: 'foundation-two', foundationName: 'Foundation Two' });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ foundation: 'foundation-two' }));

    expect(list.data.map((event) => event.eventId)).toEqual(['two']);
  });

  it('keeps status=registered on registrations whatever Count shows, so an event with no attendance is not hidden', async () => {
    addEvent({ eventId: 'registered-only', isPast: true, registered: { verified: 2 }, attended: { verified: 0 } });

    const attendedView = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, status: 'registered', participation: 'attended' }));

    expect(attendedView.data.map((event) => event.eventId)).toEqual(['registered-only']);
  });

  it('keeps status=registered on registrations when Count is All', async () => {
    addEvent({ eventId: 'attended-only', isPast: true, registered: { verified: 0 }, registeredOrAttended: { verified: 2 } });

    const allView = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, status: 'registered', participation: 'all' }));

    expect(allView.data).toEqual([]);
  });

  it("never reads another account's events", async () => {
    addEvent({ account: OTHER_ACCOUNT, registered: { verified: 9 } });

    expect((await service.getOrgEvents(REQ, ACCOUNT, listOptions())).data).toEqual([]);
  });
});

describe('OrgLensEventsService summary tiles', () => {
  const filters = { participation: 'registered', scope: 'activity', foundation: '', range: '730d' } as const;

  beforeEach(() => {
    addEvent({ eventId: 'upcoming', daysFromToday: 20 });
    addEvent({ eventId: 'recent', daysFromToday: -10 });
    addEvent({ eventId: 'old', daysFromToday: -200 });
    addEvent({
      eventId: 'involvement-only',
      daysFromToday: -5,
      footprint: { verified: false },
      foundationId: 'foundation-two',
      foundationName: 'Foundation Two',
    });
  });

  it('counts Past inside the range, Upcoming regardless of it, and Total as their sum', async () => {
    expect(await service.getOrgEventsSummary(REQ, ACCOUNT, { ...filters, range: '30d' })).toMatchObject({ pastEvents: 1, upcomingEvents: 1, totalEvents: 2 });
    expect(await service.getOrgEventsSummary(REQ, ACCOUNT, filters)).toMatchObject({ pastEvents: 2, upcomingEvents: 1, totalEvents: 3 });
  });

  it('follows scope and foundation', async () => {
    expect(await service.getOrgEventsSummary(REQ, ACCOUNT, { ...filters, scope: 'all' })).toMatchObject({ pastEvents: 3, upcomingEvents: 1, totalEvents: 4 });
    expect(await service.getOrgEventsSummary(REQ, ACCOUNT, { ...filters, scope: 'all', foundation: 'foundation-two' })).toMatchObject({
      pastEvents: 1,
      upcomingEvents: 0,
    });
  });

  it('rejects, rather than returning zero counts, when the read fails', async () => {
    execute.mockRejectedValueOnce(new Error('warehouse down'));

    await expect(service.getOrgEventsSummary(REQ, 'acct-failing', filters)).rejects.toThrow('warehouse down');
  });
});

describe('OrgLensEventsService foundations', () => {
  it('lists the foundations that have events under the picked scope', async () => {
    addEvent({ eventId: 'mine', foundationId: 'foundation-one', foundationName: 'Foundation One' });
    addEvent({ eventId: 'others', foundationId: 'foundation-two', foundationName: 'Foundation Two', footprint: { verified: false } });

    const activity = await service.getOrgEventFoundations(REQ, ACCOUNT, { scope: 'activity' });
    const all = await service.getOrgEventFoundations(REQ, ACCOUNT, { scope: 'all' });

    expect(activity.data).toEqual([{ id: 'foundation-one', name: 'Foundation One' }]);
    expect(all.data).toEqual([
      { id: 'foundation-one', name: 'Foundation One' },
      { id: 'foundation-two', name: 'Foundation Two' },
    ]);
  });

  it('lists one option per foundation when the name is stored padded or blank on some rows', async () => {
    addEvent({ eventId: 'plain', foundationId: 'foundation-one', foundationName: 'Foundation One' });
    addEvent({ eventId: 'padded', foundationId: 'foundation-one', foundationName: ' \tFoundation One\u00A0\n' });
    addEvent({ eventId: 'blank', foundationId: 'foundation-blank', foundationName: ' \t\u00A0\n' });

    const { data } = await service.getOrgEventFoundations(REQ, ACCOUNT, { scope: 'all' });

    expect(data).toEqual([{ id: 'foundation-one', name: 'Foundation One' }]);
  });
});

describe('OrgLensEventsService attendees drawer', () => {
  const options = { participation: 'registered' } as const;

  beforeEach(() => {
    addEvent({ isPast: true, registered: { verified: 4 }, attended: { verified: 2 } });
  });

  it('lists everyone the option credits, whatever the legacy listable flag says, by name; titles only for roster employees (lfx-self-serve#5158)', async () => {
    // The warehouse leaves JOB_TITLE NULL for everyone not on the roster; the fixtures mirror that.
    addParticipant({ ref: 1, name: 'Ada Lovelace', title: null });
    addParticipant({ ref: 2, name: 'Grace Hopper', title: null });
    addParticipant({ ref: 4, name: 'Roster Employee', companyEmail: false, roster: true, listable: false });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);

    expect(drawer.data.map((attendee) => [attendee.name, attendee.jobTitle])).toEqual([
      ['Ada Lovelace', null],
      ['Grace Hopper', null],
      ['Roster Employee', 'Engineer'],
    ]);
    expect(drawer.total).toBe(3);
    expect(drawer).not.toHaveProperty('notListedCount');
    expect(drawer.eventName).toBe('Community Summit');
  });

  it('separates registered from attended, and rejected registrations never count', async () => {
    addParticipant({ ref: 1, name: 'Attended', attended: true });
    addParticipant({ ref: 2, name: 'Registered Only' });
    addParticipant({ ref: 3, name: 'Rejected', registered: false });

    const registered = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);
    const attended = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, participation: 'attended' });

    expect(registered.data.map((attendee) => attendee.name).sort()).toEqual(['Attended', 'Registered Only']);
    expect(attended.data.map((attendee) => attendee.name)).toEqual(['Attended']);
  });

  it('lists everyone who registered or attended when Count is All', async () => {
    addParticipant({ ref: 1, name: 'Attended', attended: true });
    addParticipant({ ref: 2, name: 'Registered Only' });
    addParticipant({ ref: 3, name: 'Attended Unregistered', registered: false, attended: true });
    addParticipant({ ref: 4, name: 'Rejected', registered: false });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, participation: 'all' });

    expect(drawer.data.map((attendee) => attendee.name).sort()).toEqual(['Attended', 'Attended Unregistered', 'Registered Only']);
    expect(drawer.total).toBe(3);
  });

  it('lists registrants for an event that has not ended, whatever participation is picked', async () => {
    addEvent({ eventId: 'future', registered: { verified: 2 }, attended: { verified: 0 } });
    addParticipant({ ref: 1, eventId: 'future', name: 'Ada Lovelace' });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'future', { ...options, participation: 'attended' });

    expect(drawer.data.map((attendee) => attendee.name)).toEqual(['Ada Lovelace']);
  });

  it('labels a person with no name neutrally and returns no address in any field', async () => {
    addParticipant({ ref: 1, name: null });
    addParticipant({ ref: 2, name: 'ada@company.test', title: 'ada@company.test' });
    addParticipant({ ref: 3, name: 'Grace Hopper', title: 'Admiral' });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);

    expect(drawer.data.map((attendee) => attendee.name).sort()).toEqual(['Grace Hopper', 'Registered attendee', 'Registered attendee']);
    expect(JSON.stringify(drawer)).not.toContain('@');
    expect(new Set(drawer.data.map((attendee) => attendee.contactId)).size).toBe(drawer.data.length);
  });

  it('searches names only', async () => {
    addParticipant({ ref: 1, name: 'Ada Lovelace' });
    addParticipant({ ref: 2, name: 'Grace Hopper' });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, searchQuery: 'hopper' });

    expect(drawer.data.map((attendee) => attendee.name)).toEqual(['Grace Hopper']);
  });

  it('narrows only what is shown with a name search, never what is cached', async () => {
    addParticipant({ ref: 1, name: 'Ada Lovelace' });
    addParticipant({ ref: 2, name: 'Grace Hopper' });

    const searched = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, searchQuery: 'hopper' });
    const unsearched = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);
    const noMatch = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, searchQuery: 'nobody' });

    expect(searched.data.map((attendee) => attendee.name)).toEqual(['Grace Hopper']);
    expect(unsearched.data.map((attendee) => attendee.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(noMatch.data).toEqual([]);
  });

  it('rejects, rather than returning zero counts, when the read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(service.getEventAttendees(REQ, 'acct-failing', 'event-one', options)).rejects.toThrow('warehouse down');
  });
});

describe('OrgLensEventsService speakers drawer', () => {
  beforeEach(() => {
    addEvent({ isPast: true });
  });

  it('returns a neutral label rather than an address and never searches by address', async () => {
    addSpeaker('speaker-1', 'Ada', 'Lovelace', 'Accepted');
    addSpeaker('speaker-2', null, null, 'Submitted');
    addSpeaker('speaker-3', 'grace@company.test', '', 'Submitted');

    const drawer = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one');
    const byAddress = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one', 'nameless@');
    const byName = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one', 'lovelace');

    expect(drawer.data.map((speaker) => speaker.name).sort()).toEqual(['Ada Lovelace', 'Speaker', 'Speaker']);
    expect(drawer.acceptedCount).toBe(1);
    expect(drawer.submittedCount).toBe(3);
    expect(JSON.stringify(drawer)).not.toContain('@');
    expect(byAddress.data).toEqual([]);
    expect(byName.data.map((speaker) => speaker.name)).toEqual(['Ada Lovelace']);
  });
});

describe('OrgLensEventsService staff-only goal', () => {
  beforeEach(() => {
    addEvent({ registered: { verified: 3 } });
  });

  it('never serves the event registration goal to an external admin', async () => {
    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions());

    // #4432 is about disclosure, not display: the key must be ABSENT, not present-and-null. The
    // serialized check also catches the number reappearing under some other field name.
    expect(list.data[0]).not.toHaveProperty('eventRegistrationsGoal');
    expect(JSON.stringify(list)).not.toContain('10000');
  });

  it('serves the goal to LF staff', async () => {
    checkLFStaff.mockResolvedValue(true);

    expect((await service.getOrgEvents(REQ, ACCOUNT, listOptions())).data[0].eventRegistrationsGoal).toBe(10000);
  });

  it('withholds the goal while an LF staff member is impersonating, whoever the target is', async () => {
    checkLFStaff.mockResolvedValue(true);
    const impersonating = { impersonationActive: true } as unknown as Request;

    const list = await service.getOrgEvents(impersonating, ACCOUNT, listOptions());

    expect(list.data[0]).not.toHaveProperty('eventRegistrationsGoal');
    expect(JSON.stringify(list)).not.toContain('10000');
  });

  it('does not leak a staff-populated cache entry to an external admin', async () => {
    // The Org Lens cache is keyed per ORG, not per user, so a staff read and an external read share one entry.
    // Redaction therefore has to happen AFTER the cache, on every response path.
    checkLFStaff.mockResolvedValue(true);
    expect((await service.getOrgEvents(REQ, ACCOUNT, listOptions())).data[0].eventRegistrationsGoal).toBe(10000);

    const fetchesBefore = execute.mock.calls.length;
    checkLFStaff.mockResolvedValue(false);
    const external = await service.getOrgEvents(REQ, ACCOUNT, listOptions());

    // The external read must be served from the entry the STAFF read wrote.
    expect(execute.mock.calls).toHaveLength(fetchesBefore);
    expect(external.data[0]).not.toHaveProperty('eventRegistrationsGoal');
    expect(JSON.stringify(external)).not.toContain('10000');
  });
});

describe('OrgLensEventsService caching', () => {
  beforeEach(() => {
    addEvent({ isPast: true, registered: { verified: 1 } });
  });

  it('serves a repeated identical read from the cache', async () => {
    const first = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }));
    const fetchesAfterFirst = execute.mock.calls.length;
    const second = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }));

    expect(execute.mock.calls).toHaveLength(fetchesAfterFirst);
    expect(second).toEqual(first);
  });

  it.each([
    ['participation', { participation: 'attended' }],
    ['eventScope', { eventScope: 'all' }],
    ['foundation', { foundation: 'foundation-one' }],
    ['range', { range: '30d' }],
  ] as const)('does not serve a different %s from the same entry', async (_filter, change) => {
    await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }));
    const fetchesAfterFirst = execute.mock.calls.length;

    await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, ...change }));

    expect(execute.mock.calls.length).toBeGreaterThan(fetchesAfterFirst);
  });

  it('shares one entry across ranges on the Upcoming tab, which ignores the range', async () => {
    await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, range: '30d' }));
    const fetchesAfterFirst = execute.mock.calls.length;

    await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, range: 'all' }));

    expect(execute.mock.calls).toHaveLength(fetchesAfterFirst);
  });
});

describe('OrgLensEventsService outage', () => {
  it('rejects, rather than returning an empty list, when the list read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(service.getOrgEvents(REQ, 'acct-failing', listOptions())).rejects.toThrow('warehouse down');
  });

  it('rejects, rather than returning no foundations, when the foundations read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(service.getOrgEventFoundations(REQ, 'acct-failing', { scope: 'activity' })).rejects.toThrow('warehouse down');
  });

  it('rejects, rather than returning no speakers, when the speakers read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(service.getEventSpeakers(REQ, 'acct-failing', 'event-one')).rejects.toThrow('warehouse down');
  });
});

describe('OrgLensEventsService family roll-up', () => {
  const PARENT_CO = { accountId: ACCOUNT, name: 'Parent Co' };
  const SUBSIDIARY_CO = { accountId: OTHER_ACCOUNT, name: 'Subsidiary Co' };
  const FILTERS = { participation: 'all', scope: 'activity', foundation: '', range: '730d' } as const;

  function rollUp(overrides: Partial<OrgLensRollUpScope> = {}): OrgLensRollUpScope {
    return {
      rollUpKey: 'family-acct-a',
      rootUid: ACCOUNT,
      members: [SUBSIDIARY_CO, PARENT_CO].map((organization) => ({ uid: organization.accountId, ...organization, logoUrl: null })),
      complete: true,
      excludedCount: 0,
      ...overrides,
    };
  }

  function family(company?: string): ReturnType<OrgLensEventsService['familyScope']> {
    return service.familyScope(rollUp(), company);
  }

  it('lists one row per (event, company), ordered by company within an event, while the tiles count each event once', async () => {
    addEvent({ eventId: 'shared', isPast: true, account: ACCOUNT });
    addEvent({ eventId: 'shared', isPast: true, account: OTHER_ACCOUNT });
    addEvent({ eventId: 'own', isPast: true, account: OTHER_ACCOUNT });

    const summary = await service.getFamilyOrgEventsSummary(REQ, family(), FILTERS);
    const list = await service.getFamilyOrgEvents(REQ, family(), listOptions({ isPast: true }));

    expect(summary).toMatchObject({ pastEvents: 2, upcomingEvents: 0, totalEvents: 2 });
    expect(list.total).toBe(3);
    expect(list.data.map((event) => [event.eventId, event.organization])).toEqual([
      ['own', SUBSIDIARY_CO],
      ['shared', PARENT_CO],
      ['shared', SUBSIDIARY_CO],
    ]);
  });

  it("pages the (event, company) rows without repeating or dropping a company's row", async () => {
    addEvent({ eventId: 'shared', isPast: true, account: ACCOUNT });
    addEvent({ eventId: 'shared', isPast: true, account: OTHER_ACCOUNT });

    const first = await service.getFamilyOrgEvents(REQ, family(), listOptions({ isPast: true, pageSize: 1, offset: 0 }));
    const second = await service.getFamilyOrgEvents(REQ, family(), listOptions({ isPast: true, pageSize: 1, offset: 1 }));

    expect([first.total, second.total]).toEqual([2, 2]);
    expect([...first.data, ...second.data].map((event) => event.organization)).toEqual([PARENT_CO, SUBSIDIARY_CO]);
  });

  it("shows each company's own attendee count on its row, and a drawer scoped to that company lists only its people", async () => {
    addEvent({ eventId: 'shared', isPast: true, account: ACCOUNT, registered: { verified: 1 } });
    addEvent({ eventId: 'shared', isPast: true, account: OTHER_ACCOUNT, registered: { verified: 2 } });
    addParticipant({ ref: 1, eventId: 'shared', account: ACCOUNT, crossRef: 77, name: 'Ada Parent', title: null });
    addParticipant({ ref: 9, eventId: 'shared', account: OTHER_ACCOUNT, crossRef: 77, name: 'Ada Subsidiary', title: 'Architect' });
    addParticipant({ ref: 2, eventId: 'shared', account: OTHER_ACCOUNT, name: 'Bea Subsidiary' });

    const list = await service.getFamilyOrgEvents(REQ, family(), listOptions({ isPast: true, participation: 'registered' }));
    const scoped = await service.getFamilyEventAttendees(REQ, family(OTHER_ACCOUNT), 'shared', { participation: 'registered' });
    const unscoped = await service.getFamilyEventAttendees(REQ, family(), 'shared', { participation: 'registered' });

    expect(list.data.map((event) => [event.organization, event.orgAttendeeCount])).toEqual([
      [PARENT_CO, 1],
      [SUBSIDIARY_CO, 2],
    ]);
    expect(scoped.data).toEqual([
      { contactId: '0', name: 'Ada Subsidiary', jobTitle: 'Architect', organizations: [SUBSIDIARY_CO] },
      { contactId: '1', name: 'Bea Subsidiary', jobTitle: 'Engineer', organizations: [SUBSIDIARY_CO] },
    ]);
    expect(unscoped.total).toBe(2);
    expect(unscoped.data[0]).toEqual({ contactId: '0', name: 'Ada Parent', jobTitle: 'Architect', organizations: [PARENT_CO, SUBSIDIARY_CO] });
  });

  it("serves exactly one organization's own figures for a family of one", async () => {
    addEvent({ isPast: true, registered: { verified: 2 }, speakers: { accepted: 1, submitted: 2 } });
    addParticipant({ ref: 1 });
    addParticipant({ ref: 2 });
    addSpeaker('spk-1', 'Grace', 'Hopper', 'Accepted');
    addSpeaker('spk-2', 'Alan', 'Turing', 'Submitted');
    const one = service.familyScope(rollUp({ members: [{ uid: ACCOUNT, ...PARENT_CO, logoUrl: null }] }));
    const options = listOptions({ isPast: true, participation: 'registered' });

    const [single, rolled] = [await service.getOrgEvents(REQ, ACCOUNT, options), await service.getFamilyOrgEvents(REQ, one, options)];
    const [singleSummary, rolledSummary] = [
      await service.getOrgEventsSummary(REQ, ACCOUNT, FILTERS),
      await service.getFamilyOrgEventsSummary(REQ, one, FILTERS),
    ];
    const singleSpeakers = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one');
    const rolledSpeakers = await service.getFamilyEventSpeakers(REQ, one, 'event-one');
    const singleAttendees = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { participation: 'registered' });
    const rolledAttendees = await service.getFamilyEventAttendees(REQ, one, 'event-one', { participation: 'registered' });

    expect(rolled.data).toEqual(single.data.map((event) => ({ ...event, organization: PARENT_CO })));
    expect(rolled.total).toBe(single.total);
    expect(rolledSummary).toMatchObject(singleSummary);
    expect([rolledSpeakers.acceptedCount, rolledSpeakers.submittedCount]).toEqual([singleSpeakers.acceptedCount, singleSpeakers.submittedCount]);
    expect(rolledAttendees.total).toBe(singleAttendees.total);
  });

  it("shows each company's own Event Sponsor flag, and the Event Sponsor status keeps only the sponsoring company's row", async () => {
    addEvent({ eventId: 'shared', account: ACCOUNT });
    addEvent({ eventId: 'shared', account: OTHER_ACCOUNT, sponsor: true });
    addEvent({ eventId: 'own', account: ACCOUNT });

    const all = await service.getFamilyOrgEvents(REQ, family(), listOptions());
    const sponsored = await service.getFamilyOrgEvents(REQ, family(), listOptions({ status: 'event-sponsor' }));

    expect(all.data.map((event) => [event.eventId, event.organization, event.isOrgSponsor])).toEqual([
      ['own', PARENT_CO, false],
      ['shared', PARENT_CO, false],
      ['shared', SUBSIDIARY_CO, true],
    ]);
    expect(sponsored.data.map((event) => [event.eventId, event.organization])).toEqual([['shared', SUBSIDIARY_CO]]);
    expect(sponsored.total).toBe(1);
  });

  it.each([
    ['registered', { registered: { verified: 1 } }],
    ['speaker-submitted', { speakers: { submitted: 1 } }],
    ['speaker-accepted', { speakers: { accepted: 1, submitted: 1 } }],
  ] as const)('keeps only the rows of companies that match the %s status', async (status, matching) => {
    addEvent({ eventId: 'shared', account: ACCOUNT });
    addEvent({ eventId: 'shared', account: OTHER_ACCOUNT, ...matching });
    addEvent({ eventId: 'own', account: ACCOUNT });

    const list = await service.getFamilyOrgEvents(REQ, family(), listOptions({ status }));

    expect(list.data.map((event) => [event.eventId, event.organization])).toEqual([['shared', SUBSIDIARY_CO]]);
  });

  it("lists each company's row of every foundation event under All foundation events", async () => {
    addEvent({ eventId: 'foundation-only', account: ACCOUNT, footprint: { verified: false } });
    addEvent({ eventId: 'foundation-only', account: OTHER_ACCOUNT, footprint: { verified: false } });
    addEvent({ eventId: 'active', account: OTHER_ACCOUNT });

    const everything = await service.getFamilyOrgEvents(REQ, family(), listOptions({ eventScope: 'all' }));
    const activity = await service.getFamilyOrgEvents(REQ, family(), listOptions({ eventScope: 'activity' }));
    const summary = await service.getFamilyOrgEventsSummary(REQ, family(), { ...FILTERS, scope: 'all' });

    expect(everything.data.map((event) => [event.eventId, event.organization])).toEqual([
      ['active', SUBSIDIARY_CO],
      ['foundation-only', PARENT_CO],
      ['foundation-only', SUBSIDIARY_CO],
    ]);
    expect([summary.upcomingEvents, everything.total]).toEqual([2, 3]);
    expect(activity.data.map((event) => [event.eventId, event.organization])).toEqual([['active', SUBSIDIARY_CO]]);
  });

  it('narrows every figure to the Company filter, keeping every organization as an option', async () => {
    addEvent({ eventId: 'shared', isPast: true, account: ACCOUNT });
    addEvent({ eventId: 'shared', isPast: true, account: OTHER_ACCOUNT });
    addEvent({ eventId: 'own', isPast: true, account: OTHER_ACCOUNT });

    const summary = await service.getFamilyOrgEventsSummary(REQ, family(ACCOUNT), FILTERS);
    const list = await service.getFamilyOrgEvents(REQ, family(ACCOUNT), listOptions({ isPast: true }));

    expect(summary).toMatchObject({ pastEvents: 1, organizations: [PARENT_CO, SUBSIDIARY_CO] });
    expect(list.data.map((event) => [event.eventId, event.organization])).toEqual([['shared', PARENT_CO]]);
  });

  it('offers every foundation of the roll-up, whatever the Company filter', async () => {
    addEvent({ eventId: 'parent-event', account: ACCOUNT });
    addEvent({ eventId: 'subsidiary-event', account: OTHER_ACCOUNT, foundationId: 'foundation-two', foundationName: 'Foundation Two' });

    const foundations = await service.getFamilyOrgEventFoundations(REQ, family(ACCOUNT), { scope: 'activity' });

    expect(foundations.data.map((foundation) => foundation.id)).toEqual(['foundation-one', 'foundation-two']);
  });

  it('lists a speaker once, accepted when any proposal was, with each organization they are credited through', async () => {
    addEvent({ eventId: 'shared', account: ACCOUNT, speakers: { submitted: 1 } });
    addEvent({ eventId: 'shared', account: OTHER_ACCOUNT, speakers: { accepted: 1, submitted: 2 } });
    addSpeaker('spk-1', 'Grace', 'Hopper', 'Submitted', 'shared', ACCOUNT);
    addSpeaker('spk-1', 'Grace', 'Hopper', 'Accepted', 'shared', OTHER_ACCOUNT);
    addSpeaker('spk-2', 'Alan', 'Turing', 'Submitted', 'shared', OTHER_ACCOUNT);

    const drawer = await service.getFamilyEventSpeakers(REQ, family(), 'shared');
    const list = await service.getFamilyOrgEvents(REQ, family(), listOptions());

    expect(drawer).toMatchObject({ acceptedCount: 1, submittedCount: 2 });
    expect(drawer.data.map((speaker) => [speaker.name, speaker.status, speaker.organizations])).toEqual([
      ['Alan Turing', 'SUBMITTED', [SUBSIDIARY_CO]],
      ['Grace Hopper', 'ACCEPTED', [PARENT_CO, SUBSIDIARY_CO]],
    ]);
    expect(list.data.map((event) => [event.organization, event.orgSpeakerAcceptedCount, event.orgSpeakerSubmittedCount])).toEqual([
      [PARENT_CO, 0, 1],
      [SUBSIDIARY_CO, 1, 2],
    ]);
  });

  it("keeps a speaker's accepted credit and every company when a name search matches only one of their rows", async () => {
    addEvent({ eventId: 'shared', account: ACCOUNT });
    addEvent({ eventId: 'shared', account: OTHER_ACCOUNT });
    addSpeaker('spk-1', 'Grace', 'Hopper', 'Submitted', 'shared', ACCOUNT);
    addSpeaker('spk-1', null, null, 'Accepted', 'shared', OTHER_ACCOUNT);
    addSpeaker('spk-2', 'Alan', 'Turing', 'Submitted', 'shared', OTHER_ACCOUNT);

    const drawer = await service.getFamilyEventSpeakers(REQ, family(), 'shared', 'hopper');

    expect(drawer).toMatchObject({ acceptedCount: 1, submittedCount: 1 });
    expect(drawer.data.map((speaker) => [speaker.name, speaker.status, speaker.organizations])).toEqual([
      ['Grace Hopper', 'ACCEPTED', [PARENT_CO, SUBSIDIARY_CO]],
    ]);
  });

  it('keeps callers who can read different organizations of one family on separate cache entries', async () => {
    addEvent({ eventId: 'shared', isPast: true, account: ACCOUNT });
    addEvent({ eventId: 'own', isPast: true, account: OTHER_ACCOUNT });
    const parentOnly = service.familyScope(rollUp({ members: [{ uid: ACCOUNT, ...PARENT_CO, logoUrl: null }] }));

    const whole = await service.getFamilyOrgEventsSummary(REQ, family(), FILTERS);
    const narrower = await service.getFamilyOrgEventsSummary(REQ, parentOnly, FILTERS);

    expect([whole.pastEvents, narrower.pastEvents]).toEqual([2, 1]);
    expect(narrower.organizations).toEqual([PARENT_CO]);
  });

  it('reports whether the roll-up covers the whole family on the summary', async () => {
    const summary = await service.getFamilyOrgEventsSummary(REQ, service.familyScope(rollUp({ complete: false, excludedCount: 2 })), FILTERS);

    expect(summary.rollUp).toEqual({ complete: false, excludedCount: 2 });
  });

  it('keeps one bind per placeholder in every family query', async () => {
    addEvent({ isPast: true, registered: { verified: 1 } });
    const filtered = listOptions({ isPast: true, foundation: 'foundation-one', searchQuery: 'summit', status: 'registered', sortField: 'EVENT_NAME' });

    await service.getFamilyOrgEvents(REQ, family(), filtered);
    await service.getFamilyOrgEventsSummary(REQ, family(), { ...FILTERS, foundation: 'foundation-one' });
    await service.getFamilyOrgEventFoundations(REQ, family(), { scope: 'activity' });
    await service.getFamilyEventAttendees(REQ, family(), 'event-one', { participation: 'registered', searchQuery: 'ada' });
    await service.getFamilyEventSpeakers(REQ, family(), 'event-one', 'ada');

    expect(execute).toHaveBeenCalledTimes(6);
    for (const [sql, binds] of execute.mock.calls as [string, string[]][]) {
      expect(sql.match(/\?/g)?.length ?? 0).toBe(binds.length);
    }
  });

  it.each([
    ['summary', (scope: ReturnType<typeof family>) => service.getFamilyOrgEventsSummary(REQ, scope, FILTERS)],
    ['list', (scope: ReturnType<typeof family>) => service.getFamilyOrgEvents(REQ, scope, listOptions())],
    ['foundations', (scope: ReturnType<typeof family>) => service.getFamilyOrgEventFoundations(REQ, scope, { scope: 'activity' })],
    ['attendees', (scope: ReturnType<typeof family>) => service.getFamilyEventAttendees(REQ, scope, 'event-one', { participation: 'all' })],
    ['speakers', (scope: ReturnType<typeof family>) => service.getFamilyEventSpeakers(REQ, scope, 'event-one')],
  ])('rejects, rather than answering with nothing, when the family %s read fails', async (_read, read) => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(read(family())).rejects.toThrow('warehouse down');
  });

  it.each([
    ['summary', (scope: ReturnType<typeof family>) => service.getFamilyOrgEventsSummary(REQ, scope, FILTERS)],
    ['list', (scope: ReturnType<typeof family>) => service.getFamilyOrgEvents(REQ, scope, listOptions())],
    ['foundations', (scope: ReturnType<typeof family>) => service.getFamilyOrgEventFoundations(REQ, scope, { scope: 'activity' })],
    ['attendees', (scope: ReturnType<typeof family>) => service.getFamilyEventAttendees(REQ, scope, 'event-one', { participation: 'all' })],
  ])('rejects the family %s read while the events table has no family column', async (_read, read) => {
    addEvent();
    database.exec('ALTER TABLE ORG_EVENTS DROP COLUMN FAMILY_ACCOUNT_ID');

    await expect(read(family())).rejects.toThrow(/FAMILY_ACCOUNT_ID/);
  });

  it('rejects both speakers drawers while the warehouse speaker table is missing', async () => {
    addEvent();
    database.exec('DROP TABLE ORG_EVENT_SPEAKERS');

    await expect(service.getEventSpeakers(REQ, ACCOUNT, 'event-one')).rejects.toThrow(/ORG_EVENT_SPEAKERS/);
    await expect(service.getFamilyEventSpeakers(REQ, family(), 'event-one')).rejects.toThrow(/ORG_EVENT_SPEAKERS/);
  });
});
