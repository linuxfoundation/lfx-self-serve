// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { GetOrgEventsOptions } from '@lfx-one/shared/interfaces';
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
}

function addEvent(fixture: EventFixture = {}): string {
  const eventId = fixture.eventId ?? 'event-one';
  const daysFromToday = fixture.daysFromToday ?? (fixture.isPast ? -10 : 10);
  const date = dayOffset(daysFromToday);
  insert('ORG_EVENTS', {
    ACCOUNT_ID: fixture.account ?? ACCOUNT,
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
    ORG_SPEAKER_ACCEPTED_COUNT: 0,
    ORG_SPEAKER_SUBMITTED_COUNT: 0,
    IS_ORG_SPONSOR: 0,
    REGISTERED_COUNT_COMPANY_EMAIL: fixture.registered?.verified ?? 0,
    ATTENDED_COUNT_COMPANY_EMAIL: fixture.attended?.verified ?? 0,
    ALL_COUNT_COMPANY_EMAIL: fixture.registeredOrAttended?.verified ?? Math.max(fixture.registered?.verified ?? 0, fixture.attended?.verified ?? 0),
    HAS_FOOTPRINT_COMPANY_EMAIL: fixture.footprint?.verified === false ? 0 : 1,
  });
  return eventId;
}

interface ParticipantFixture {
  ref: number;
  eventId?: string;
  name?: string | null;
  title?: string | null;
  /** The email on this registration (or speaker record) is a company address. A personal address never counts. Default `true`. */
  companyEmail?: boolean;
  /** An LF account on the roster no longer qualifies a registration; only the registration's own email does. */
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
  /** The person also has a speaker record at the event, in this status. */
  speaker?: 'Accepted' | 'Submitted';
  /** The legacy `IS_LISTABLE` flag dbt keeps for the previous release; the drawer must ignore it. */
  listable?: boolean;
}

/** The row-level conjunction flags dbt computes for company-email attribution: (registered | attended | registered or attended). */
function countsFlags(fixture: { companyEmail?: boolean; registered?: boolean; attended?: boolean }): Record<string, number> {
  const registered = fixture.registered !== false;
  const attended = fixture.attended === true;
  const companyEmail = fixture.companyEmail !== false;
  return {
    IS_COUNTED_REGISTERED_COMPANY_EMAIL: registered && companyEmail ? 1 : 0,
    IS_COUNTED_ATTENDED_COMPANY_EMAIL: attended && companyEmail ? 1 : 0,
    IS_COUNTED_ALL_COMPANY_EMAIL: (registered || attended) && companyEmail ? 1 : 0,
  };
}

/** The speaker flags dbt computes from the speaker record's own email: accepted and company email counts; submitted and company email lists. */
function speakerFlags(fixture: { companyEmail?: boolean; speaker?: 'Accepted' | 'Submitted' }): Record<string, number> {
  const companyEmail = fixture.companyEmail !== false;
  return {
    IS_SPK_COMPANY_EMAIL: fixture.speaker && companyEmail ? 1 : 0,
    IS_SPEAKER_SUBMITTED: fixture.speaker ? 1 : 0,
    IS_COUNTED_SPEAKER_COMPANY_EMAIL: fixture.speaker === 'Accepted' && companyEmail ? 1 : 0,
  };
}

function addParticipant(fixture: ParticipantFixture): void {
  insert('ORG_EVENT_PARTICIPATION', {
    ACCOUNT_ID: ACCOUNT,
    EVENT_ID: fixture.eventId ?? 'event-one',
    EVENT_NAME: 'Community Summit',
    PARTICIPANT_REF: fixture.ref,
    DISPLAY_NAME: fixture.name === undefined ? `Person ${fixture.ref}` : fixture.name,
    JOB_TITLE: fixture.title === undefined ? 'Engineer' : fixture.title,
    ...countsFlags(fixture.speaker && fixture.registered === undefined ? { ...fixture, registered: false } : fixture),
    ...speakerFlags(fixture),
    IS_LISTABLE: fixture.listable === false ? 0 : 1,
  });
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
      ACCOUNT_ID TEXT, EVENT_ID TEXT, EVENT_NAME TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT,
      EVENT_START_DATE TEXT, EVENT_END_DATE TEXT, EVENT_DATE TEXT, IS_PAST_EVENT INTEGER,
      EVENT_LOCATION TEXT, EVENT_CITY TEXT, EVENT_COUNTRY TEXT, EVENT_URL TEXT, EVENT_REGISTRATION_URL TEXT,
      EVENT_REGISTRATIONS_GOAL INTEGER, ORG_SPEAKER_ACCEPTED_COUNT INTEGER, ORG_SPEAKER_SUBMITTED_COUNT INTEGER, IS_ORG_SPONSOR INTEGER,
      REGISTERED_COUNT_COMPANY_EMAIL INTEGER, ATTENDED_COUNT_COMPANY_EMAIL INTEGER, ALL_COUNT_COMPANY_EMAIL INTEGER, HAS_FOOTPRINT_COMPANY_EMAIL INTEGER
    )`
  );
  database.exec(
    `CREATE TABLE ORG_EVENT_PARTICIPATION (
      ACCOUNT_ID TEXT, EVENT_ID TEXT, EVENT_NAME TEXT, PARTICIPANT_REF INTEGER, DISPLAY_NAME TEXT, JOB_TITLE TEXT,
      IS_COUNTED_REGISTERED_COMPANY_EMAIL INTEGER, IS_COUNTED_ATTENDED_COMPANY_EMAIL INTEGER, IS_COUNTED_ALL_COMPANY_EMAIL INTEGER,
      IS_COUNTED_SPEAKER_COMPANY_EMAIL INTEGER, IS_SPEAKER_SUBMITTED INTEGER, IS_SPK_COMPANY_EMAIL INTEGER,
      IS_LISTABLE INTEGER
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

  it('returns zero counts when the read fails', async () => {
    execute.mockRejectedValueOnce(new Error('warehouse down'));

    expect(await service.getOrgEventsSummary(REQ, 'acct-failing', filters)).toEqual({
      totalEvents: 0,
      pastEvents: 0,
      upcomingEvents: 0,
    });
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

  it('lists only registrations made with a company email, whatever the legacy listable flag says, by name (lfx-self-serve#5584)', async () => {
    addParticipant({ ref: 1, name: 'Ada Lovelace', title: null });
    addParticipant({ ref: 2, name: 'Grace Hopper', title: null });
    addParticipant({ ref: 4, name: 'Company Employee', listable: false });
    // Registered with a personal address: not a row, even though the person is on the roster.
    addParticipant({ ref: 5, name: 'Personal Registrant', companyEmail: false, roster: true });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);

    expect(drawer.data.map((attendee) => [attendee.name, attendee.jobTitle])).toEqual([
      ['Ada Lovelace', null],
      ['Company Employee', 'Engineer'],
      ['Grace Hopper', null],
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
    addParticipant({ ref: 1, name: 'Ada Lovelace', speaker: 'Accepted' });
    addParticipant({ ref: 2, name: null, speaker: 'Submitted' });
    // The warehouse nulls a name that holds an address.
    addParticipant({ ref: 3, name: null, speaker: 'Submitted' });

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

  it('leaves out a speaker whose own record carries a personal email, accepted or submitted (lfx-self-serve#5626)', async () => {
    addParticipant({ ref: 1, name: 'Company Speaker', speaker: 'Accepted' });
    addParticipant({ ref: 2, name: 'Company Submitter', speaker: 'Submitted' });
    addParticipant({ ref: 3, name: 'Personal Speaker', speaker: 'Accepted', companyEmail: false });
    addParticipant({ ref: 4, name: 'Personal Submitter', speaker: 'Submitted', companyEmail: false });

    const drawer = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one');

    expect(drawer.data.map((speaker) => [speaker.name, speaker.status])).toEqual([
      ['Company Speaker', 'ACCEPTED'],
      ['Company Submitter', 'SUBMITTED'],
    ]);
    expect(drawer.acceptedCount).toBe(1);
    expect(drawer.submittedCount).toBe(2);
  });

  it('lists a person who registered with a personal email and spoke with a company email as a speaker only', async () => {
    addParticipant({ ref: 1, name: 'Both Addresses', speaker: 'Accepted', registered: true, companyEmail: true });
    const speakers = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one');
    expect(speakers.data.map((speaker) => speaker.name)).toEqual(['Both Addresses']);
  });

  it('is empty, with no error, for an account whose speakers all used personal emails', async () => {
    addParticipant({ ref: 1, name: 'Personal Speaker', speaker: 'Accepted', companyEmail: false });

    const drawer = await service.getEventSpeakers(REQ, ACCOUNT, 'event-one');

    expect(drawer.data).toEqual([]);
    expect(drawer.acceptedCount).toBe(0);
  });
});

describe('OrgLensEventsService Speakers column and filter', () => {
  const list = (status?: string) => service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, status }));

  beforeEach(() => {
    addEvent({ eventId: 'company-speaker', isPast: true, name: 'Company Speaker Event' });
    addEvent({ eventId: 'personal-speaker', isPast: true, name: 'Personal Speaker Event' });
    addParticipant({ ref: 1, eventId: 'company-speaker', name: 'Ada Lovelace', speaker: 'Accepted' });
    addParticipant({ ref: 2, eventId: 'personal-speaker', name: 'Grace Hopper', speaker: 'Accepted', companyEmail: false });
  });

  it('counts only company-email speakers per event, equal to the drawer rows', async () => {
    const events = await list();
    const byId = new Map(events.data.map((event) => [event.eventId, event]));

    expect(byId.get('company-speaker')).toMatchObject({ orgSpeakerAcceptedCount: 1, orgSpeakerSubmittedCount: 1 });
    expect(byId.get('personal-speaker')).toMatchObject({ orgSpeakerAcceptedCount: 0, orgSpeakerSubmittedCount: 0 });
    const drawer = await service.getEventSpeakers(REQ, ACCOUNT, 'company-speaker');
    expect(drawer.data).toHaveLength(byId.get('company-speaker')!.orgSpeakerSubmittedCount);
  });

  it.each(['speaker-accepted', 'speaker-submitted'])('%s keeps events with a company-email speaker and never shows a 0 row', async (status) => {
    const events = await list(status);

    expect(events.data.map((event) => event.eventId)).toEqual(['company-speaker']);
    expect(events.data.every((event) => event.orgSpeakerSubmittedCount > 0)).toBe(true);
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
  it('returns an empty list when the read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    const list = await service.getOrgEvents(REQ, 'acct-failing', listOptions());

    expect(list).toEqual({ data: [], total: 0, pageSize: 25, offset: 0 });
  });
});
