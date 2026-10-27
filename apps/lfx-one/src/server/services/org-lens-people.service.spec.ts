// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { CompactOrgAllEmployeesRawCache, OrgPersonCompanyEmailsResponse } from '@lfx-one/shared/interfaces';
import { agreedUsername } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getLive, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  getLive: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/string.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-people-stats.utils')),
  // Real, not stubbed: the roster cache encodes and decodes through these on every read/write, so a
  // stub would make the round-trip assertions below vacuous.
  ...(await import('../../../../../packages/shared/src/utils/compact-cache.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/org-people.constants')),
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
  // Real, not stubbed: the roster guard validates the stored columns against these lists, so a
  // hand-written copy here would let a column-drift regression pass.
  ...(await import('../../../../../packages/shared/src/constants/org-cache-compact.constants')),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
vi.mock('./org-people-directory.service', () => ({
  OrgPeopleDirectoryService: class {
    public getLive = getLive;
  },
}));
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
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));

import { OrgLensPeopleService } from './org-lens-people.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

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
const LIVE_PERSON = 'live-access-mixeduser';
const GOVERNANCE_USERNAME = agreedUsername([' MixedUser ', 'mixeduser'])!;
const UNAVAILABLE: OrgPersonCompanyEmailsResponse = { companyEmails: [], companyEmailsStatus: 'unavailable' };
let database: SqlDatabase;
let service: OrgLensPeopleService;

function addPerson(account: string, personKey: string, username: string | null, emails: string[] = []): void {
  const insertEmail = database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)');
  for (const [index, email] of emails.entries()) {
    insertEmail.run(account, personKey, username, email, index === 0 ? 1 : 0);
  }
}

function addRosterRow(account: string, key: string, username: string): void {
  database.prepare('INSERT INTO ORG_PEOPLE_ALL VALUES (?, ?, ?)').run(account, key, username);
}

/** One ORG_PEOPLE_ALL_RANGES row: `commits` code contributions in `range`, foundation-two engaged. */
function addRangeRow(
  account: string,
  key: string,
  range: string,
  isFormer: boolean,
  username: string,
  name: string,
  email: string | null,
  commits: number
): void {
  database
    .prepare('INSERT INTO ORG_PEOPLE_ALL_RANGES VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(account, key, range, isFormer ? 1 : 0, key, username, null, name, null, email, null, 0, 0, 0, commits, 0, 0, '["foundation-two"]');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  cacheValues.clear();
  ValkeyService.resetInstance();
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE ORG_PEOPLE_COMPANY_EMAILS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT, EMAIL TEXT, IS_PRIMARY INTEGER)');
  database.exec('CREATE TABLE ORG_PEOPLE_ALL (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT)');
  // Per-range roster (lfx-self-serve#4163); empty unless a test adds someone.
  database.exec(`
    CREATE TABLE ORG_PEOPLE_ALL_RANGES (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, TIME_RANGE TEXT, IS_FORMER INTEGER, LFID TEXT, LF_USERNAME TEXT, CDP_MEMBER_ID TEXT,
      NAME TEXT, TITLE TEXT, EMAIL TEXT, PHOTO TEXT, SEATS_COUNT INTEGER, BOARD_SEATS_COUNT INTEGER, COMMITTEE_SEATS_COUNT INTEGER,
      COMMITS_COUNT INTEGER, EVENTS_COUNT INTEGER, COURSES_COUNT INTEGER, ENGAGED_FOUNDATION_IDS TEXT
    )
  `);
  // Run the service's real SQL against SQLite instead of mocking its identity matching.
  execute.mockImplementation(async (query: string, binds: string[]) => {
    const rows = database.prepare(query.replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')).all(...binds);
    for (const row of rows) {
      for (const column of ['IS_BOARD', 'IS_MAINTAINER', 'IS_SPEAKER']) {
        if (column in row) row[column] = row[column] === 1;
      }
    }
    return { rows };
  });
  getLive.mockResolvedValue({ rows: [{ personKey: LIVE_PERSON, lfUsername: 'mixeduser' }] });
  service = new OrgLensPeopleService();
});

afterEach(() => {
  database.close();
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

async function expectBothPaths(expected: OrgPersonCompanyEmailsResponse): Promise<void> {
  expect(await service.getCompanyEmailsByUsername(ACCOUNT, GOVERNANCE_USERNAME)).toEqual(expected);
  expect(await service.getCompanyEmails({} as never, ACCOUNT, LIVE_PERSON)).toEqual(expected);
}

describe('OrgLensPeopleService username company emails', () => {
  it('resolves preserved-case governance and lowercased live usernames to the same account-scoped person', async () => {
    addPerson(ACCOUNT, 'person-one', ' MiXeDuSeR ', ['z-primary@company.example', 'a-secondary@company.example']);
    addPerson('other-account', 'person-one', 'MIXEDUSER', ['other-employer@other.example']);
    addPerson(ACCOUNT, 'unrelated-person', 'someoneelse', ['unrelated@company.example']);

    await expectBothPaths({
      companyEmails: ['z-primary@company.example', 'a-secondary@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  it('reports a known identity without qualifying addresses as unavailable, never as none on record', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser');

    await expectBothPaths(UNAVAILABLE);
  });

  it('reports a failed lookup when the address table is unavailable', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');

    await expectBothPaths({ companyEmails: [], companyEmailsStatus: 'failed' });
  });

  it('fails closed for case-folded collisions between people with addresses', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    addPerson(ACCOUNT, 'person-two', 'mixeduser', ['second@company.example']);

    await expectBothPaths(UNAVAILABLE);
  });

  it('does not treat identities that exist only at another account as resolved', async () => {
    addPerson('other-account', 'person-one', 'MixedUser', ['other@other.example']);

    await expectBothPaths(UNAVAILABLE);
  });

  it('reads the address table only, never the identity spine view', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);

    await service.getCompanyEmailsByUsername(ACCOUNT, GOVERNANCE_USERNAME);

    for (const [query] of execute.mock.calls as [string][]) {
      expect(query).not.toMatch(/_ORG_PEOPLE_SPINE/i);
    }
  });

  it('does not resolve blank usernames to blank warehouse identities', async () => {
    addPerson(ACCOUNT, 'person-one', ' ', ['someone@company.example']);

    expect(await service.getCompanyEmailsByUsername(ACCOUNT, ' ')).toEqual(UNAVAILABLE);
  });

  it('reuses a normalized username result without rerunning the warehouse read and keeps other accounts separate', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    addPerson('other-account', 'person-two', 'mixeduser', ['other@other.example']);
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'MixedUser')).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
    expect(await service.getCompanyEmailsByUsername('other-account', 'MixedUser')).toEqual({
      companyEmails: ['other@other.example'],
      companyEmailsStatus: 'resolved',
    });
    const warehouseReads = execute.mock.calls.length;
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, ' mixeduser ')).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    // Per account: person-key lookup, former check, and the address result (both reads cache their answer).
    expect(cacheValues.size).toBe(6);
    for (const key of cacheValues.keys()) {
      expect(key.toLowerCase()).not.toContain('mixeduser');
    }
  });

  it('retries a failed username lookup instead of caching the outage', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    database.exec('ALTER TABLE ORG_PEOPLE_COMPANY_EMAILS RENAME TO SAVED_EMAILS');
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: [],
      companyEmailsStatus: 'failed',
    });
    database.exec('ALTER TABLE SAVED_EMAILS RENAME TO ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  it('reuses a stable unavailable result without turning it into another state', async () => {
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual(UNAVAILABLE);
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'MIXEDUSER')).toEqual(UNAVAILABLE);
  });

  it('rejects a cached failed or status-less response instead of replaying it', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser');
    for (const stale of [
      { companyEmails: [], companyEmailsStatus: 'failed' },
      { companyEmails: ['stale@company.example'] },
      { companyEmails: ['stale@company.example'], companyEmailsStatus: 'unavailable' },
    ]) {
      for (const key of cacheValues.keys()) cacheValues.set(key, JSON.stringify(stale));
      expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual({
        companyEmails: ['first@company.example'],
        companyEmailsStatus: 'resolved',
      });
    }
  });

  it('reports warehouse failures without claiming there are no addresses', async () => {
    execute.mockRejectedValue(new Error('warehouse unavailable'));

    await expectBothPaths({ companyEmails: [], companyEmailsStatus: 'failed' });
  });

  it("reads a roster person's addresses by person key, even when the address rows carry no username", async () => {
    addRosterRow(ACCOUNT, 'person-one', ' MixedUser ');
    addPerson(ACCOUNT, 'person-one', null, ['first@company.example']);

    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  it('reports a roster person without addresses as none on record, not unavailable', async () => {
    addRosterRow(ACCOUNT, 'person-one', 'MixedUser');

    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual({ companyEmails: [], companyEmailsStatus: 'resolved' });
  });
});

describe('OrgLensPeopleService person-key company emails', () => {
  const personKey = 'person-one';
  const activity = {
    boardSeats: [
      {
        committeeId: 'board-one',
        committeeName: 'Governing Board',
        foundationId: 'foundation-one',
        foundationName: 'Foundation One',
        committeeRole: 'Chair',
        votingStatus: 'Voting',
        isBoard: true,
      },
    ],
    committeeSeats: [
      {
        committeeId: 'committee-one',
        committeeName: 'Technical Committee',
        foundationId: 'foundation-one',
        foundationName: 'Foundation One',
        committeeRole: 'Member',
        votingStatus: 'Observer',
        isBoard: false,
      },
    ],
    code: [
      {
        projectId: 'project-one',
        projectName: 'Project One',
        foundationId: 'foundation-one',
        foundationName: 'Foundation One',
        totalCommits: 12,
        lastActivityDate: '2026-04-12',
        isMaintainer: true,
      },
    ],
    events: [
      {
        eventId: 'event-one',
        eventName: 'Community Summit',
        foundationId: 'foundation-one',
        foundationName: 'Foundation One',
        isSpeaker: true,
        eventsCount: 1,
        lastEventEndDate: '2026-04-10',
      },
    ],
    training: [
      {
        courseId: 'course-one',
        courseName: 'Project Fundamentals',
        status: 'Certified',
        certificationsCount: 1,
        coursesCount: 1,
      },
    ],
  };

  beforeEach(() => {
    database.exec(`
      CREATE TABLE ORG_PEOPLE_COMMITTEE_MEMBERSHIP (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, COMMITTEE_ID TEXT, COMMITTEE_NAME TEXT, COMMITTEE_TYPE TEXT,
        IS_BOARD INTEGER, COMMITTEE_ROLE TEXT, VOTING_STATUS TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT
      );
      CREATE TABLE ORG_PEOPLE_CODE_CONTRIBUTIONS (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, PROJECT_ID TEXT, PROJECT_NAME TEXT, FOUNDATION_ID TEXT,
        FOUNDATION_NAME TEXT, TOTAL_COMMITS INTEGER, IS_MAINTAINER INTEGER, LAST_ACTIVITY_DATE TEXT
      );
      CREATE TABLE ORG_PEOPLE_EVENTS (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, EVENT_ID TEXT, EVENT_NAME TEXT, EVENT_END_DATE TEXT,
        IS_SPEAKER INTEGER, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT
      );
      CREATE TABLE ORG_PEOPLE_TRAINING (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, COURSE_OR_CERT_ID TEXT, STATUS TEXT, COURSE_ID TEXT, COURSE_NAME TEXT
      );
    `);
    database
      .prepare('INSERT INTO ORG_PEOPLE_COMMITTEE_MEMBERSHIP VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'board-one', 'Governing Board', 'Board', 1, 'Chair', 'Voting Rep', 'foundation-one', 'Foundation One');
    database
      .prepare('INSERT INTO ORG_PEOPLE_COMMITTEE_MEMBERSHIP VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'committee-one', 'Technical Committee', 'Technical', 0, 'Member', 'Observer', 'foundation-one', 'Foundation One');
    database
      .prepare('INSERT INTO ORG_PEOPLE_CODE_CONTRIBUTIONS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'project-one', 'Project One', 'foundation-one', 'Foundation One', 12, 1, '2026-04-12');
    database
      .prepare('INSERT INTO ORG_PEOPLE_EVENTS VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'event-one', 'Community Summit', '2026-04-10', 1, 'foundation-one', 'Foundation One');
    database
      .prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'cert-one', 'Certified', 'course-one', 'Project Fundamentals');
  });

  it('answers unavailable for cdp: person keys without resolving addresses', async () => {
    addPerson(ACCOUNT, 'cdp:member-one', 'MixedUser', ['first@company.example']);

    expect(await service.getCompanyEmails({} as never, ACCOUNT, 'cdp:member-one')).toEqual(UNAVAILABLE);
  });

  it('returns activity without reading the address view', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['first@company.example']);

    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toEqual({ personKey, ...activity });
    const addressReads = (execute.mock.calls as [string][]).filter(([query]) => /ORG_PEOPLE_COMPANY_EMAILS/.test(query));
    expect(addressReads).toEqual([]);
  });

  it('returns only the keyed person and account addresses in primary-first alphabetical order', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['z-primary@company.example', 'b-secondary@company.example', 'a-secondary@company.example']);
    addPerson('other-account', personKey, 'MixedUser', ['other-employer@other.example']);
    addPerson(ACCOUNT, 'person-two', 'mixeduser', ['other-person@company.example']);

    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['z-primary@company.example', 'a-secondary@company.example', 'b-secondary@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  it('retries a failed email lookup instead of replaying the failure from cache', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['first@company.example']);
    database.exec('ALTER TABLE ORG_PEOPLE_COMPANY_EMAILS RENAME TO SAVED_EMAILS');
    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({ companyEmails: [], companyEmailsStatus: 'failed' });
    database.exec('ALTER TABLE SAVED_EMAILS RENAME TO ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  describe('former employees (lfx-self-serve#4311)', () => {
    const formerKey = 'person-former';

    beforeEach(() => {
      addRangeRow(ACCOUNT, formerKey, '12mo', true, 'leftuser', '[[Unknown]]', 'left@personal.example', 4);
      addRangeRow(ACCOUNT, formerKey, 'all', true, 'leftuser', '[[Unknown]]', 'left@personal.example', 4);
      database
        .prepare('INSERT INTO ORG_PEOPLE_CODE_CONTRIBUTIONS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ACCOUNT, formerKey, 'project-two', 'Project Two', 'foundation-two', 'Foundation Two', 4, 0, '2026-05-01');
    });

    it('returns former employees flagged as former, with tiles counted over them and the foundations of their code', async () => {
      const response = await service.getFormerEmployees(ACCOUNT, '12mo');

      expect(response.rows).toEqual([expect.objectContaining({ personKey: formerKey, commitsCount: 4, isFormer: true })]);
      expect(response.stats).toEqual({ activeInOss: 1, inGovernance: 0, codeContributors: 1, eventAttendees: 0, trainees: 0 });
      expect(response.foundations).toEqual([{ foundationId: 'foundation-two', foundationName: 'Foundation Two' }]);
    });

    it('reads only the former rows of the requested range, foundations included', async () => {
      addRangeRow(ACCOUNT, personKey, '30d', false, 'stayer', 'Still Here', 'stayer@company.example', 1);

      const response = await service.getFormerEmployees(ACCOUNT, '30d');

      expect(response.rows).toEqual([]);
      expect(response.foundations).toEqual([]);
      expect(response.stats.activeInOss).toBe(0);
    });

    it('never sends an address for a former employee, not even as the fallback for a placeholder name', async () => {
      const [formerRow] = (await service.getFormerEmployees(ACCOUNT, '12mo')).rows;

      expect(formerRow?.email).toBeNull();
      expect(formerRow?.name).toBe('Unknown member');
      expect(JSON.stringify(formerRow)).not.toContain('left@personal.example');
      const formerReads = (execute.mock.calls as [string][]).filter(([query]) => /IS_FORMER = TRUE/.test(query));
      expect(formerReads.length).toBeGreaterThan(0);
      for (const [query] of formerReads) {
        expect(query).not.toMatch(/^\s*EMAIL,/m);
      }
    });

    it('answers unavailable for a former employee by person key and by LF username, even when addresses are on record', async () => {
      addPerson(ACCOUNT, formerKey, 'leftuser', ['left@company.example']);

      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(UNAVAILABLE);
      expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'LeftUser')).toEqual(UNAVAILABLE);
    });

    it('checks the all-time former population, whatever range is on screen', async () => {
      database.exec(`DELETE FROM ORG_PEOPLE_ALL_RANGES WHERE TIME_RANGE <> 'all'`);
      addPerson(ACCOUNT, formerKey, 'leftuser', ['left@company.example']);

      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(UNAVAILABLE);
      const formerCheck = (execute.mock.calls as [string][]).find(([query]) => /SELECT 1 AS IS_FORMER/.test(query));
      expect(formerCheck?.[0]).toMatch(/TIME_RANGE = 'all' AND IS_FORMER = TRUE/);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-former-check:v2:${formerKey}`)!)).toBe(true);
    });

    it('does not remember a failed former check, so the next read applies the guard', async () => {
      addPerson(ACCOUNT, formerKey, 'leftuser', ['left@company.example']);
      database.exec('ALTER TABLE ORG_PEOPLE_ALL_RANGES RENAME TO SAVED_RANGES');
      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).not.toEqual(UNAVAILABLE);

      database.exec('ALTER TABLE SAVED_RANGES RENAME TO ORG_PEOPLE_ALL_RANGES');
      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(UNAVAILABLE);
    });
  });

  describe('current employees by time range (lfx-self-serve#4163)', () => {
    // The roster's foundation dropdown also reads the training foundations, which the detail fixture above omits.
    beforeEach(() => {
      database.exec('ALTER TABLE ORG_PEOPLE_TRAINING ADD COLUMN FOUNDATION_ID TEXT; ALTER TABLE ORG_PEOPLE_TRAINING ADD COLUMN FOUNDATION_NAME TEXT;');
    });

    it('reads only the current rows of the requested range and counts the tiles over them', async () => {
      addRangeRow(ACCOUNT, personKey, '30d', false, 'recent', 'Recent Person', 'recent@company.example', 3);
      addRangeRow(ACCOUNT, 'person-older', '12mo', false, 'older', 'Older Person', 'older@company.example', 5);
      addRangeRow(ACCOUNT, 'person-left', '30d', true, 'left', 'Left Person', null, 2);

      const response = await service.getAllEmployees(ACCOUNT, '30d');

      expect(response.rows.map((row) => row.personKey)).toEqual([personKey]);
      expect(response.stats).toEqual({ activeInOss: 1, inGovernance: 0, codeContributors: 1, eventAttendees: 0, trainees: 0 });
      const rosterRead = (execute.mock.calls as [string, string[]][]).find(([query]) => /ORG_PEOPLE_ALL_RANGES/.test(query));
      expect(rosterRead?.[0]).toContain('IS_FORMER = FALSE');
      expect(rosterRead?.[1]).toEqual([ACCOUNT, '30d']);
    });

    it('caches each range under its own key', async () => {
      addRangeRow(ACCOUNT, personKey, '30d', false, 'recent', 'Recent Person', 'recent@company.example', 3);
      addRangeRow(ACCOUNT, personKey, 'all', false, 'recent', 'Recent Person', 'recent@company.example', 9);

      expect((await service.getAllEmployees(ACCOUNT, '30d')).rows[0]?.commitsCount).toBe(3);
      expect((await service.getAllEmployees(ACCOUNT, 'all')).rows[0]?.commitsCount).toBe(9);
      await service.getFormerEmployees(ACCOUNT, '30d');
      await service.getFormerEmployees(ACCOUNT, 'all');

      for (const subResource of ['people-all:v3:30d', 'people-all:v3:all', 'people-former:v2:30d', 'people-former:v2:all']) {
        expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, subResource)!)).toBe(true);
      }
    });
  });

  describe('by LF username (lfx-self-serve-ops#894)', () => {
    it("resolves the username to its one roster person in this account and returns that person's activity", async () => {
      addRosterRow(ACCOUNT, personKey, ' MixedUser ');
      addRosterRow(ACCOUNT, 'person-two', 'someone-else');
      // The same username in another account never makes this account's lookup ambiguous.
      addRosterRow('other-account', 'person-three', 'mixeduser');

      expect(await service.getEmployeeDetailByUsername({} as never, ACCOUNT, 'MIXEDUSER')).toEqual({ personKey, ...activity });
    });

    it('fails closed without reading activity when the username matches no roster person or several', async () => {
      addRosterRow(ACCOUNT, personKey, 'shared');
      addRosterRow(ACCOUNT, 'person-two', 'shared');

      expect(await service.getEmployeeDetailByUsername({} as never, ACCOUNT, 'shared')).toBeNull();
      expect(await service.getEmployeeDetailByUsername({} as never, ACCOUNT, 'nobody')).toBeNull();
      expect(await service.getEmployeeDetailByUsername({} as never, ACCOUNT, '  ')).toBeNull();
      const activityReads = (execute.mock.calls as [string][]).filter(([query]) =>
        /ORG_PEOPLE_(COMMITTEE_MEMBERSHIP|CODE_CONTRIBUTIONS|EVENTS|TRAINING|COMPANY_EMAILS)/.test(query)
      );
      expect(activityReads).toEqual([]);
    });
  });
});

describe('OrgLensPeopleService roster wire shape (#2179)', () => {
  it('strips merge-only fields from the wire roster while the internal roster retains them', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          {
            PERSON_KEY: 'person-wire-user',
            LFID: null,
            LF_USERNAME: 'WireUser',
            CDP_MEMBER_ID: null,
            NAME: 'Wire User',
            TITLE: null,
            EMAIL: 'WireUser@Example.COM',
            PHOTO: null,
            SEATS_COUNT: 0,
            BOARD_SEATS_COUNT: 0,
            COMMITTEE_SEATS_COUNT: 0,
            COMMITS_COUNT: 0,
            EVENTS_COUNT: 0,
            COURSES_COUNT: 0,
            ENGAGED_FOUNDATION_IDS: [],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const wire = await service.getAllEmployees(ACCOUNT, '12mo');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(wire.rows).toHaveLength(1);
    expect(wire.rows[0]).not.toHaveProperty('emails');
    expect(wire.rows[0]).not.toHaveProperty('mergedFrom');
    expect(wire.rows[0].email).toBe('WireUser@Example.COM');

    // The internal accessor serves the same cached raw rows; merge-only fields survive for the live merge.
    const internal = await service.getAllEmployeesInternal(ACCOUNT, '12mo');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(internal.rows[0].emails).toEqual(['wireuser@example.com']);
  });
});

describe('OrgLensPeopleService roster compact cache (GH-1906)', () => {
  /** Two rows exercising both ENGAGED_FOUNDATION_IDS arrivals (the driver returns either) plus a null-heavy row. */
  function mockRoster(): void {
    execute
      .mockResolvedValueOnce({
        rows: [
          {
            ACCOUNT_ID: ACCOUNT,
            PERSON_KEY: 'person-one',
            LFID: 'lfid-one',
            LF_USERNAME: 'RosterUser',
            CDP_MEMBER_ID: 'cdp-1',
            NAME: 'Roster User',
            TITLE: 'Engineer',
            EMAIL: 'roster.user@example.com',
            PHOTO: 'https://avatars.example.com/roster.png',
            SEATS_COUNT: 2,
            BOARD_SEATS_COUNT: 1,
            COMMITTEE_SEATS_COUNT: 1,
            COMMITS_COUNT: 30,
            EVENTS_COUNT: 2,
            COURSES_COUNT: 1,
            ENGAGED_FOUNDATION_IDS: '["foundation-one","foundation-two"]',
          },
          {
            ACCOUNT_ID: ACCOUNT,
            PERSON_KEY: 'person-two',
            LFID: null,
            LF_USERNAME: null,
            CDP_MEMBER_ID: null,
            NAME: null,
            TITLE: null,
            EMAIL: null,
            PHOTO: null,
            SEATS_COUNT: 0,
            BOARD_SEATS_COUNT: 0,
            COMMITTEE_SEATS_COUNT: 0,
            COMMITS_COUNT: 0,
            EVENTS_COUNT: 0,
            COURSES_COUNT: 0,
            ENGAGED_FOUNDATION_IDS: ['foundation-one'],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ FOUNDATION_ID: 'foundation-one', FOUNDATION_NAME: 'Foundation One' }] });
  }

  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    mockRoster();
    const fromMiss = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    // Second call reads the entry the first one wrote, through the real serialize/parse round trip
    // the in-memory Valkey fixture performs.
    const fromHit = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    // `toStrictEqual` distinguishes null from undefined from an absent key — the distinction this
    // exercises via `accessBadge`, which is optional and unset on a stored-only roster row. The
    // serialized comparison additionally pins key order, which `mapEmployeeRow`'s object literal
    // fixes and a decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(2);
    // Tiles are counted over the rows, so a cache hit recomputes the same numbers.
    expect(fromHit.stats).toEqual({ activeInOss: 1, inGovernance: 1, codeContributors: 1, eventAttendees: 1, trainees: 1 });
    // ENGAGED_FOUNDATION_IDS must parse identically whichever way the driver returned it — the
    // column is stored verbatim, so a decode that normalized it would show up here.
    expect(fromHit.rows.map((row) => row.engagedFoundationIds)).toEqual([['foundation-one', 'foundation-two'], ['foundation-one']]);
    // ACCOUNT_ID is hoisted off every row at encode; a decode that forgot to put it back would
    // leave the stored rows unusable for anything keyed on it.
    const stored = JSON.parse([...cacheValues.values()][0]) as CompactOrgAllEmployeesRawCache;
    expect(stored.accountId).toBe(ACCOUNT);
    expect(stored.rowsRaw.k).not.toContain('ACCOUNT_ID');
  });

  it('treats a stored roster whose LF_USERNAME is not a string as a miss, not a 500', async () => {
    // Exact columns prove the shape, not the value. A current-shape entry holding a number there
    // reaches `mapEmployeeRow`, which calls `.trim()` on it — so without this check a cache HIT
    // becomes a 500 rather than a miss.
    mockRoster();
    await service.getAllEmployeesInternal(ACCOUNT, '12mo');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgAllEmployeesRawCache;
    const usernameIndex = stored.rowsRaw.k.indexOf('LF_USERNAME');
    stored.rowsRaw.r = stored.rowsRaw.r.map((row) => row.map((cell, index) => (index === usernameIndex ? 42 : cell)));
    cacheValues.set(key, JSON.stringify(stored));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    expect(response.rows.map((row) => row.lfUsername)).toEqual(['rosteruser', null]);
  });

  it('rejects a stored roster whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a roster with
    // holes in it — silently dropping LF_USERNAME returns the directory to email-only matching.
    mockRoster();
    await service.getAllEmployeesInternal(ACCOUNT, '12mo');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgAllEmployeesRawCache;
    stored.rowsRaw.k = stored.rowsRaw.k.filter((column) => column !== 'LF_USERNAME');
    cacheValues.set(key, JSON.stringify(stored));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    expect(response.rows.map((row) => row.lfUsername)).toEqual(['rosteruser', null]);
  });

  it('round-trips an empty roster unchanged', async () => {
    // The empty envelope has to survive its own guard — `accountId` is null with no rows to hoist
    // it from — or an org with no roster would refetch on every request forever.
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    const fromHit = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  it('treats a pre-compaction cached roster as a miss rather than decoding it', async () => {
    // The shape guard, not just the key bump, has to reject this: decoding an array as a
    // `ColumnarTable` would read `k`/`r` off it and serve an empty roster for the whole TTL.
    const legacy = { rowsRaw: [{ PERSON_KEY: 'stale-person', LF_USERNAME: 'stale' }], foundationRaw: [] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-all:v3:12mo')!, JSON.stringify(legacy));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '12mo');

    expect(response.rows.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});
