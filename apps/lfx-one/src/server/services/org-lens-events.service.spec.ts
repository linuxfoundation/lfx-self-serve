// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

// Narrow the shared barrels to the modules this service actually reads: the full barrels reach
// Angular-dependent code that will not load in the plain-Node server environment.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/date-time.utils')),
  ...(await import('../../../../../packages/shared/src/utils/url.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
// The cache is not under test here; every call goes straight to the fetcher so the real SQL runs.
vi.mock('./valkey.service', () => ({
  withOrgCache: <T>(_account: string, _key: string, _ttl: number, fetcher: () => Promise<T>): Promise<T> => fetcher(),
}));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));

import { OrgLensEventsService } from './org-lens-events.service';

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

const ACCOUNT = 'account-one';
const EVENT = 'event-one';
const REQ = {} as Request;

const LIST_OPTIONS = {
  isPast: false,
  searchQuery: undefined,
  status: undefined,
  pageSize: 25,
  offset: 0,
  sortField: 'EVENT_START_DATE',
  sortOrder: 'ASC',
} as unknown as Parameters<OrgLensEventsService['getOrgEvents']>[2];

let database: SqlDatabase;
let service: OrgLensEventsService;

/** One registration for `email`, attributed upstream to `account` regardless of the address used. */
function addRegistration(email: string, fullName: string, account = ACCOUNT, eventId = EVENT): void {
  database
    .prepare('INSERT INTO EVENT_REGISTRATIONS VALUES (?, ?, ?, ?, ?, ?)')
    .run(account, eventId, email, fullName, 'Engineer', 'KubeCon + CloudNativeCon North America 2026');
}

/** An address the warehouse holds for the org — the employer ∩ employee intersection. */
function addCompanyEmail(email: string, account = ACCOUNT): void {
  database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)').run(account, `person-${email}`, null, email, 1);
}

function addEvent(eventId = EVENT, precomputedCount = 99): void {
  database
    .prepare('INSERT INTO ORG_EVENTS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      ACCOUNT,
      eventId,
      'KubeCon + CloudNativeCon North America 2026',
      'Cloud Native Computing Foundation (CNCF)',
      '2026-11-09',
      '2026-11-12',
      'Salt Lake City, United States',
      'Salt Lake City',
      'United States',
      'https://example.test/event',
      'https://example.test/register',
      precomputedCount,
      10000,
      0,
      0,
      0
    );
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(
    `CREATE TABLE ORG_EVENTS (
      ACCOUNT_ID TEXT, EVENT_ID TEXT, EVENT_NAME TEXT, FOUNDATION_NAME TEXT,
      EVENT_START_DATE TEXT, EVENT_END_DATE TEXT, EVENT_LOCATION TEXT, EVENT_CITY TEXT, EVENT_COUNTRY TEXT,
      EVENT_URL TEXT, EVENT_REGISTRATION_URL TEXT, ORG_REGISTRATION_COUNT INTEGER, EVENT_REGISTRATIONS_GOAL INTEGER,
      ORG_SPEAKER_ACCEPTED_COUNT INTEGER, ORG_SPEAKER_SUBMITTED_COUNT INTEGER, IS_ORG_SPONSOR INTEGER
    )`
  );
  database.exec('CREATE TABLE EVENT_REGISTRATIONS (ACCOUNT_ID TEXT, EVENT_ID TEXT, EMAIL TEXT, FULL_NAME TEXT, JOB_TITLE TEXT, EVENT_NAME TEXT)');
  database.exec('CREATE TABLE ORG_PEOPLE_ALL (ACCOUNT_ID TEXT, EMAIL TEXT, NAME TEXT, TITLE TEXT)');
  database.exec('CREATE TABLE ORG_PEOPLE_COMPANY_EMAILS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT, EMAIL TEXT, IS_PRIMARY INTEGER)');

  // Run the service's real SQL against SQLite rather than asserting on query strings. IS_PAST_EVENT
  // is a predicate here, not a column, so it is folded to a constant per the fixture's tense.
  execute.mockImplementation(async (query: string, binds: string[]) => {
    const translated = query
      .replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')
      .replaceAll('ANALYTICS.SILVER_FACT.', '')
      .replaceAll('oe.IS_PAST_EVENT = TRUE', '0')
      .replaceAll('oe.IS_PAST_EVENT = FALSE', '1')
      .replaceAll('ILIKE', 'LIKE');
    return { rows: database.prepare(translated).all(...binds) };
  });

  service = new OrgLensEventsService();
});

afterEach(() => {
  database.close();
  vi.clearAllMocks();
});

describe('OrgLensEventsService company-email scoping', () => {
  it('lists only the registrant who used a company address', async () => {
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    addRegistration('ada.personal@gmail.example', 'Ada Lovelace');

    const response = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(response.data.map((attendee) => attendee.contactId)).toEqual(['ada@company.example']);
    expect(response.total).toBe(1);
  });

  it('matches addresses regardless of case and surrounding whitespace on either side', async () => {
    addCompanyEmail('  Ada@Company.Example ');
    addRegistration('ada@company.example', 'Ada Lovelace');
    // Present so the assertion cannot pass by the filter simply not running.
    addRegistration('ada.personal@gmail.example', 'Ada Lovelace');

    const response = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(response.data.map((attendee) => attendee.contactId)).toEqual(['ada@company.example']);
  });

  it('does not treat an address held for another account as this org company address', async () => {
    // This org has coverage of its own, so the no-coverage fallback is not in play and the
    // assertion is about cross-account isolation alone.
    addCompanyEmail('ada@company.example');
    addCompanyEmail('grace@other.example', 'other-account');
    addRegistration('grace@other.example', 'Grace Hopper');

    const response = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(response.data).toEqual([]);
  });

  it('counts the row from the same filtered set as the drawer, not the precomputed platinum column', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addCompanyEmail('grace@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    addRegistration('grace@company.example', 'Grace Hopper');
    addRegistration('someone@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(2);
    expect(list.data[0].orgAttendeeCount).toBe(drawer.total);
  });

  it('falls back to the unfiltered set when the org has no company-address coverage at all', async () => {
    addEvent(EVENT, 99);
    addRegistration('someone@gmail.example', 'Someone Else');
    addRegistration('another@gmail.example', 'Another Person');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    // Not 0: zero coverage is no basis for asserting nobody attended. The row and the drawer still agree.
    expect(list.data[0].orgAttendeeCount).toBe(2);
    expect(drawer.total).toBe(2);
  });

  it('does not fall back once the org has any coverage, even if nobody on this event qualifies', async () => {
    addEvent(EVENT, 99);
    // Coverage exists for the account, but matches no registrant on this event.
    addCompanyEmail('someone.else@company.example');
    addRegistration('personal@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(0);
    expect(drawer.total).toBe(0);
  });

  it('keeps another account coverage from suppressing this org fallback', async () => {
    addEvent(EVENT, 99);
    // Coverage belongs to a different account, so this org still has none of its own.
    addCompanyEmail('someone@other.example', 'other-account');
    addRegistration('personal@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    expect(list.data[0].orgAttendeeCount).toBe(1);
  });

  it('excludes an event from status=registered when no registrant used a company address', async () => {
    addEvent(EVENT, 99);
    // Coverage exists, so the filter applies rather than falling back.
    addCompanyEmail('someone.else@company.example');
    addRegistration('someone@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, { ...LIST_OPTIONS, status: 'registered' });

    expect(list.data).toEqual([]);
  });

  it('keeps an event in status=registered when at least one registrant used a company address', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    addRegistration('someone@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, { ...LIST_OPTIONS, status: 'registered' });

    expect(list.data).toHaveLength(1);
    expect(list.data[0].orgAttendeeCount).toBe(1);
  });
});
