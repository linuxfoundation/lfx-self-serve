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
function addRegistration(email: string | null, fullName: string, account = ACCOUNT, eventId = EVENT): void {
  database
    .prepare('INSERT INTO EVENT_REGISTRATIONS VALUES (?, ?, ?, ?, ?, ?)')
    .run(account, eventId, email, fullName, 'Engineer', 'KubeCon + CloudNativeCon North America 2026');
}

/** An address the warehouse holds for the org — the employer ∩ employee intersection. */
function addCompanyEmail(email: string | null, account = ACCOUNT): void {
  database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)').run(account, `person-${email}`, null, email, 1);
}

/** A roster profile, the source the drawer prefers over the registration's own name and title. */
function addProfile(email: string, name: string, title: string, account = ACCOUNT): void {
  database.prepare('INSERT INTO ORG_PEOPLE_ALL VALUES (?, ?, ?, ?)').run(account, email, name, title);
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

  it('does not let a null or blank stored address count as coverage', async () => {
    addEvent(EVENT, 99);
    // Rows exist for the account, but none carries an address anything could match on.
    addCompanyEmail(null);
    addCompanyEmail('   ');
    addRegistration('someone@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    // Treating these as coverage would switch the fallback off and zero the page while supplying
    // nothing to filter by — the exact outcome the fallback exists to prevent.
    expect(list.data[0].orgAttendeeCount).toBe(1);
    expect(drawer.total).toBe(1);
  });

  it('excludes registrations with no address, including on the fallback path', async () => {
    addEvent(EVENT, 99);
    // No coverage, so the fallback is engaged — the path where a null address would slip through.
    addRegistration('someone@gmail.example', 'Someone Else');
    addRegistration(null, 'No Address');
    addRegistration('   ', 'Blank Address');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(1);
    // A null group would both disagree with the count and hand the drawer a null contactId.
    expect(drawer.total).toBe(1);
    expect(drawer.data.every((attendee) => !!attendee.contactId)).toBe(true);
  });

  it('counts one person once across case and whitespace variants of their address', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    // The join matches both of these to the one company address, so they are one attendee.
    addRegistration('ada@company.example', 'Ada Lovelace');
    addRegistration('  Ada@Company.Example  ', 'Ada Lovelace');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(1);
    expect(drawer.total).toBe(1);
    expect(drawer.data[0].contactId).toBe('ada@company.example');
  });

  it('enriches every address variant in a group from the same profile', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addProfile('ada@company.example', 'Ada Lovelace', 'Principal Engineer');
    addRegistration('ada@company.example', 'Ada L');
    // Same person, padded. Its registration name sorts above the profile name, so if this row misses
    // the profile join the MAX() below returns the registration fallback instead of the profile.
    addRegistration('  Ada@Company.Example  ', 'Zed Padded');

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(drawer.total).toBe(1);
    expect(drawer.data[0].name).toBe('Ada Lovelace');
    expect(drawer.data[0].jobTitle).toBe('Principal Engineer');
  });

  /**
   * SQLite accepts a correlated `EXISTS` under `OR`; Snowflake does not —
   * https://docs.snowflake.com/en/sql-reference/operators-subquery: "Correlated EXISTS subqueries
   * cannot appear as an argument to an OR operator." Every behavioural test above passed against a
   * build that could not compile on Snowflake at all, where both paths catch and degrade to empty
   * results: a silently blank page on each cache miss, not an error. This asserts the dialect rule
   * directly, since no fixture can.
   *
   * Both arms tolerate the operand being parenthesised (`OR (EXISTS (…))`), which is how the same
   * mistake is most naturally rewritten. The left-arm pattern is bounded rather than exact; it can
   * in principle flag an unrelated `OR` that trails a subquery closely enough. That direction is
   * the right one to err in — a false positive is a failing test somebody reads, a false negative
   * is the blank page again.
   */
  function findsSubqueryUnderOr(sql: string): boolean {
    const normalized = sql.replace(/\s+/g, ' ');
    return (
      // `EXISTS` is prefix, so it sits flush against the OR (modulo parens and NOT).
      /\bOR\s*\(?\s*(NOT\s+)?EXISTS\s*\(\s*SELECT\b/i.test(normalized) ||
      // `IN` / `ANY` / `ALL` are infix: an operand stands between the OR and the keyword, and in this
      // service that operand is usually a call — every address comparison here is wrapped in
      // `LOWER(TRIM(...))`. The operand therefore has to admit nested parens, two deep, or the most
      // likely next spelling of the mistake slips through. Requiring SELECT after the keyword's paren
      // is what keeps a legal value list (`x IN (1, 2)`) from being flagged.
      /\bOR\s*\(?\s*(?:[^()]|\((?:[^()]|\([^()]*\))*\)){0,80}?\b(NOT\s+)?(IN|ANY|ALL)\s*\(\s*SELECT\b/i.test(normalized) ||
      // The same two shapes with the subquery as the LEFT operand.
      /\b(EXISTS|IN|ANY|ALL)\s*\(\s*SELECT\b[\s\S]{0,400}?\)\s*\)?\s*OR\b/i.test(normalized)
    );
  }

  it('detects a subquery on either side of an OR, however it is spelled', () => {
    // The guard below is only as good as this matcher, so the matcher is itself pinned. The
    // parenthesised spellings are the ones the first version of this test missed.
    for (const bad of [
      'WHERE a OR EXISTS (SELECT 1 FROM t)',
      'WHERE a OR (EXISTS (SELECT 1 FROM t))',
      'WHERE a OR NOT EXISTS (SELECT 1 FROM t)',
      'WHERE a OR (NOT EXISTS (SELECT 1 FROM t))',
      'WHERE a OR x IN (SELECT 1 FROM t)',
      'WHERE a OR LOWER(x) IN (SELECT 1 FROM t)',
      // Two levels deep: the shape this service would actually produce.
      'WHERE a OR LOWER(TRIM(er.EMAIL)) IN (SELECT 1 FROM t)',
      'WHERE EXISTS (SELECT 1 FROM t) OR a',
      'WHERE (EXISTS (SELECT 1 FROM t)) OR a',
    ]) {
      expect(findsSubqueryUnderOr(bad), bad).toBe(true);
    }

    for (const good of [
      'WHERE a OR b',
      'WHERE EXISTS (SELECT 1 FROM t) AND a',
      'WHERE ce.EMAIL IS NOT NULL OR cov.COVERAGE_ROWS = 0',
      'WHERE (UPPER(x) LIKE UPPER(?) OR UPPER(y) LIKE UPPER(?))',
      // A value list is not a subquery and carries no such restriction, however it is spelled.
      'WHERE a OR x IN (1, 2, 3)',
      'WHERE a OR LOWER(TRIM(er.EMAIL)) IN (1, 2, 3)',
    ]) {
      expect(findsSubqueryUnderOr(good), good).toBe(false);
    }
  });

  it('builds no query that puts a subquery on either side of an OR', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');

    // The search filter adds the only other `OR` these queries carry, so it is exercised here too.
    await service.getOrgEvents(REQ, ACCOUNT, { ...LIST_OPTIONS, searchQuery: 'kube' });
    await service.getEventAttendees(REQ, ACCOUNT, EVENT, 'ada');

    const queries = execute.mock.calls.map(([query]) => query as string);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(findsSubqueryUnderOr(query), query).toBe(false);
    }
  });

  it('passes one bind per placeholder in every query it builds', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');

    await service.getOrgEvents(REQ, ACCOUNT, { ...LIST_OPTIONS, searchQuery: 'kube' });
    await service.getEventAttendees(REQ, ACCOUNT, EVENT, 'ada');

    for (const [query, binds] of execute.mock.calls as [string, string[]][]) {
      expect(binds).toHaveLength((query.match(/\?/g) ?? []).length);
    }
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
