// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, cacheValues } = vi.hoisted(() => ({ execute: vi.fn(), cacheValues: new Map<string, string>() }));

// Narrow the shared barrels to the modules this service actually reads: the full barrels reach
// Angular-dependent code that will not load in the plain-Node server environment.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/date-time.utils')),
  ...(await import('../../../../../packages/shared/src/utils/url.utils')),
  // Needed by the real valkey.service, which this spec now exercises rather than stubs.
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  // `isObjectRow` backs the `accept` predicates this service passes to the cache. Omitting it did
  // not fail loudly: vitest throws "No export is defined on the mock" from INSIDE `getJson`'s try,
  // which fails soft to a cache miss — so every read missed and the cache assertions here were
  // asserting against a cache that never hit. `cache-hit-path` guards it.
  ...(await import('../../../../../packages/shared/src/utils/object.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
}));

vi.mock('./snowflake.service', async () => ({
  SnowflakeService: {
    getInstance: () => ({ execute }),
    // The REAL predicate, not a stub: snowflake-error.helper.ts says it was extracted precisely so
    // specs depend on it rather than a hand-copied regex that can drift.
    isMissingObjectError: (await import('../helpers/snowflake-error.helper')).isMissingObjectError,
  },
}));
/**
 * The REAL `withOrgCache` over a Map-backed Redis, as `org-lens-people.service.spec.ts` does. A stub
 * that always calls the fetcher cannot tell a cached read from an uncached one, so the assertion that
 * the unscoped fallback is never stored under the scoped key would pass even if the fallback were
 * moved inside the cached fetcher — which is the one refactor that would reintroduce the bug.
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
function addRegistration(email: string | null, fullName: string, account = ACCOUNT, eventId = EVENT, jobTitle = 'Engineer'): void {
  database
    .prepare('INSERT INTO EVENT_REGISTRATIONS VALUES (?, ?, ?, ?, ?, ?)')
    .run(account, eventId, email, fullName, jobTitle, 'KubeCon + CloudNativeCon North America 2026');
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
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  cacheValues.clear();
  ValkeyService.resetInstance();
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
      .replaceAll('ILIKE', 'LIKE')
      // Snowflake spells it CHR (CHAR is also a type name there); SQLite spells it char.
      .replaceAll(/\bCHR\(/g, 'char(');
    try {
      return { rows: database.prepare(translated).all(...binds) };
    } catch (error) {
      // The harness already translates dialect; it has to translate the ERROR SHAPE too, or the real
      // isMissingObjectError predicate can never recognise a dropped fixture table and the
      // missing-object branch goes untested.
      const message = error instanceof Error ? error.message : String(error);
      const missingTable = /no such table: (\w+)/i.exec(message);
      if (missingTable) {
        throw new Error(`SQL compilation error: Object '${missingTable[1]}' does not exist or not authorized.`);
      }
      throw error;
    }
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

  it('matches an address padded with tabs, newlines or non-breaking spaces', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addCompanyEmail('grace@company.example');
    // Coverage exists, so a registrant this normalization fails to match is dropped outright. Each
    // padding style belongs to a DIFFERENT person, so a style the set misses lowers the count —
    // padding one person two ways would leave the assertion passing on the other one's row.
    addRegistration('\tada@company.example\n', 'Ada Lovelace');
    // Non-breaking space: what survives a paste out of a document or web form.
    addRegistration('\u00a0grace@company.example\u00a0', 'Grace Hopper');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(2);
    expect(drawer.data.map((attendee) => attendee.contactId)).toEqual(['ada@company.example', 'grace@company.example']);
  });

  it('does not strip characters that merely appear in an escape sequence', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.test');
    // `.test` ends in `t` (and is a reserved TLD). A character-set TRIM written as '\t\n\r ' eats
    // that `t` under SQLite's non-escaping literals, which is why the normalization uses code points.
    addRegistration('  ada@company.test  ', 'Ada Lovelace');

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(drawer.data.map((attendee) => attendee.contactId)).toEqual(['ada@company.test']);
  });

  it('enriches every address variant in a group from the same profile', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addProfile('ada@company.example', 'Ada Lovelace', 'Principal Engineer');
    addRegistration('ada@company.example', 'Ada L');
    // Same person, padded. BOTH its name and its title sort above the profile's, so if this row
    // misses the profile join the MAX() below returns the registration fallback for each. Seeding a
    // title that sorts BELOW the profile's would leave the title assertion passing either way.
    addRegistration('  Ada@Company.Example  ', 'Zed Padded', ACCOUNT, EVENT, 'Zzz Registration Title');

    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(drawer.total).toBe(1);
    expect(drawer.data[0].name).toBe('Ada Lovelace');
    expect(drawer.data[0].jobTitle).toBe('Principal Engineer');
  });

  it('still requires an address on the fallback path', async () => {
    addEvent(EVENT, 99);
    addRegistration('someone@gmail.example', 'Someone Else');
    // No address and no name: the pair that previously reached the drawer as contactId null and
    // name null, which computePersonInitials then splits.
    addRegistration(null, null as unknown as string);
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(1);
    expect(drawer.total).toBe(1);
    expect(drawer.data.every((attendee) => !!attendee.contactId && !!attendee.name)).toBe(true);
  });

  it('never serves the event registration goal to an external admin', async () => {
    // The fixture carries a non-zero warehouse goal (10000), so this fails the moment it leaks.
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    // #4432 is about disclosure, not display: the key must be ABSENT, not present-and-null. The
    // serialized check also catches the number reappearing under some other field name.
    expect(list.data[0]).not.toHaveProperty('eventRegistrationsGoal');
    expect(JSON.stringify(list)).not.toContain('10000');
  });

  it('serves the goal to LF staff', async () => {
    checkLFStaff.mockResolvedValue(true);
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    expect(list.data[0].eventRegistrationsGoal).toBe(10000);
  });

  it('withholds the goal from a global auditor or org admin who is not LF staff', async () => {
    addEvent(EVENT, 99);
    addRegistration('ada@company.example', 'Ada Lovelace');

    // `RoleGrantsResponse.isStaff` is true for `lf-staff`, `global-org-auditors` AND
    // `global_org_admin`, and its own comment says it "is never a read gate" — it drives the Org
    // Lens search affordance. An earlier revision gated on it, which would have handed the internal
    // goal to those two non-LF teams. The gate asks `lf-staff#member` alone, so they are external
    // for this purpose however much else they can read.
    checkLFStaff.mockResolvedValue(false);

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    expect(list.data[0]).not.toHaveProperty('eventRegistrationsGoal');
    expect(JSON.stringify(list)).not.toContain('10000');
    expect(checkLFStaff).toHaveBeenCalled();
  });

  it('withholds the goal when the staff check cannot be trusted', async () => {
    addEvent(EVENT, 99);
    addRegistration('ada@company.example', 'Ada Lovelace');

    // `checkLFStaff` already degrades to false when the access check fails, so a withheld goal is
    // the documented outcome of an authorizer problem rather than an accident of this call site.
    checkLFStaff.mockResolvedValue(false);
    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    expect(list.data[0]).not.toHaveProperty('eventRegistrationsGoal');
  });

  it('does not leak a staff-populated cache entry to an external admin', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');

    // The Org Lens cache is keyed per ORG, not per user, so a staff read and an external read share
    // one entry. Redaction therefore has to happen AFTER the cache, on every response path — if it
    // moved into the cached fetcher, this is the test that would catch it.
    checkLFStaff.mockResolvedValue(true);
    expect((await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS)).data[0].eventRegistrationsGoal).toBe(10000);

    const fetchesBefore = execute.mock.calls.length;
    checkLFStaff.mockResolvedValue(false);
    const external = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    // The point of the test: the external read must be served from the entry the STAFF read wrote.
    // Without this the test passes on a refetch, which redacts correctly for a different reason and
    // would keep passing if redaction moved inside the cached fetcher — the regression it guards.
    expect(execute.mock.calls).toHaveLength(fetchesBefore);
    expect(external.data[0]).not.toHaveProperty('eventRegistrationsGoal');
    expect(JSON.stringify(external)).not.toContain('10000');
  });

  // Every cache assertion in this file rests on reads actually hitting. They did not: the shared
  // `accept` predicates call `isObjectRow`, and a gap in the `@lfx-one/shared/utils` mock made that
  // throw inside `getJson`, which fails soft to a miss. Nothing failed, the cache just never hit.
  it('serves a repeated identical read from the cache', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');

    const first = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const fetchesAfterFirst = execute.mock.calls.length;
    const second = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    expect(execute.mock.calls).toHaveLength(fetchesAfterFirst);
    expect(second).toEqual(first);
  });

  it('still lists events when registrations are unavailable', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    // Recomputing the count made this table load-bearing for the list, which it never was before.
    database.exec('DROP TABLE EVENT_REGISTRATIONS');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    // ORG_EVENTS still answers "what events does this org have"; the count falls back to the
    // precomputed column. The drawer cannot degrade this far and is empty — a row count beside an
    // empty drawer, which still beats telling the org it has no events.
    expect(list.data).toHaveLength(1);
    expect(list.data[0].orgAttendeeCount).toBe(99);
    expect(drawer.data).toEqual([]);

    // And neither surface retried a spelling that reads the missing table. Each pointless retry
    // costs a breaker failure, and concurrent drawer opens during such an outage would spend one
    // per request — enough to open the breaker and take the platinum list down with it.
    const queries = (execute.mock.calls as [string][]).map(([query]) => query);
    // Qualified: a bare `EVENT_REGISTRATIONS` substring would also match column names, so the
    // filter names the table it means.
    const registrationAttempts = queries.filter((query) => query.includes('SILVER_FACT.EVENT_REGISTRATIONS'));
    expect(queries).toHaveLength(3); // list scoped, list platinum, drawer scoped
    expect(registrationAttempts).toHaveLength(2); // the two scoped attempts only — neither retried
  });

  it('does not drop the company-email filter when the scoped query fails for another reason', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    addRegistration('someone@gmail.example', 'Someone Else');

    // A timeout, a transient fault, anything that is not "the table isn't there". Falling back here
    // would quietly show personal-email registrants with the address table perfectly healthy — the
    // one outcome this whole rule exists to prevent.
    const realExecute = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: string, binds: string[], options?: unknown) => {
      if (query.includes('company_email_coverage')) {
        throw new Error('JavaScript execution error: Operation timed out');
      }
      return realExecute(query, binds, options);
    });

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data).toEqual([]);
    expect(drawer.data).toEqual([]);
  });

  it('reports a missing core table normally rather than as an expected rollout', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    database.exec('DROP TABLE EVENT_REGISTRATIONS');

    await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    // The unscoped retry and the platinum last resort both read core tables. Flagging them would
    // suppress the error telemetry for a genuinely broken warehouse and reset the shared breaker.
    const unscopedCalls = (execute.mock.calls as [string, string[], unknown?][]).filter(([query]) => !query.includes('company_email_coverage'));
    expect(unscopedCalls.length).toBeGreaterThan(0);
    for (const [, , options] of unscopedCalls) {
      expect(options).toBeUndefined();
    }
  });

  it('keeps a missing address table out of the shared circuit breaker', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');

    await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    // The scoped spelling is the one that may legitimately find no table, and the fallback is
    // uncached — so every request would re-run it. Without this flag those failures reach
    // recordFailure() on the POD-WIDE breaker, and enough concurrent loads would fail every
    // Snowflake surface, blocking the very retry this path exists to perform. It names the table
    // rather than passing `true`, so a missing CORE table in the same statement is NOT exempted.
    const calls = execute.mock.calls as [string, string[], unknown?][];
    const scopedCalls = calls.filter(([query]) => query.includes('company_email_coverage'));
    expect(scopedCalls).toHaveLength(2);
    for (const [, , options] of scopedCalls) {
      expect(options).toEqual({ expectMissingObject: 'ORG_PEOPLE_COMPANY_EMAILS' });
    }

    // And ONLY the scoped spellings. The flag means "this statement references an object that may
    // legitimately not exist yet"; the unscoped and platinum spellings read core tables, whose
    // absence must keep its telemetry and count toward the breaker.
    for (const [, , options] of calls.filter(([query]) => !query.includes('company_email_coverage'))) {
      expect(options).toBeUndefined();
    }
  });

  it('keeps serving events when the address table is unavailable', async () => {
    addEvent(EVENT, 99);
    addCompanyEmail('ada@company.example');
    addRegistration('ada@company.example', 'Ada Lovelace');
    addRegistration('someone@gmail.example', 'Someone Else');
    // Ungranted, mid-deploy, renamed — from this query's side they are the same failure.
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    // An org with events must not render as an org with none. The fallback drops the company-email
    // scoping and nothing else: the count is still recomputed at the drawer's grain, so the row and
    // the drawer it opens agree (2 and 2) rather than the row showing the stale precomputed 99.
    expect(list.data).toHaveLength(1);
    expect(list.data[0].orgAttendeeCount).toBe(2);
    expect(drawer.total).toBe(2);
  });

  it('caches zero-coverage results rather than querying live on every load', async () => {
    addEvent(EVENT, 99);
    addRegistration('someone@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    expect(list.data[0].orgAttendeeCount).toBe(1);

    // Refusing the write would make every load for such an org run the account-wide aggregate live —
    // a permanent cost on exactly the orgs the fallback exists for, to avoid a staleness window that
    // opens once, when coverage first lands, and closes within one TTL.
    expect([...cacheValues.keys()].filter((key) => key.includes('events:v2'))).toHaveLength(1);

    // The stored value is the answer itself, so the write was not merely attempted and discarded.
    const [storedKey] = [...cacheValues.keys()].filter((key) => key.includes('events:v2'));
    expect(JSON.parse(cacheValues.get(storedKey)!)).toHaveLength(1);
  });

  it('does not cache the unscoped fallback, for either surface', async () => {
    addEvent(EVENT, 99);
    addRegistration('ada@company.example', 'Ada Lovelace');
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');

    await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    // Asserted against the cache itself, not inferred from a later read: nothing was written, so a
    // refactor that moved the fallback inside the cached fetcher fails here rather than silently
    // serving unfiltered counts for the rest of the TTL.
    expect([...cacheValues.keys()]).toEqual([]);

    // Restored: the table was briefly unavailable, not gone. The scoped answer must come back on the
    // next read for both surfaces.
    database.exec('CREATE TABLE ORG_PEOPLE_COMPANY_EMAILS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT, EMAIL TEXT, IS_PRIMARY INTEGER)');
    addCompanyEmail('grace@company.example');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);
    const drawer = await service.getEventAttendees(REQ, ACCOUNT, EVENT);

    expect(list.data[0].orgAttendeeCount).toBe(0);
    expect(drawer.total).toBe(0);
    // And the scoped answers ARE cached, so the assertion above is about the fallback specifically.
    expect(cacheValues.size).toBe(2);
  });

  it('does not count an address made only of whitespace as coverage', async () => {
    addEvent(EVENT, 99);
    // Non-breaking space alone: blank once trimmed, so it cannot match anything and must not switch
    // the fallback off.
    addCompanyEmail('\u00a0');
    addRegistration('someone@gmail.example', 'Someone Else');

    const list = await service.getOrgEvents(REQ, ACCOUNT, LIST_OPTIONS);

    expect(list.data[0].orgAttendeeCount).toBe(1);
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
