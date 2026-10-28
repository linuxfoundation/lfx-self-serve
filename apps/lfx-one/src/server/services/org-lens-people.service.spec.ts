// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { CompactOrgAllEmployeesRawCache, OrgCommitFilters, OrgPersonCompanyEmailsResponse } from '@lfx-one/shared/interfaces';
import { agreedUsername } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getLive, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  getLive: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/string.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-people-stats.utils')),
  // Real, not stubbed: the roster cache encodes and decodes through these on every read/write, so a
  // stub would make the round-trip assertions below vacuous.
  ...(await import('../../../../../packages/shared/src/utils/compact-cache.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-commit-filters.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/org-people.constants')),
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
  // Real, not stubbed: the roster guard validates the stored columns against these lists, so a
  // hand-written copy here would let a column-drift regression pass.
  ...(await import('../../../../../packages/shared/src/constants/org-cache-compact.constants')),
  ...(await import('../../../../../packages/shared/src/constants/org-commit-filters.constants')),
  ...(await import('../../../../../packages/shared/src/constants/org-maintainer-roles.constants')),
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

import { orgTrainingEnrolledWindowPredicate } from '../helpers/org-training-sql.helper';
import { logger } from './logger.service';
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
const REQ = {} as never;
const FILTERS: OrgCommitFilters = { projectScope: 'all', commitScope: 'all', metric: 'commits' };
const LIVE_PERSON = 'live-access-mixeduser';
const GOVERNANCE_USERNAME = agreedUsername([' MixedUser ', 'mixeduser'])!;
const UNAVAILABLE: OrgPersonCompanyEmailsResponse = { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'unavailable' };
const FAILED: OrgPersonCompanyEmailsResponse = { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'failed' };
/** SQLite reading of the Snowflake enrollment window, so the detail read's real SQL runs here too. */
const SQLITE_ENROLLED_WINDOW = `date(ACTIVITY_TS) >= date('now', '-12 months') AND date(ACTIVITY_TS) < date('now')`;
// SQLite form of the bound range start in the maintainer roles overlap predicate.
const SQLITE_DAYS_BEFORE_TODAY = "date('now', '-' || ? || ' days')";
let database: SqlDatabase;
let service: OrgLensPeopleService;

function addPerson(account: string, personKey: string, username: string | null, emails: string[] = []): void {
  const insertEmail = database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)');
  for (const [index, email] of emails.entries()) {
    insertEmail.run(account, personKey, username, email, index === 0 ? 1 : 0);
  }
}

/** `YYYY-MM-DD`, `days` before today (UTC, as SQLite's `date('now')`). */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function addDailyCode(account: string, key: string, activityDate: string, foundationId: string, foundationName: string, isLfProject = 1): void {
  database
    .prepare('INSERT INTO ORG_PEOPLE_CONTRIBUTORS_DAILY VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(account, key, `project-${foundationId}`, activityDate, foundationId, foundationName, isLfProject);
}

function addRosterRow(account: string, key: string, username: string): void {
  database.prepare('INSERT INTO ORG_PEOPLE_ALL (ACCOUNT_ID, PERSON_KEY, LF_USERNAME) VALUES (?, ?, ?)').run(account, key, username);
}

/**
 * One ORG_PEOPLE_ALL_RANGES row: `commits` authored commits in `range` and `projectScope` (merged commits and code
 * activities default to the same number unless given), foundation-two engaged.
 */
function addRangeRow(
  account: string,
  key: string,
  range: string,
  isFormer: boolean,
  username: string,
  name: string,
  email: string | null,
  commits: number,
  counts: { projectScope?: string; merged?: number; code?: number } = {}
): void {
  database
    .prepare(
      `INSERT INTO ORG_PEOPLE_ALL_RANGES (
        ACCOUNT_ID, PERSON_KEY, TIME_RANGE, PROJECT_SCOPE, IS_FORMER, LFID, LF_USERNAME, CDP_MEMBER_ID, NAME, TITLE, EMAIL, PHOTO,
        SEATS_COUNT, BOARD_SEATS_COUNT, COMMITTEE_SEATS_COUNT, COMMITS_COUNT, MERGED_COMMITS_COUNT, CODE_ACTIVITIES_COUNT,
        EVENTS_COUNT, COURSES_COUNT, ENGAGED_FOUNDATION_IDS
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      account,
      key,
      range,
      counts.projectScope ?? 'all',
      isFormer ? 1 : 0,
      key,
      username,
      null,
      name,
      null,
      email,
      null,
      0,
      0,
      0,
      commits,
      counts.merged ?? commits,
      counts.code ?? commits,
      0,
      0,
      '["foundation-two"]'
    );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  cacheValues.clear();
  ValkeyService.resetInstance();
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE ORG_PEOPLE_COMPANY_EMAILS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT, EMAIL TEXT, IS_PRIMARY INTEGER)');
  // Unranged roster (the reassign pickers' read, and the username → person-key lookup).
  database.exec(`
    CREATE TABLE ORG_PEOPLE_ALL (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, LFID TEXT, LF_USERNAME TEXT, CDP_MEMBER_ID TEXT, NAME TEXT, TITLE TEXT, EMAIL TEXT,
      PHOTO TEXT, SEATS_COUNT INTEGER, BOARD_SEATS_COUNT INTEGER, COMMITTEE_SEATS_COUNT INTEGER, COMMITS_COUNT INTEGER,
      EVENTS_COUNT INTEGER, COURSES_COUNT INTEGER, ENGAGED_FOUNDATION_IDS TEXT
    )
  `);
  // Per-range, per-project-scope roster (lfx-self-serve#4163, #4164); empty unless a test adds someone.
  database.exec(`
    CREATE TABLE ORG_PEOPLE_ALL_RANGES (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, TIME_RANGE TEXT, PROJECT_SCOPE TEXT, IS_FORMER INTEGER, LFID TEXT, LF_USERNAME TEXT,
      CDP_MEMBER_ID TEXT, NAME TEXT, TITLE TEXT, EMAIL TEXT, PHOTO TEXT, SEATS_COUNT INTEGER, BOARD_SEATS_COUNT INTEGER,
      COMMITTEE_SEATS_COUNT INTEGER, COMMITS_COUNT INTEGER, MERGED_COMMITS_COUNT INTEGER, CODE_ACTIVITIES_COUNT INTEGER,
      EVENTS_COUNT INTEGER, COURSES_COUNT INTEGER, ENGAGED_FOUNDATION_IDS TEXT
    )
  `);
  // Run the service's real SQL against SQLite instead of mocking its identity matching.
  execute.mockImplementation(async (query: string, binds: string[]) => {
    const rows = database
      .prepare(
        query
          .replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')
          .replaceAll(orgTrainingEnrolledWindowPredicate(), SQLITE_ENROLLED_WINDOW)
          .replaceAll('DATEADD(day, 0 - ?, CURRENT_DATE())', SQLITE_DAYS_BEFORE_TODAY)
          .replaceAll('CURRENT_DATE()', "date('now')")
      )
      .all(...binds);
    for (const row of rows) {
      for (const column of ['IS_BOARD', 'IS_SPEAKER']) {
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
  expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, GOVERNANCE_USERNAME)).toEqual(expected);
  expect(await service.getCompanyEmails({} as never, ACCOUNT, LIVE_PERSON)).toEqual(expected);
}

describe('OrgLensPeopleService username company emails', () => {
  it('resolves preserved-case governance and lowercased live usernames to the same account-scoped person', async () => {
    addPerson(ACCOUNT, 'person-one', ' MiXeDuSeR ', ['z-primary@company.example', 'a-secondary@company.example']);
    addPerson('other-account', 'person-one', 'MIXEDUSER', ['other-employer@other.example']);
    addPerson(ACCOUNT, 'unrelated-person', 'someoneelse', ['unrelated@company.example']);

    await expectBothPaths({
      companyEmails: ['z-primary@company.example', 'a-secondary@company.example'],
      primaryEmail: 'z-primary@company.example',
      companyEmailsStatus: 'resolved',
    });
  });

  // Ranges are nested, so someone live-only in the range on screen is live-only in 30d too, while the all
  // range may hold a stored row for them instead — their `live-` key is then only in the 30d directory.
  it('resolves a live-only key on the 30d directory, where a wider range would hold a stored row instead', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    getLive.mockImplementation(async (_req: unknown, _account: string, range: string | null) => ({
      rows: [range === '30d' ? { personKey: LIVE_PERSON, lfUsername: 'mixeduser' } : { personKey: 'person-one', lfUsername: 'mixeduser' }],
    }));

    expect(await service.getCompanyEmails({} as never, ACCOUNT, LIVE_PERSON)).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
      primaryEmail: 'first@company.example',
    });
  });

  // Live-only rows are listed under All and LF projects only (Non-LF lists stored people alone), and the LF roster is
  // inside All, so the 30d LF directory is the one probe.
  it('probes only the 30d LF directory, since the Non-LF one lists no live-only row', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    getLive.mockResolvedValue({ rows: [{ personKey: 'person-one', lfUsername: 'mixeduser' }] });

    expect(await service.getCompanyEmails({} as never, ACCOUNT, LIVE_PERSON)).toEqual(UNAVAILABLE);
    expect(getLive.mock.calls.map(([, , range, filters]) => [range, (filters as OrgCommitFilters).projectScope])).toEqual([['30d', 'lf']]);
  });

  // The page has just filled the directory it shows; reading that one is a cache hit, while the 30d probes would each be
  // a cold full merge of the live sources.
  it('resolves a live-only key on the directory the drawer was opened from, without the 30d probes', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    getLive.mockResolvedValue({ rows: [{ personKey: LIVE_PERSON, lfUsername: 'mixeduser' }] });

    expect(await service.getCompanyEmails({} as never, ACCOUNT, LIVE_PERSON, { range: '365d', projectScope: 'all' })).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
      primaryEmail: 'first@company.example',
    });
    expect(getLive.mock.calls.map(([, , range, filters]) => [range, (filters as OrgCommitFilters).projectScope])).toEqual([['365d', 'all']]);
  });

  it('falls back to the 30d probes when the directory the drawer was opened from no longer lists the key', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    getLive.mockImplementation(async (_req: unknown, _account: string, range: string) => ({
      rows: range === '30d' ? [{ personKey: LIVE_PERSON, lfUsername: 'mixeduser' }] : [],
    }));

    expect(await service.getCompanyEmails({} as never, ACCOUNT, LIVE_PERSON, { range: '90d', projectScope: 'non_lf' })).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
      primaryEmail: 'first@company.example',
    });
    expect(getLive.mock.calls.map(([, , range, filters]) => [range, (filters as OrgCommitFilters).projectScope])).toEqual([
      ['90d', 'non_lf'],
      ['30d', 'lf'],
    ]);
  });

  it('reports a known identity without qualifying addresses as unavailable, never as none on record', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser');

    await expectBothPaths(UNAVAILABLE);
  });

  it('reports a failed lookup when the address table is unavailable', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');

    await expectBothPaths(FAILED);
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

    await service.getCompanyEmailsByUsername(REQ, ACCOUNT, GOVERNANCE_USERNAME);

    for (const [query] of execute.mock.calls as [string][]) {
      expect(query).not.toMatch(/_ORG_PEOPLE_SPINE/i);
    }
  });

  it('does not resolve blank usernames to blank warehouse identities', async () => {
    addPerson(ACCOUNT, 'person-one', ' ', ['someone@company.example']);

    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, ' ')).toEqual(UNAVAILABLE);
  });

  it('reuses a normalized username result without rerunning the warehouse read and keeps other accounts separate', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    addPerson('other-account', 'person-two', 'mixeduser', ['other@other.example']);
    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'MixedUser')).toEqual({
      companyEmails: ['first@company.example'],
      primaryEmail: 'first@company.example',
      companyEmailsStatus: 'resolved',
    });
    expect(await service.getCompanyEmailsByUsername(REQ, 'other-account', 'MixedUser')).toEqual({
      companyEmails: ['other@other.example'],
      primaryEmail: 'other@other.example',
      companyEmailsStatus: 'resolved',
    });
    const warehouseReads = execute.mock.calls.length;
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, ' mixeduser ')).toEqual({
      companyEmails: ['first@company.example'],
      primaryEmail: 'first@company.example',
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
    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: [],
      primaryEmail: null,
      companyEmailsStatus: 'failed',
    });
    database.exec('ALTER TABLE SAVED_EMAILS RENAME TO ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: ['first@company.example'],
      primaryEmail: 'first@company.example',
      companyEmailsStatus: 'resolved',
    });
  });

  it('reuses a stable unavailable result without turning it into another state', async () => {
    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual(UNAVAILABLE);
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'MIXEDUSER')).toEqual(UNAVAILABLE);
  });

  it('rejects a cached failed or status-less response instead of replaying it', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser');
    for (const stale of [
      { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'failed' },
      { companyEmails: ['stale@company.example'] },
      { companyEmails: ['stale@company.example'], companyEmailsStatus: 'unavailable' },
    ]) {
      for (const key of cacheValues.keys()) cacheValues.set(key, JSON.stringify(stale));
      expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual({
        companyEmails: ['first@company.example'],
        primaryEmail: 'first@company.example',
        companyEmailsStatus: 'resolved',
      });
    }
  });

  it('replays a cache entry written before primaryEmail existed, reading it as no primary on record', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser');
    for (const key of cacheValues.keys()) {
      cacheValues.set(key, JSON.stringify({ companyEmails: ['cached@company.example'], companyEmailsStatus: 'resolved' }));
    }

    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: ['cached@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  it('reports warehouse failures without claiming there are no addresses', async () => {
    execute.mockRejectedValue(new Error('warehouse unavailable'));

    await expectBothPaths(FAILED);
  });

  it("reads a roster person's addresses by person key, even when the address rows carry no username", async () => {
    addRosterRow(ACCOUNT, 'person-one', ' MixedUser ');
    addPerson(ACCOUNT, 'person-one', null, ['first@company.example']);

    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: ['first@company.example'],
      primaryEmail: 'first@company.example',
      companyEmailsStatus: 'resolved',
    });
  });

  it('reports a roster person without addresses as none on record, not unavailable', async () => {
    addRosterRow(ACCOUNT, 'person-one', 'MixedUser');

    expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: [],
      primaryEmail: null,
      companyEmailsStatus: 'resolved',
    });
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
        commits: 12,
        lastActivityDate: '2026-04-12',
        isMaintainer: true,
      },
    ],
    totalCommits: 12,
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
        FOUNDATION_NAME TEXT, TOTAL_COMMITS INTEGER, PROJECT_COMMITS INTEGER, LAST_ACTIVITY_DATE TEXT
      );
      CREATE TABLE ORG_MAINTAINER_ROLES (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, MEMBER_ID TEXT, SEGMENT_ID TEXT, PROJECT_ID TEXT, ROLE_START_DATE TEXT, ROLE_END_DATE TEXT
      );
      CREATE TABLE ORG_PEOPLE_EVENTS (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, EVENT_ID TEXT, EVENT_NAME TEXT, EVENT_END_DATE TEXT,
        IS_SPEAKER INTEGER, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT
      );
      CREATE TABLE ORG_PEOPLE_TRAINING (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, COURSE_OR_CERT_ID TEXT, STATUS TEXT, COURSE_ID TEXT, COURSE_NAME TEXT, ACTIVITY_TS TEXT
      );
      CREATE TABLE ORG_PEOPLE_CONTRIBUTORS_DAILY (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, PROJECT_ID TEXT, ACTIVITY_DATE TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT, IS_LF_PROJECT INTEGER
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
      .run(ACCOUNT, personKey, 'project-one', 'Project One', 'foundation-one', 'Foundation One', 12, 12, '2026-04-12');
    // An open role with the unknown-start sentinel: the person maintains project-one in every range.
    database
      .prepare('INSERT INTO ORG_MAINTAINER_ROLES VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'member-one', 'segment-one', 'project-one', '2000-01-01', null);
    database
      .prepare('INSERT INTO ORG_PEOPLE_EVENTS VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'event-one', 'Community Summit', '2026-04-10', 1, 'foundation-one', 'Foundation One');
    database
      .prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'cert-one', 'Certified', 'course-one', 'Project Fundamentals', '2026-04-01');
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

  it('lists certificates of any age but enrollments from the last 12 months only, today excluded', async () => {
    const insert = database.prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run(ACCOUNT, personKey, 'cert-old', 'Certified', 'course-old-cert', 'Old Certificate', daysAgo(1500));
    insert.run(ACCOUNT, personKey, 'enroll-recent', 'Enrolled', 'course-recent', 'Recent Enrollment', daysAgo(30));
    insert.run(ACCOUNT, personKey, 'enroll-old', 'Enrolled', 'course-old', 'Old Enrollment', daysAgo(500));
    insert.run(ACCOUNT, personKey, 'enroll-today', 'Enrolled', 'course-today', 'Today Enrollment', daysAgo(0));

    const detail = await service.getEmployeeDetail({} as never, ACCOUNT, personKey);

    expect(detail.training.map((row) => [row.courseId, row.status]).sort()).toEqual([
      ['course-old-cert', 'Certified'],
      ['course-one', 'Certified'],
      ['course-recent', 'Enrolled'],
    ]);
    expect(detail.training[0]?.coursesCount).toBe(3);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail:v4:${personKey}`)!)).toBe(true);
  });

  it('shows one row per course, a certificate superseding a later re-enrollment, and counts the rows shown', async () => {
    const insert = database.prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run(ACCOUNT, personKey, 'cert-two', 'Certified', 'course-two', 'Course Two', daysAgo(400));
    insert.run(ACCOUNT, personKey, 'enroll-two', 'Enrolled', 'course-two', 'Course Two', daysAgo(30));
    insert.run(ACCOUNT, personKey, 'enroll-three', 'Enrolled', null, 'Course Three', daysAgo(20));
    insert.run(ACCOUNT, personKey, 'enroll-three', 'Enrolled', null, 'Course Three', daysAgo(10));

    const { training } = await service.getEmployeeDetail({} as never, ACCOUNT, personKey);

    expect(training.map((row) => [row.courseId, row.status]).sort()).toEqual([
      ['course-one', 'Certified'],
      ['course-two', 'Certified'],
      ['enroll-three', 'Enrolled'],
    ]);
    for (const row of training) {
      expect(row.coursesCount).toBe(3);
      expect(row.certificationsCount).toBe(2);
    }
  });

  it("counts a mirrored commit in every project's row and once in the total", async () => {
    // 3 commits only in project-one, 4 more mirrored into project-two: credit 7 + 0, distinct per project 7 and 4.
    database.exec('DELETE FROM ORG_PEOPLE_CODE_CONTRIBUTIONS');
    const insert = database.prepare('INSERT INTO ORG_PEOPLE_CODE_CONTRIBUTIONS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run(ACCOUNT, personKey, 'project-one', 'Project One', 'foundation-one', 'Foundation One', 7, 7, '2026-04-12');
    insert.run(ACCOUNT, personKey, 'project-two', 'Project Two', 'foundation-one', 'Foundation One', 0, 4, '2026-04-11');

    const detail = await service.getEmployeeDetail({} as never, ACCOUNT, personKey);

    expect(detail.code.map((row) => [row.projectId, row.commits])).toEqual([
      ['project-one', 7],
      ['project-two', 4],
    ]);
    expect(detail.totalCommits).toBe(7);
  });

  it('marks a code project Maintainer when the person holds a role on it overlapping the range, 365 days by default', async () => {
    database.exec('DELETE FROM ORG_MAINTAINER_ROLES');
    database
      .prepare('INSERT INTO ORG_PEOPLE_CODE_CONTRIBUTIONS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'project-two', 'Project Two', 'foundation-one', 'Foundation One', 2, 2, '2026-04-11');
    const insert = database.prepare('INSERT INTO ORG_MAINTAINER_ROLES VALUES (?, ?, ?, ?, ?, ?, ?)');
    // Ended 200 days ago: inside the past 365 days and all time, outside the past 90 days.
    insert.run(ACCOUNT, personKey, 'member-one', 'segment-one', 'project-one', daysAgo(900), daysAgo(200));
    // Not started yet, another person's role, another account's role: never this person's pill.
    insert.run(ACCOUNT, personKey, 'member-one', 'segment-two', 'project-two', daysAgo(-10), null);
    insert.run(ACCOUNT, 'person-two', 'member-two', 'segment-two', 'project-two', daysAgo(900), null);
    insert.run('other-account', personKey, 'member-one', 'segment-two', 'project-two', daysAgo(900), null);
    const pills = async (range?: '90d' | 'all'): Promise<[string, boolean][]> =>
      (await service.getEmployeeDetail({} as never, ACCOUNT, personKey, range)).code.map((row) => [row.projectId, row.isMaintainer]);

    expect(await pills()).toEqual([
      ['project-one', true],
      ['project-two', false],
    ]);
    expect(await pills('90d')).toEqual([
      ['project-one', false],
      ['project-two', false],
    ]);
    expect(await pills('all')).toEqual([
      ['project-one', true],
      ['project-two', false],
    ]);
    const roleReads = (execute.mock.calls as [string, unknown[]][]).filter(([query]) => query.includes('ORG_MAINTAINER_ROLES'));
    expect(roleReads.map(([, binds]) => binds)).toEqual([
      [ACCOUNT, personKey, 365],
      [ACCOUNT, personKey, 90],
      [ACCOUNT, personKey],
    ]);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail-roles:v1:${personKey}:90d`)!)).toBe(true);
  });

  it('returns only the keyed person and account addresses in primary-first alphabetical order', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['z-primary@company.example', 'b-secondary@company.example', 'a-secondary@company.example']);
    addPerson('other-account', personKey, 'MixedUser', ['other-employer@other.example']);
    addPerson(ACCOUNT, 'person-two', 'mixeduser', ['other-person@company.example']);

    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['z-primary@company.example', 'a-secondary@company.example', 'b-secondary@company.example'],
      primaryEmail: 'z-primary@company.example',
      companyEmailsStatus: 'resolved',
    });
  });

  it('keeps the flagged primary first when another address has no IS_PRIMARY value', async () => {
    // Snowflake sorts NULL above non-NULL on DESC, so without NULLS LAST the unflagged address leads
    // and `companyEmails[0]` stops being the primary the contract promises.
    database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)').run(ACCOUNT, personKey, 'MixedUser', 'a-unflagged@company.example', null);
    database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)').run(ACCOUNT, personKey, 'MixedUser', 'z-primary@company.example', 1);

    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['z-primary@company.example', 'a-unflagged@company.example'],
      primaryEmail: 'z-primary@company.example',
      companyEmailsStatus: 'resolved',
    });

    // The row assertion above cannot catch this on its own: SQLite already sorts NULLs last on DESC,
    // so it passes either way. Snowflake does the opposite, so the clause itself is what is pinned.
    const addressQueries = (execute.mock.calls as [string][]).map(([query]) => query).filter((query) => /ORG_PEOPLE_COMPANY_EMAILS/.test(query));
    expect(addressQueries.length).toBeGreaterThan(0);
    for (const query of addressQueries) {
      expect(query).toMatch(/ORDER BY\s+(?:\w+\.)?IS_PRIMARY DESC NULLS LAST/);
    }
  });

  it('pins NULLS LAST on the username-keyed address query too', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    addPerson(ACCOUNT, 'person-two', 'mixeduser', ['second@company.example']);

    // Two people collide on the folded username, so this falls through to the username-keyed query.
    await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'MixedUser');

    const usernameQuery = (execute.mock.calls as [string][]).map(([query]) => query).find((query) => /resolved_person/.test(query));
    expect(usernameQuery).toMatch(/ORDER BY\s+emails\.IS_PRIMARY DESC NULLS LAST/);
  });

  it('retries a failed email lookup instead of replaying the failure from cache', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['first@company.example']);
    database.exec('ALTER TABLE ORG_PEOPLE_COMPANY_EMAILS RENAME TO SAVED_EMAILS');
    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({ companyEmails: [], primaryEmail: null, companyEmailsStatus: 'failed' });
    database.exec('ALTER TABLE SAVED_EMAILS RENAME TO ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['first@company.example'],
      primaryEmail: 'first@company.example',
      companyEmailsStatus: 'resolved',
    });
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getCompanyEmails({} as never, ACCOUNT, personKey)).toEqual({
      companyEmails: ['first@company.example'],
      primaryEmail: 'first@company.example',
      companyEmailsStatus: 'resolved',
    });
  });

  describe('former employees (lfx-self-serve#4311)', () => {
    const formerKey = 'person-former';

    beforeEach(() => {
      addRangeRow(ACCOUNT, formerKey, '365d', true, 'leftuser', '[[Unknown]]', 'left@personal.example', 4);
      addRangeRow(ACCOUNT, formerKey, 'all', true, 'leftuser', '[[Unknown]]', 'left@personal.example', 4);
      addDailyCode(ACCOUNT, formerKey, '2026-05-01', 'foundation-two', 'Foundation Two');
    });

    it('returns former employees flagged as former, with tiles counted over them and the foundations of their code', async () => {
      const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS);

      expect(response.rows).toEqual([expect.objectContaining({ personKey: formerKey, commitsCount: 4, isFormer: true })]);
      expect(response.stats).toEqual({ activeInOss: 1, inGovernance: 0, codeContributors: 1, eventAttendees: 0, trainees: 0 });
      expect(response.foundations).toEqual([{ foundationId: 'foundation-two', foundationName: 'Foundation Two' }]);
    });

    it('labels the All Time foundations of code older than a year', async () => {
      addRangeRow(ACCOUNT, 'person-long-gone', 'all', true, 'longgone', 'Long Gone', null, 2);
      addDailyCode(ACCOUNT, 'person-long-gone', '2023-03-01', 'foundation-old', 'Foundation Old');

      const response = await service.getFormerEmployees(REQ, ACCOUNT, 'all', FILTERS);

      expect(response.foundations).toEqual([
        { foundationId: 'foundation-old', foundationName: 'Foundation Old' },
        { foundationId: 'foundation-two', foundationName: 'Foundation Two' },
      ]);
    });

    it('reads only the former rows of the requested range, foundations included', async () => {
      addRangeRow(ACCOUNT, personKey, '30d', false, 'stayer', 'Still Here', 'stayer@company.example', 1);

      const response = await service.getFormerEmployees(REQ, ACCOUNT, '30d', FILTERS);

      expect(response.rows).toEqual([]);
      expect(response.foundations).toEqual([]);
      expect(response.stats.activeInOss).toBe(0);
    });

    it('never sends an address for a former employee, not even as the fallback for a placeholder name', async () => {
      const [formerRow] = (await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS)).rows;

      expect(formerRow?.email).toBeNull();
      expect(formerRow?.name).toBe('Unknown member');
      expect(JSON.stringify(formerRow)).not.toContain('left@personal.example');
      const formerReads = (execute.mock.calls as [string][]).filter(([query]) => /IS_FORMER = TRUE/.test(query));
      expect(formerReads.length).toBeGreaterThan(0);
      for (const [query] of formerReads) {
        expect(query).not.toMatch(/^\s*EMAIL,/m);
      }
    });

    it('never sends a title or an address-shaped name for a former employee', async () => {
      addRangeRow(ACCOUNT, 'former-address-name', '365d', true, 'addressuser', 'gone@personal.example', null, 4);

      const formerRow = (await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS)).rows.find((row) => row.lfUsername === 'addressuser');

      expect(formerRow?.name).toBe('addressuser');
      expect(formerRow?.title).toBeNull();
      const formerRead = (execute.mock.calls as [string][]).find(([query]) => /IS_FORMER = TRUE/.test(query) && /ENGAGED_FOUNDATION_IDS/.test(query));
      expect(formerRead?.[0]).toMatch(/NULL AS TITLE/);
    });

    it('answers unavailable for a former employee by person key and by LF username, even when addresses are on record', async () => {
      addPerson(ACCOUNT, formerKey, 'leftuser', ['left@company.example']);

      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(UNAVAILABLE);
      expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'LeftUser')).toEqual(UNAVAILABLE);
    });

    it('checks the all-time former population across all projects, whatever range and scope are on screen', async () => {
      database.exec(`DELETE FROM ORG_PEOPLE_ALL_RANGES WHERE TIME_RANGE <> 'all'`);
      addPerson(ACCOUNT, formerKey, 'leftuser', ['left@company.example']);

      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(UNAVAILABLE);
      const formerCheck = (execute.mock.calls as [string][]).find(([query]) => /SELECT 1 AS IS_FORMER/.test(query));
      expect(formerCheck?.[0]).toMatch(/TIME_RANGE = 'all' AND PROJECT_SCOPE = 'all' AND IS_FORMER = TRUE/);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-former-check:v3:${formerKey}`)!)).toBe(true);
    });

    it('reads the former rows of the requested project scope, with the foundations of code in that scope', async () => {
      addRangeRow(ACCOUNT, 'person-non-lf', '365d', true, 'nonlf', 'Non Lf', null, 7, { projectScope: 'non_lf' });
      addDailyCode(ACCOUNT, 'person-non-lf', '2026-05-01', 'foundation-x', 'Foundation X', 0);

      const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', { ...FILTERS, projectScope: 'non_lf' });

      expect(response.rows.map((row) => row.personKey)).toEqual(['person-non-lf']);
      expect(response.foundations).toEqual([{ foundationId: 'foundation-x', foundationName: 'Foundation X' }]);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:non_lf')!)).toBe(true);
    });

    it('fails closed on a failed former check, even over addresses cached while the person was current, and does not remember it', async () => {
      addPerson(ACCOUNT, formerKey, 'leftuser', ['left@company.example']);
      database.exec(`DELETE FROM ORG_PEOPLE_ALL_RANGES WHERE PERSON_KEY = '${formerKey}'`);
      // While current, both address reads resolve and are cached.
      expect((await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).companyEmailsStatus).toBe('resolved');
      expect((await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'leftuser')).companyEmailsStatus).toBe('resolved');
      // They leave; the cached "current" answers expire and the next check fails.
      addRangeRow(ACCOUNT, formerKey, 'all', true, 'leftuser', '[[Unknown]]', null, 4);
      for (const key of [...cacheValues.keys()].filter((cacheKey) => cacheKey.includes('people-former-check'))) {
        cacheValues.delete(key);
      }
      database.exec('ALTER TABLE ORG_PEOPLE_ALL_RANGES RENAME TO SAVED_RANGES');
      const readsBefore = execute.mock.calls.length;

      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(FAILED);
      expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'LeftUser')).toEqual(FAILED);
      const addressReads = (execute.mock.calls.slice(readsBefore) as [string][]).filter(([query]) => /ORG_PEOPLE_COMPANY_EMAILS/.test(query));
      expect(addressReads).toEqual([]);

      database.exec('ALTER TABLE SAVED_RANGES RENAME TO ORG_PEOPLE_ALL_RANGES');
      expect(await service.getCompanyEmails({} as never, ACCOUNT, formerKey)).toEqual(UNAVAILABLE);
      expect(await service.getCompanyEmailsByUsername(REQ, ACCOUNT, 'LeftUser')).toEqual(UNAVAILABLE);
    });

    it('warns with the request when the former check fails', async () => {
      database.exec('ALTER TABLE ORG_PEOPLE_ALL_RANGES RENAME TO SAVED_RANGES');

      expect(await service.getCompanyEmails(REQ, ACCOUNT, formerKey)).toEqual(FAILED);
      expect(logger.warning).toHaveBeenCalledWith(REQ, 'get_org_lens_people_former_lookup', 'former employee lookup failed', {
        err: expect.any(Error),
      });
      expect(logger.info).not.toHaveBeenCalledWith(undefined, 'get_org_lens_people_former_lookup', expect.anything(), expect.anything());
      database.exec('ALTER TABLE SAVED_RANGES RENAME TO ORG_PEOPLE_ALL_RANGES');
    });

    it('serves the rows without foundation labels when only the label read fails, and does not cache that answer', async () => {
      database.exec('ALTER TABLE ORG_PEOPLE_CONTRIBUTORS_DAILY RENAME TO SAVED_DAILY');

      const degraded = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS);

      expect(degraded.rows.map((row) => row.personKey)).toEqual([formerKey]);
      expect(degraded.foundations).toEqual([]);
      expect(logger.warning).toHaveBeenCalledWith(REQ, 'get_org_lens_people_former', expect.any(String), { err: expect.any(Error) });
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:all')!)).toBe(false);

      database.exec('ALTER TABLE SAVED_DAILY RENAME TO ORG_PEOPLE_CONTRIBUTORS_DAILY');
      const recovered = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS);
      expect(recovered.foundations).toEqual([{ foundationId: 'foundation-two', foundationName: 'Foundation Two' }]);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:all')!)).toBe(true);
    });

    it('fails the former read when the roster read fails', async () => {
      database.exec('ALTER TABLE ORG_PEOPLE_ALL_RANGES RENAME TO SAVED_RANGES');

      await expect(service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS)).rejects.toThrow();
      database.exec('ALTER TABLE SAVED_RANGES RENAME TO ORG_PEOPLE_ALL_RANGES');
    });

    it('lists the lowercased usernames of the all-time former population, cached per account', async () => {
      addRangeRow(ACCOUNT, 'person-blank', 'all', true, '  ', 'Blank', null, 1);
      addRangeRow(ACCOUNT, 'person-mixed', 'all', true, ' MixedLeaver ', 'Mixed', null, 1);
      addRangeRow(ACCOUNT, 'person-current', 'all', false, 'stayer', 'Stayer', null, 1);
      addRangeRow(ACCOUNT, 'person-ranged', '365d', true, 'rangedonly', 'Ranged', null, 1);

      expect((await service.getFormerUsernames(ACCOUNT)).sort()).toEqual(['leftuser', 'mixedleaver']);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former-usernames:v1')!)).toBe(true);
    });

    it('rejects the former usernames on a warehouse error', async () => {
      database.exec('ALTER TABLE ORG_PEOPLE_ALL_RANGES RENAME TO SAVED_RANGES');

      await expect(service.getFormerUsernames(ACCOUNT)).rejects.toThrow();
      database.exec('ALTER TABLE SAVED_RANGES RENAME TO ORG_PEOPLE_ALL_RANGES');
    });
  });

  describe('current employees by time range (lfx-self-serve#4163)', () => {
    // The roster's foundation dropdown also reads the training foundations, which the detail fixture above omits.
    beforeEach(() => {
      database.exec('ALTER TABLE ORG_PEOPLE_TRAINING ADD COLUMN FOUNDATION_ID TEXT; ALTER TABLE ORG_PEOPLE_TRAINING ADD COLUMN FOUNDATION_NAME TEXT;');
    });

    it('reads only the current rows of the requested range and counts the tiles over them', async () => {
      addRangeRow(ACCOUNT, personKey, '30d', false, 'recent', 'Recent Person', 'recent@company.example', 3);
      addRangeRow(ACCOUNT, 'person-older', '365d', false, 'older', 'Older Person', 'older@company.example', 5);
      addRangeRow(ACCOUNT, 'person-left', '30d', true, 'left', 'Left Person', null, 2);

      const response = await service.getAllEmployees(ACCOUNT, '30d', FILTERS);

      expect(response.rows.map((row) => row.personKey)).toEqual([personKey]);
      expect(response.stats).toEqual({ activeInOss: 1, inGovernance: 0, codeContributors: 1, eventAttendees: 0, trainees: 0 });
      const rosterRead = (execute.mock.calls as [string, string[]][]).find(([query]) => /ORG_PEOPLE_ALL_RANGES/.test(query));
      expect(rosterRead?.[0]).toContain('IS_FORMER = FALSE');
      expect(rosterRead?.[1]).toEqual([ACCOUNT, '30d', 'all']);
    });

    it("reads Past 2 years as the warehouse's 730d rows, apart from the other ranges", async () => {
      addRangeRow(ACCOUNT, personKey, '365d', false, 'recent', 'Recent Person', 'recent@company.example', 3);
      addRangeRow(ACCOUNT, personKey, '730d', false, 'recent', 'Recent Person', 'recent@company.example', 7);
      addRangeRow(ACCOUNT, 'person-two-years', '730d', false, 'twoyears', 'Two Years', 'twoyears@company.example', 2);

      const response = await service.getAllEmployees(ACCOUNT, '730d', FILTERS);

      expect(response.rows.map((row) => [row.personKey, row.commitsCount])).toEqual([
        [personKey, 7],
        ['person-two-years', 2],
      ]);
      const rosterRead = (execute.mock.calls as [string, string[]][]).find(([query]) => /ORG_PEOPLE_ALL_RANGES/.test(query));
      expect(rosterRead?.[1]).toEqual([ACCOUNT, '730d', 'all']);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:730d:all')!)).toBe(true);
    });

    it('lists the rows of the requested project scope only', async () => {
      addRangeRow(ACCOUNT, personKey, '365d', false, 'both', 'In Both', 'both@company.example', 3);
      addRangeRow(ACCOUNT, personKey, '365d', false, 'both', 'In Both', 'both@company.example', 1, { projectScope: 'lf' });
      addRangeRow(ACCOUNT, 'person-non-lf', '365d', false, 'nonlf', 'Non Lf', 'nonlf@company.example', 2, { projectScope: 'non_lf' });

      const lf = await service.getAllEmployees(ACCOUNT, '365d', { ...FILTERS, projectScope: 'lf' });
      const nonLf = await service.getAllEmployees(ACCOUNT, '365d', { ...FILTERS, projectScope: 'non_lf' });

      expect(lf.rows.map((row) => [row.personKey, row.commitsCount])).toEqual([[personKey, 1]]);
      expect(nonLf.rows.map((row) => [row.personKey, row.commitsCount])).toEqual([['person-non-lf', 2]]);
    });

    // The code tile counts Code Contributors under every option (lfx-self-serve#4160): the reviewer has no commit but counts.
    it.each([
      [{ commitScope: 'all', metric: 'commits' }, 10],
      [{ commitScope: 'merged', metric: 'commits' }, 4],
      [{ commitScope: 'all', metric: 'code' }, 25],
      [{ commitScope: 'merged', metric: 'code' }, 25],
    ] as const)('shows the count %o picks, with the code tile counting every code contributor', async (picked, expected) => {
      addRangeRow(ACCOUNT, personKey, '365d', false, 'coder', 'Coder', 'coder@company.example', 10, { merged: 4, code: 25 });
      // Reviews only: no commit at all, but code contributions.
      addRangeRow(ACCOUNT, 'person-reviewer', '365d', false, 'reviewer', 'Reviewer', 'reviewer@company.example', 0, { merged: 0, code: 6 });

      const response = await service.getAllEmployees(ACCOUNT, '365d', { ...FILTERS, ...picked });

      expect(response.rows.find((row) => row.personKey === personKey)?.commitsCount).toBe(expected);
      expect(response.rows.find((row) => row.personKey === 'person-reviewer')?.commitsCount).toBe(picked.metric === 'code' ? 6 : 0);
      expect(response.stats.codeContributors).toBe(2);
    });

    it('caches per range and project scope, one entry serving every commit scope and metric', async () => {
      addRangeRow(ACCOUNT, personKey, '30d', false, 'recent', 'Recent Person', 'recent@company.example', 3);
      addRangeRow(ACCOUNT, personKey, 'all', false, 'recent', 'Recent Person', 'recent@company.example', 9, { merged: 5, code: 40 });

      expect((await service.getAllEmployees(ACCOUNT, '30d', FILTERS)).rows[0]?.commitsCount).toBe(3);
      expect((await service.getAllEmployees(ACCOUNT, 'all', FILTERS)).rows[0]?.commitsCount).toBe(9);
      const readsBeforeSwitch = execute.mock.calls.length;
      expect((await service.getAllEmployees(ACCOUNT, 'all', { ...FILTERS, commitScope: 'merged' })).rows[0]?.commitsCount).toBe(5);
      expect((await service.getAllEmployees(ACCOUNT, 'all', { ...FILTERS, metric: 'code' })).rows[0]?.commitsCount).toBe(40);
      // Switching commit scope or metric re-projects the cached rows; it does not read the warehouse again.
      expect(execute.mock.calls.length).toBe(readsBeforeSwitch);
      await service.getFormerEmployees(REQ, ACCOUNT, '30d', FILTERS);
      await service.getFormerEmployees(REQ, ACCOUNT, 'all', { ...FILTERS, metric: 'code' });
      await service.getAllEmployees(ACCOUNT, 'all', { ...FILTERS, projectScope: 'lf' });

      expect([...cacheValues.keys()].sort()).toEqual(
        ['people-all:v4:30d:all', 'people-all:v4:all:all', 'people-all:v4:all:lf', 'people-former:v3:30d:all', 'people-former:v3:all:all']
          .map((subResource) => buildOrgCacheKey(ACCOUNT, subResource)!)
          .sort()
      );
    });

    it('labels the All Time foundations of code older than a year', async () => {
      addRangeRow(ACCOUNT, personKey, 'all', false, 'veteran', 'Veteran', 'veteran@company.example', 2);
      addDailyCode(ACCOUNT, personKey, '2023-03-01', 'foundation-old', 'Foundation Old');

      const response = await service.getAllEmployees(ACCOUNT, 'all', FILTERS);

      expect(response.foundations).toEqual([
        { foundationId: 'foundation-old', foundationName: 'Foundation Old' },
        { foundationId: 'foundation-one', foundationName: 'Foundation One' },
      ]);
    });

    // The reassign pickers ask for no range: they keep the pre-#4163 roster.
    it('reads the unranged ORG_PEOPLE_ALL roster when no range is given, cached apart from 365d', async () => {
      addRosterRow(ACCOUNT, 'person-roster', 'rosteruser');
      addRangeRow(ACCOUNT, personKey, '365d', false, 'recent', 'Recent Person', 'recent@company.example', 3);

      const roster = await service.getAllEmployees(ACCOUNT, null, FILTERS);
      const ranged = await service.getAllEmployees(ACCOUNT, '365d', FILTERS);

      expect(roster.rows.map((row) => row.personKey)).toEqual(['person-roster']);
      expect(ranged.rows.map((row) => row.personKey)).toEqual([personKey]);
      const rosterRead = (execute.mock.calls as [string, string[]][]).find(([query]) => /ENGAGED_FOUNDATION_IDS/.test(query));
      expect(rosterRead?.[0]).toMatch(/ORG_PEOPLE_ALL\s/);
      expect(rosterRead?.[0]).not.toContain('ORG_PEOPLE_ALL_RANGES');
      expect(rosterRead?.[1]).toEqual([ACCOUNT]);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:roster')!)).toBe(true);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all')!)).toBe(true);
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

describe('OrgLensPeopleService person-key username resolution (#4402)', () => {
  // The Key Contacts tab matches on the LF username when there is one, and the drawer only ever holds a
  // person key — resolving it here keeps the username out of the request URL, and so out of the logs.
  it("returns the roster row's username, normalized", async () => {
    addRosterRow(ACCOUNT, 'person-one', ' MixedUser ');

    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'person-one')).toBe('mixeduser');
  });

  it('returns null for a person key the roster gives no username for', async () => {
    addRosterRow(ACCOUNT, 'person-one', '');
    addRosterRow(ACCOUNT, 'person-two', '   ');

    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'person-one')).toBeNull();
    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'person-two')).toBeNull();
    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'nobody')).toBeNull();
  });

  // Fails closed rather than picking one: a key whose rows disagree is not an identity.
  it('returns null when a person key carries more than one username', async () => {
    addRosterRow(ACCOUNT, 'person-one', 'first-name');
    addRosterRow(ACCOUNT, 'person-one', 'second-name');

    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'person-one')).toBeNull();
  });

  it('treats rows differing only by case or padding as one username', async () => {
    addRosterRow(ACCOUNT, 'person-one', 'MixedUser');
    addRosterRow(ACCOUNT, 'person-one', ' mixeduser ');

    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'person-one')).toBe('mixeduser');
  });

  it("never reads another account's roster for the same key", async () => {
    addRosterRow('other-account', 'person-one', 'elsewhere');

    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, 'person-one')).toBeNull();
  });

  it('resolves a live-only key through the live directory instead of the warehouse', async () => {
    expect(await service.resolveUsernameByPersonKey({} as never, ACCOUNT, LIVE_PERSON)).toBe('mixeduser');
    const rosterReads = (execute.mock.calls as [string][]).filter(([query]) => /ORG_PEOPLE_ALL/.test(query));
    expect(rosterReads).toEqual([]);
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
            MERGED_COMMITS_COUNT: 0,
            CODE_ACTIVITIES_COUNT: 0,
            EVENTS_COUNT: 0,
            COURSES_COUNT: 0,
            ENGAGED_FOUNDATION_IDS: [],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const wire = await service.getAllEmployees(ACCOUNT, '365d', FILTERS);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(wire.rows).toHaveLength(1);
    expect(wire.rows[0]).not.toHaveProperty('emails');
    expect(wire.rows[0]).not.toHaveProperty('mergedFrom');
    expect(wire.rows[0].email).toBe('WireUser@Example.COM');

    // The internal accessor serves the same cached raw rows; merge-only fields survive for the live merge.
    const internal = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');
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
            MERGED_COMMITS_COUNT: 12,
            CODE_ACTIVITIES_COUNT: 90,
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
            MERGED_COMMITS_COUNT: 0,
            CODE_ACTIVITIES_COUNT: 0,
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
    const fromMiss = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    // Second call reads the entry the first one wrote, through the real serialize/parse round trip
    // the in-memory Valkey fixture performs.
    const fromHit = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    // `toStrictEqual` distinguishes null from undefined from an absent key — the distinction this
    // exercises via `accessBadge`, which is optional and unset on a stored-only roster row. The
    // serialized comparison additionally pins key order, which `mapEmployeeRow`'s object literal
    // fixes and a decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(2);
    // Tiles are counted over the projected rows, so a cache hit recomputes the same numbers.
    expect((await service.getAllEmployees(ACCOUNT, '365d', FILTERS)).stats).toEqual({
      activeInOss: 1,
      inGovernance: 1,
      codeContributors: 1,
      eventAttendees: 1,
      trainees: 1,
    });
    expect(execute).toHaveBeenCalledTimes(2);
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
    await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgAllEmployeesRawCache;
    const usernameIndex = stored.rowsRaw.k.indexOf('LF_USERNAME');
    stored.rowsRaw.r = stored.rowsRaw.r.map((row) => row.map((cell, index) => (index === usernameIndex ? 42 : cell)));
    cacheValues.set(key, JSON.stringify(stored));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    expect(response.rows.map((row) => row.lfUsername)).toEqual(['rosteruser', null]);
  });

  it('rejects a stored roster whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a roster with
    // holes in it — silently dropping LF_USERNAME returns the directory to email-only matching.
    mockRoster();
    await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgAllEmployeesRawCache;
    stored.rowsRaw.k = stored.rowsRaw.k.filter((column) => column !== 'LF_USERNAME');
    cacheValues.set(key, JSON.stringify(stored));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    expect(response.rows.map((row) => row.lfUsername)).toEqual(['rosteruser', null]);
  });

  it('round-trips an empty roster unchanged', async () => {
    // The empty envelope has to survive its own guard — `accountId` is null with no rows to hoist
    // it from — or an org with no roster would refetch on every request forever.
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    const fromHit = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  it('treats a pre-compaction cached roster as a miss rather than decoding it', async () => {
    // The shape guard, not just the key bump, has to reject this: decoding an array as a
    // `ColumnarTable` would read `k`/`r` off it and serve an empty roster for the whole TTL.
    const legacy = { rowsRaw: [{ PERSON_KEY: 'stale-person', LF_USERNAME: 'stale' }], foundationRaw: [] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all')!, JSON.stringify(legacy));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    expect(response.rows.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});
