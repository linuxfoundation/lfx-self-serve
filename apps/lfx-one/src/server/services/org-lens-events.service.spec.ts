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
    attribution: 'company_email',
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
  registered?: { companyEmail?: number; account?: number; all?: number };
  attended?: { companyEmail?: number; account?: number; all?: number };
  footprint?: { companyEmail?: boolean; account?: boolean; all?: boolean };
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
    REGISTERED_COUNT_COMPANY_EMAIL: fixture.registered?.companyEmail ?? 0,
    REGISTERED_COUNT_ACCOUNT: fixture.registered?.account ?? 0,
    REGISTERED_COUNT_ALL: fixture.registered?.all ?? 0,
    ATTENDED_COUNT_COMPANY_EMAIL: fixture.attended?.companyEmail ?? 0,
    ATTENDED_COUNT_ACCOUNT: fixture.attended?.account ?? 0,
    ATTENDED_COUNT_ALL: fixture.attended?.all ?? 0,
    HAS_FOOTPRINT_COMPANY_EMAIL: fixture.footprint?.companyEmail === false ? 0 : 1,
    HAS_FOOTPRINT_ACCOUNT: fixture.footprint?.account === false ? 0 : 1,
    HAS_FOOTPRINT_ALL: fixture.footprint?.all === false ? 0 : 1,
  });
  return eventId;
}

/** The per-account coverage flag the participation summary carries on every row. */
function setCoverage(hasCoverage: boolean, account = ACCOUNT): void {
  insert('ORG_EVENT_PARTICIPATION_SUMMARY', { ACCOUNT_ID: account, HAS_COMPANY_EMAIL_COVERAGE: hasCoverage ? 1 : 0 });
}

interface ParticipantFixture {
  ref: number;
  eventId?: string;
  name?: string | null;
  title?: string | null;
  companyEmail?: boolean;
  accountCredited?: boolean;
  roster?: boolean;
  registered?: boolean;
  attended?: boolean;
  listable?: boolean;
}

/** The six row-level conjunction flags dbt computes: (registered | attended) AND (company email | account | any relation). */
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
    COMPANY_EMAIL: fixture.companyEmail !== false,
    ACCOUNT: fixture.accountCredited === true,
    ALL: fixture.companyEmail !== false || fixture.accountCredited === true || fixture.roster === true,
  };
  return Object.fromEntries(
    Object.entries(credited).flatMap(([suffix, flag]) => [
      [`IS_COUNTED_REGISTERED_${suffix}`, registered && flag ? 1 : 0],
      [`IS_COUNTED_ATTENDED_${suffix}`, attended && flag ? 1 : 0],
    ])
  );
}

function addParticipant(fixture: ParticipantFixture): void {
  insert('ORG_EVENT_PARTICIPATION', {
    ACCOUNT_ID: ACCOUNT,
    EVENT_ID: fixture.eventId ?? 'event-one',
    PARTICIPANT_REF: fixture.ref,
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
  email: string,
  status: 'Accepted' | 'Submitted',
  eventId = 'event-one'
): void {
  insert('EVENT_SPEAKERS', {
    ACCOUNT_ID: ACCOUNT,
    EVENT_ID: eventId,
    SPEAKER_ID: speakerId,
    SPEAKER_FIRST_NAME: first,
    SPEAKER_LAST_NAME: last,
    SPEAKER_EMAIL: email,
    JOB_TITLE: 'Staff Engineer',
    SPEAKER_STATUS: status,
    EVENT_NAME: 'Community Summit',
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
      REGISTERED_COUNT_COMPANY_EMAIL INTEGER, REGISTERED_COUNT_ACCOUNT INTEGER, REGISTERED_COUNT_ALL INTEGER,
      ATTENDED_COUNT_COMPANY_EMAIL INTEGER, ATTENDED_COUNT_ACCOUNT INTEGER, ATTENDED_COUNT_ALL INTEGER,
      HAS_FOOTPRINT_COMPANY_EMAIL INTEGER, HAS_FOOTPRINT_ACCOUNT INTEGER, HAS_FOOTPRINT_ALL INTEGER
    )`
  );
  database.exec('CREATE TABLE ORG_EVENT_PARTICIPATION_SUMMARY (ACCOUNT_ID TEXT, HAS_COMPANY_EMAIL_COVERAGE INTEGER)');
  database.exec(
    `CREATE TABLE ORG_EVENT_PARTICIPATION (
      ACCOUNT_ID TEXT, EVENT_ID TEXT, PARTICIPANT_REF INTEGER, DISPLAY_NAME TEXT, JOB_TITLE TEXT,
      IS_COUNTED_REGISTERED_COMPANY_EMAIL INTEGER, IS_COUNTED_REGISTERED_ACCOUNT INTEGER, IS_COUNTED_REGISTERED_ALL INTEGER,
      IS_COUNTED_ATTENDED_COMPANY_EMAIL INTEGER, IS_COUNTED_ATTENDED_ACCOUNT INTEGER, IS_COUNTED_ATTENDED_ALL INTEGER,
      IS_LISTABLE INTEGER
    )`
  );
  database.exec(
    `CREATE TABLE EVENT_SPEAKERS (
      ACCOUNT_ID TEXT, EVENT_ID TEXT, SPEAKER_ID TEXT, SPEAKER_FIRST_NAME TEXT, SPEAKER_LAST_NAME TEXT,
      SPEAKER_EMAIL TEXT, JOB_TITLE TEXT, SPEAKER_STATUS TEXT, EVENT_NAME TEXT
    )`
  );

  // Run the service's real SQL against SQLite rather than asserting on query strings; only the dialect is translated.
  execute.mockImplementation(async (query: string, binds: string[]) => {
    const translated = query
      .replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')
      .replaceAll('ANALYTICS.SILVER_FACT.', '')
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
    setCoverage(true);
    addEvent({
      registered: { companyEmail: 3, account: 5, all: 8 },
      attended: { companyEmail: 1, account: 2, all: 4 },
      isPast: true,
    });
  });

  it.each([
    ['company_email', 'registered', 3],
    ['account', 'registered', 5],
    ['all', 'registered', 8],
    ['company_email', 'attended', 1],
    ['account', 'attended', 2],
    ['all', 'attended', 4],
  ] as const)('serves the %s / %s count on the Past tab', async (attribution, participation, expected) => {
    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, attribution, participation }));

    expect(list.servedAttribution).toBe(attribution);
    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([expected]);
  });

  it('keeps one bind per placeholder in every query it builds', async () => {
    await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, foundation: 'foundation-one', searchQuery: 'summit', status: 'registered' }));
    await service.getOrgEventsSummary(REQ, ACCOUNT, {
      attribution: 'all',
      participation: 'registered',
      scope: 'all',
      foundation: 'foundation-one',
      range: '90d',
    });
    await service.getOrgEventFoundations(REQ, ACCOUNT, { attribution: 'account', scope: 'activity' });
    await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { attribution: 'all', participation: 'registered', searchQuery: 'ada' });
    await service.getEventSpeakers(REQ, ACCOUNT, 'event-one', 'ada');

    for (const [sql, binds] of execute.mock.calls as [string, string[]][]) {
      expect(sql.match(/\?/g)?.length ?? 0).toBe(binds.length);
    }
  });
});

describe('OrgLensEventsService list — upcoming and past', () => {
  beforeEach(() => {
    setCoverage(true);
  });

  it('counts registrations on the Upcoming tab whatever participation is picked', async () => {
    addEvent({ registered: { companyEmail: 4 }, attended: { companyEmail: 0 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, participation: 'attended' }));

    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([4]);
  });

  it('ignores the range on the Upcoming tab', async () => {
    addEvent({ eventId: 'far-future', daysFromToday: 900, registered: { companyEmail: 1 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: false, range: '30d' }));

    expect(list.data.map((event) => event.eventId)).toEqual(['far-future']);
  });

  it('windows the Past tab by the range and leaves all time open', async () => {
    addEvent({ eventId: 'recent', daysFromToday: -10, registered: { companyEmail: 1 } });
    addEvent({ eventId: 'old', daysFromToday: -200, registered: { companyEmail: 1 } });
    addEvent({ eventId: 'ancient', daysFromToday: -900, registered: { companyEmail: 1 } });

    const past = (range: GetOrgEventsOptions['range']): Promise<string[]> =>
      service
        .getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, range, sortField: 'EVENT_NAME' }))
        .then((response) => response.data.map((event) => event.eventId).sort());

    expect(await past('30d')).toEqual(['recent']);
    expect(await past('365d')).toEqual(['old', 'recent']);
    expect(await past('730d')).toEqual(['old', 'recent']);
    expect(await past('all')).toEqual(['ancient', 'old', 'recent']);
  });

  it('lists only events with activity under the served attribution by default, and the involvement-only rows under eventScope=all', async () => {
    addEvent({ eventId: 'mine', registered: { companyEmail: 2 } });
    addEvent({ eventId: 'others', footprint: { companyEmail: false } });

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

  it('keeps status=registered in step with the displayed count of the picked option', async () => {
    addEvent({ eventId: 'registered-by-account', registered: { companyEmail: 0, account: 3 } });

    const byEmail = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ status: 'registered' }));
    const byAccount = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ status: 'registered', attribution: 'account' }));

    expect(byEmail.data).toEqual([]);
    expect(byAccount.data.map((event) => event.eventId)).toEqual(['registered-by-account']);
  });

  it('keeps status=registered on registrations whatever Count shows, so an event with no attendance is not hidden', async () => {
    addEvent({ eventId: 'registered-only', isPast: true, registered: { companyEmail: 2 }, attended: { companyEmail: 0 } });

    const attendedView = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, status: 'registered', participation: 'attended' }));

    expect(attendedView.data.map((event) => event.eventId)).toEqual(['registered-only']);
  });

  it("never reads another account's events", async () => {
    addEvent({ account: OTHER_ACCOUNT, registered: { companyEmail: 9 } });

    expect((await service.getOrgEvents(REQ, ACCOUNT, listOptions())).data).toEqual([]);
  });
});

describe('OrgLensEventsService coverage fallback', () => {
  it('serves the account attribution when the company has no company-email data', async () => {
    setCoverage(false);
    addEvent({ isPast: true, registered: { companyEmail: 0, account: 6 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }));

    expect(list.servedAttribution).toBe('account');
    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([6]);
  });

  it('makes no coverage claim, and serves the pick as asked, when the account has no summary rows at all', async () => {
    addEvent({ isPast: true, registered: { account: 2 } });

    expect((await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }))).servedAttribution).toBe('company_email');
  });

  it('does not fall back for an explicit account or all pick', async () => {
    setCoverage(false);
    addEvent({ isPast: true, registered: { all: 7 } });

    const list = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true, attribution: 'all' }));

    expect(list.servedAttribution).toBe('all');
    expect(list.data.map((event) => event.orgAttendeeCount)).toEqual([7]);
  });

  it('reports the served attribution on the summary and the drawer too', async () => {
    setCoverage(false);
    addEvent({ isPast: true });

    const summary = await service.getOrgEventsSummary(REQ, ACCOUNT, {
      attribution: 'company_email',
      participation: 'registered',
      scope: 'activity',
      foundation: '',
      range: '730d',
    });
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { attribution: 'company_email', participation: 'registered' });

    expect(summary.servedAttribution).toBe('account');
    expect(drawer.servedAttribution).toBe('account');
  });
});

describe('OrgLensEventsService summary tiles', () => {
  const filters = { attribution: 'company_email', participation: 'registered', scope: 'activity', foundation: '', range: '730d' } as const;

  beforeEach(() => {
    setCoverage(true);
    addEvent({ eventId: 'upcoming', daysFromToday: 20 });
    addEvent({ eventId: 'recent', daysFromToday: -10 });
    addEvent({ eventId: 'old', daysFromToday: -200 });
    addEvent({
      eventId: 'involvement-only',
      daysFromToday: -5,
      footprint: { companyEmail: false },
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
      servedAttribution: 'company_email',
    });
  });
});

describe('OrgLensEventsService foundations', () => {
  it('lists the foundations that have events under the picked scope', async () => {
    setCoverage(true);
    addEvent({ eventId: 'mine', foundationId: 'foundation-one', foundationName: 'Foundation One' });
    addEvent({ eventId: 'others', foundationId: 'foundation-two', foundationName: 'Foundation Two', footprint: { companyEmail: false } });

    const activity = await service.getOrgEventFoundations(REQ, ACCOUNT, { attribution: 'company_email', scope: 'activity' });
    const all = await service.getOrgEventFoundations(REQ, ACCOUNT, { attribution: 'company_email', scope: 'all' });

    expect(activity.data).toEqual([{ id: 'foundation-one', name: 'Foundation One' }]);
    expect(all.data).toEqual([
      { id: 'foundation-one', name: 'Foundation One' },
      { id: 'foundation-two', name: 'Foundation Two' },
    ]);
  });

  it('lists one option per foundation when the name is stored padded or blank on some rows', async () => {
    setCoverage(true);
    addEvent({ eventId: 'plain', foundationId: 'foundation-one', foundationName: 'Foundation One' });
    addEvent({ eventId: 'padded', foundationId: 'foundation-one', foundationName: ' \tFoundation One\u00A0\n' });
    addEvent({ eventId: 'blank', foundationId: 'foundation-blank', foundationName: ' \t\u00A0\n' });

    const { data } = await service.getOrgEventFoundations(REQ, ACCOUNT, { attribution: 'company_email', scope: 'all' });

    expect(data).toEqual([{ id: 'foundation-one', name: 'Foundation One' }]);
  });
});

describe('OrgLensEventsService attendees drawer', () => {
  const options = { attribution: 'company_email', participation: 'registered' } as const;

  beforeEach(() => {
    setCoverage(true);
    addEvent({ isPast: true, registered: { companyEmail: 4, account: 6, all: 7 }, attended: { companyEmail: 2, account: 3, all: 4 } });
  });

  it('lists only the people who may be named and counts the rest as not listed', async () => {
    addParticipant({ ref: 1, name: 'Ada Lovelace' });
    addParticipant({ ref: 2, name: 'Grace Hopper' });
    addParticipant({ ref: 3, name: null, listable: false });
    addParticipant({ ref: 4, name: null, listable: false });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);

    expect(drawer.data.map((attendee) => attendee.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(drawer.total).toBe(2);
    expect(drawer.notListedCount).toBe(2);
    expect(drawer.eventName).toBe('Community Summit');
  });

  it('applies each attribution predicate', async () => {
    addParticipant({ ref: 1, name: 'By Email', companyEmail: true });
    addParticipant({ ref: 2, name: 'By Account', companyEmail: false, accountCredited: true });
    addParticipant({ ref: 3, name: 'By Roster', companyEmail: false, roster: true });

    const names = async (attribution: 'company_email' | 'account' | 'all'): Promise<string[]> =>
      (await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { attribution, participation: 'registered' })).data.map((attendee) => attendee.name).sort();

    expect(await names('company_email')).toEqual(['By Email']);
    expect(await names('account')).toEqual(['By Account']);
    expect(await names('all')).toEqual(['By Account', 'By Email', 'By Roster']);
  });

  it('separates registered from attended, and rejected registrations never count', async () => {
    addParticipant({ ref: 1, name: 'Attended', attended: true });
    addParticipant({ ref: 2, name: 'Registered Only' });
    addParticipant({ ref: 3, name: 'Rejected', registered: false });

    const registered = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);
    const attended = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, participation: 'attended' });

    expect(registered.data.map((attendee) => attendee.name).sort()).toEqual(['Attended', 'Registered Only']);
    expect(attended.data.map((attendee) => attendee.name)).toEqual(['Attended']);
    // The option count is the ORG_EVENTS column of the picked option: 2 attended minus 1 listed.
    expect(attended.notListedCount).toBe(1);
  });

  it('counts registrations for an event that has not ended, whatever participation is picked', async () => {
    addEvent({ eventId: 'future', registered: { companyEmail: 2 }, attended: { companyEmail: 0 } });
    addParticipant({ ref: 1, eventId: 'future', name: 'Ada Lovelace' });

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, 'future', { ...options, participation: 'attended' });

    expect(drawer.data.map((attendee) => attendee.name)).toEqual(['Ada Lovelace']);
    expect(drawer.notListedCount).toBe(1);
  });

  it('never reports a negative not-listed count', async () => {
    for (let ref = 1; ref <= 6; ref++) addParticipant({ ref, name: `Person ${ref}` });

    expect((await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options)).notListedCount).toBe(0);
  });

  it('labels a listed person with no name neutrally and returns no address in any field', async () => {
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

  it('keeps notListedCount the same whatever the name search narrows to', async () => {
    addParticipant({ ref: 1, name: 'Ada Lovelace' });
    addParticipant({ ref: 2, name: 'Grace Hopper' });
    addParticipant({ ref: 3, name: null, listable: false });
    addParticipant({ ref: 4, name: null, listable: false });

    const unsearched = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', options);
    const searched = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, searchQuery: 'hopper' });
    const noMatch = await service.getEventAttendees(REQ, ACCOUNT, 'event-one', { ...options, searchQuery: 'nobody' });

    expect(unsearched.notListedCount).toBe(2);
    expect(searched.notListedCount).toBe(2);
    expect(noMatch.notListedCount).toBe(2);
    expect(noMatch.data).toEqual([]);
  });

  it('rejects, rather than returning zero counts, when the read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(service.getEventAttendees(REQ, 'acct-failing', 'event-one', { attribution: 'all', participation: 'registered' })).rejects.toThrow(
      'warehouse down'
    );
  });
});

describe('OrgLensEventsService speakers drawer', () => {
  beforeEach(() => {
    setCoverage(true);
    addEvent({ isPast: true });
  });

  it('returns a neutral label rather than an address and never searches by address', async () => {
    addSpeaker('speaker-1', 'Ada', 'Lovelace', 'ada@company.test', 'Accepted');
    addSpeaker('speaker-2', null, null, 'nameless@company.test', 'Submitted');
    addSpeaker('speaker-3', 'grace@company.test', '', 'grace@company.test', 'Submitted');

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
    setCoverage(true);
    addEvent({ registered: { companyEmail: 3 } });
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
    setCoverage(true);
    addEvent({ isPast: true, registered: { companyEmail: 1, account: 2 } });
  });

  it('serves a repeated identical read from the cache', async () => {
    const first = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }));
    const fetchesAfterFirst = execute.mock.calls.length;
    const second = await service.getOrgEvents(REQ, ACCOUNT, listOptions({ isPast: true }));

    expect(execute.mock.calls).toHaveLength(fetchesAfterFirst);
    expect(second).toEqual(first);
  });

  it.each([
    ['attribution', { attribution: 'account' }],
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
  it('returns an empty list carrying the picked attribution when the read fails', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    const list = await service.getOrgEvents(REQ, 'acct-failing', listOptions({ attribution: 'all' }));

    expect(list).toEqual({ data: [], total: 0, pageSize: 25, offset: 0, servedAttribution: 'all' });
  });
});
