// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { CompactOrgAllEmployeesRawCache, OrgCommitFilters, OrgLensTimeRange, OrgPersonCompanyEmailsResponse } from '@lfx-one/shared/interfaces';
import { agreedUsername } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getLive, cacheValues, resolveOrgScope } = vi.hoisted(() => ({
  resolveOrgScope: vi.fn(),
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
// The scope served (lfx-self-serve-ops#1219): `all` unless a test grants the account an Insights organization.
vi.mock('../helpers/org-scope.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/org-scope.helper')>()),
  resolveOrgScope,
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
import { OrgPeopleContributorsService } from './org-people-contributors.service';
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
    .prepare(
      'INSERT INTO ORG_PEOPLE_CONTRIBUTORS_DAILY (ACCOUNT_ID, PERSON_KEY, PROJECT_ID, ACTIVITY_DATE, FOUNDATION_ID, FOUNDATION_NAME, IS_LF_PROJECT) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
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

/** One ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS row (lfx-self-serve#4730): code credited to `account`, no employment row there. */
function addUnclassifiedRow(account: string, key: string, range: string, username: string, name: string, commits: number, teamMember = false): void {
  database
    .prepare(
      `INSERT INTO ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS (
        ACCOUNT_ID, PERSON_KEY, TIME_RANGE, PROJECT_SCOPE, LFID, LF_USERNAME, CDP_MEMBER_ID, NAME, PHOTO,
        COMMITS_COUNT, MERGED_COMMITS_COUNT, CODE_ACTIVITIES_COUNT, ENGAGED_FOUNDATION_IDS, IS_CDP_TEAM_MEMBER
      ) VALUES (?, ?, ?, 'all', NULL, ?, NULL, ?, NULL, ?, ?, ?, '["foundation-three"]', ?)`
    )
    .run(account, key, range, username, name, commits, commits, commits, teamMember ? 1 : 0);
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
      EVENTS_COUNT INTEGER, COURSES_COUNT INTEGER, ENGAGED_FOUNDATION_IDS TEXT, IS_CDP_TEAM_MEMBER INTEGER DEFAULT 0
    )
  `);
  // Per-range, per-project-scope roster (lfx-self-serve#4163, #4164); empty unless a test adds someone.
  database.exec(`
    CREATE TABLE ORG_PEOPLE_ALL_RANGES (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, TIME_RANGE TEXT, PROJECT_SCOPE TEXT, IS_FORMER INTEGER, LFID TEXT, LF_USERNAME TEXT,
      CDP_MEMBER_ID TEXT, NAME TEXT, TITLE TEXT, EMAIL TEXT, PHOTO TEXT, SEATS_COUNT INTEGER, BOARD_SEATS_COUNT INTEGER,
      COMMITTEE_SEATS_COUNT INTEGER, COMMITS_COUNT INTEGER, MERGED_COMMITS_COUNT INTEGER, CODE_ACTIVITIES_COUNT INTEGER,
      EVENTS_COUNT INTEGER, COURSES_COUNT INTEGER, ENGAGED_FOUNDATION_IDS TEXT, IS_CDP_TEAM_MEMBER INTEGER DEFAULT 0
    )
  `);
  // Contributors daily rows (foundation labels, Code detail); also read for the account's CDP team members (lfx-self-serve#4685).
  database.exec(`
    CREATE TABLE ORG_PEOPLE_CONTRIBUTORS_DAILY (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, PROJECT_ID TEXT, ACTIVITY_DATE TEXT, FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT, IS_LF_PROJECT INTEGER,
      LFID TEXT, LF_USERNAME TEXT, CDP_MEMBER_ID TEXT, DISPLAY_NAME TEXT, TITLE TEXT, PROJECT_NAME TEXT, PROJECT_SLUG TEXT, FOUNDATION_SLUG TEXT,
      DAILY_COMMITS INTEGER, DAILY_MERGED_COMMITS INTEGER, DAILY_SCOPE_COMMITS INTEGER, DAILY_SCOPE_MERGED_COMMITS INTEGER, DAILY_CODE_ACTIVITIES INTEGER,
      IS_CDP_TEAM_MEMBER INTEGER DEFAULT 0
    )
  `);
  // People with code but no employment row (lfx-self-serve#4730); empty unless a test adds someone.
  database.exec(`
    CREATE TABLE ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, TIME_RANGE TEXT, PROJECT_SCOPE TEXT, LFID TEXT, LF_USERNAME TEXT, CDP_MEMBER_ID TEXT,
      NAME TEXT, PHOTO TEXT, COMMITS_COUNT INTEGER, MERGED_COMMITS_COUNT INTEGER, CODE_ACTIVITIES_COUNT INTEGER,
      ENGAGED_FOUNDATION_IDS TEXT, IS_CDP_TEAM_MEMBER INTEGER DEFAULT 0
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
          .replace(/DATEADD\(day, -(\d+), CURRENT_DATE\(\)\)/g, "date('now', '-$1 days')")
          .replaceAll('CURRENT_DATE()', "date('now')")
      )
      .all(...binds)
      // Snowflake answers unquoted identifiers upper-cased, whatever case the query wrote them in.
      .map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column.toUpperCase(), value])));
    for (const row of rows) {
      for (const column of ['IS_BOARD', 'IS_SPEAKER']) {
        if (column in row) row[column] = row[column] === 1;
      }
    }
    return { rows };
  });
  getLive.mockResolvedValue({ rows: [{ personKey: LIVE_PERSON, lfUsername: 'mixeduser' }] });
  resolveOrgScope.mockResolvedValue('all');
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
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail:v5:${personKey}`)!)).toBe(true);
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

  it('marks a code project Maintainer when the person holds a role on it overlapping the range, 730 days by default', async () => {
    database.exec('DELETE FROM ORG_MAINTAINER_ROLES');
    database
      .prepare('INSERT INTO ORG_PEOPLE_CODE_CONTRIBUTIONS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ACCOUNT, personKey, 'project-two', 'Project Two', 'foundation-one', 'Foundation One', 2, 2, '2026-04-11');
    const insert = database.prepare('INSERT INTO ORG_MAINTAINER_ROLES VALUES (?, ?, ?, ?, ?, ?, ?)');
    // Ended 200 days ago: inside the past 2 years and all time, outside the past 90 days.
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
      [ACCOUNT, personKey, 730],
      [ACCOUNT, personKey, 90],
      [ACCOUNT, personKey],
    ]);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail-roles:v1:${personKey}:90d`)!)).toBe(true);
  });

  it('flags the roles unavailable, shows no pill, and stores no roles, when the roles table is missing', async () => {
    const warehouse = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: string, binds: string[]) => {
      if (query.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      return warehouse(query, binds);
    });

    const detail = await service.getEmployeeDetail({} as never, ACCOUNT, personKey);

    expect(detail.maintainerRolesUnavailable).toBe(true);
    expect(detail.code.length).toBeGreaterThan(0);
    expect(detail.code.every((row) => row.isMaintainer === false)).toBe(true);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail-roles:v1:${personKey}:730d`)!)).toBe(false);
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
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:non_lf:all')!)).toBe(true);
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

      // Team members included: their read shares the renamed table, and this case is about the label read alone.
      const degraded = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');

      expect(degraded.rows.map((row) => row.personKey)).toEqual([formerKey]);
      expect(degraded.foundations).toEqual([]);
      expect(logger.warning).toHaveBeenCalledWith(REQ, 'get_org_lens_people_former', expect.any(String), { err: expect.any(Error) });
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:all:all')!)).toBe(false);

      database.exec('ALTER TABLE SAVED_DAILY RENAME TO ORG_PEOPLE_CONTRIBUTORS_DAILY');
      const recovered = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS);
      expect(recovered.foundations).toEqual([{ foundationId: 'foundation-two', foundationName: 'Foundation Two' }]);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:all:all')!)).toBe(true);
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

    describe('with people who have code but no employment row (lfx-self-serve#4730)', () => {
      const unclassifiedKey = 'cdp:member-seven';

      beforeEach(() => {
        addUnclassifiedRow(ACCOUNT, unclassifiedKey, '365d', 'noroster', 'nobody@personal.example', 3);
        addDailyCode(ACCOUNT, unclassifiedKey, '2026-05-01', 'foundation-three', 'Foundation Three');
      });

      it('lists them after the former employees, tagged unclassified, code only, in the tiles and the foundation labels', async () => {
        const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');

        expect(response.rows).toEqual([
          expect.objectContaining({ personKey: formerKey, isFormer: true }),
          expect.objectContaining({ personKey: unclassifiedKey, isUnclassified: true, commitsCount: 3, seatsCount: 0, eventsCount: 0, coursesCount: 0 }),
        ]);
        expect(response.rows[1]).not.toHaveProperty('isFormer');
        // An address-shaped name is never sent; the LF username stands in, as for a former employee.
        expect(response.rows[1]?.name).toBe('noroster');
        expect(response.rows[1]?.email).toBeNull();
        expect(response.stats.codeContributors).toBe(2);
        expect(response.foundations).toEqual([
          { foundationId: 'foundation-two', foundationName: 'Foundation Two' },
          { foundationId: 'foundation-three', foundationName: 'Foundation Three' },
        ]);
        expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-unclassified:v1:365d:all:all')!)).toBe(true);
      });

      it('drops a CDP team member among them under Exclude team members, as their code is all they have, still naming them', async () => {
        addUnclassifiedRow(ACCOUNT, 'cdp:team-member', '365d', 'teamer', 'Team Member', 5, true);
        // The team-member keys come from the contributor rows' person-level flag (lfx-self-serve#4685).
        database
          .prepare('INSERT INTO ORG_PEOPLE_CONTRIBUTORS_DAILY (ACCOUNT_ID, PERSON_KEY, IS_CDP_TEAM_MEMBER) VALUES (?, ?, 1)')
          .run(ACCOUNT, 'cdp:team-member');

        const excluded = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'exclude');

        expect(excluded.rows.map((row) => row.personKey)).toEqual([formerKey, unclassifiedKey]);
        // Named all the same, so the page never takes their live Org Lens access row for a current employee.
        expect(excluded.unclassifiedUsernames?.sort()).toEqual(['noroster', 'teamer']);
      });

      it('lists someone on both populations once, as the former employee, when the two reads come from different builds', async () => {
        // The two reads are cached separately, so right after a build one can still hold someone who has since moved.
        addUnclassifiedRow(ACCOUNT, formerKey, '365d', 'leftuser', 'Left User', 6);
        addUnclassifiedRow(ACCOUNT, 'cdp:left-user', '365d', ' LeftUser ', 'Left User', 6);
        // A CDP-only identity the newer build resolved to an LF identity: same CDP member, no username on the stale row.
        database.exec(`UPDATE ORG_PEOPLE_ALL_RANGES SET CDP_MEMBER_ID = 'member-left' WHERE PERSON_KEY = '${formerKey}'`);
        addUnclassifiedRow(ACCOUNT, 'cdp:member-left', '365d', '', 'Left User', 6);
        database.exec(`UPDATE ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS SET CDP_MEMBER_ID = 'member-left' WHERE PERSON_KEY = 'cdp:member-left'`);

        const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');

        expect(response.rows.map((row) => [row.personKey, row.isFormer === true, row.isUnclassified === true])).toEqual([
          [formerKey, true, false],
          [unclassifiedKey, false, true],
        ]);
        expect(response.stats.codeContributors).toBe(2);
      });

      it('lists once, as former, someone whose stale former row lacks the username their unclassified row has, taking it', async () => {
        // A stale former row without an LF username, and a newer unclassified row for the same CDP member that has one.
        database.exec(`UPDATE ORG_PEOPLE_ALL_RANGES SET LF_USERNAME = NULL, CDP_MEMBER_ID = 'member-left' WHERE PERSON_KEY = '${formerKey}'`);
        addUnclassifiedRow(ACCOUNT, 'cdp:member-left', '365d', 'leftuser', 'Left User', 6);
        database.exec(`UPDATE ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS SET CDP_MEMBER_ID = 'member-left' WHERE PERSON_KEY = 'cdp:member-left'`);

        const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');

        expect(response.rows.map((row) => [row.personKey, row.isFormer === true, row.lfUsername])).toEqual([
          [formerKey, true, 'leftuser'],
          [unclassifiedKey, false, 'noroster'],
        ]);
        expect(response.stats.codeContributors).toBe(2);
      });

      it('gives the kept former row the CDP member only the unclassified row has', async () => {
        addUnclassifiedRow(ACCOUNT, 'cdp:member-left', '365d', 'leftuser', 'Left User', 6);
        database.exec(`UPDATE ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS SET CDP_MEMBER_ID = 'member-left' WHERE PERSON_KEY = 'cdp:member-left'`);

        const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');

        expect(response.rows.map((row) => [row.personKey, row.cdpMemberId])).toEqual([
          [formerKey, 'member-left'],
          [unclassifiedKey, null],
        ]);
      });

      it('lists former employees only while the table is not built, and does not remember that answer', async () => {
        database.exec('ALTER TABLE ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS RENAME TO SAVED_UNCLASSIFIED');
        const missing = new Error(
          "SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS' does not exist or not authorized."
        );
        const sqlite = execute.getMockImplementation()!;
        execute.mockImplementation(async (query: string, binds: string[]) => {
          if (query.includes('ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS')) throw missing;
          return sqlite(query, binds);
        });

        const before = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');

        expect(before.rows.map((row) => row.personKey)).toEqual([formerKey]);
        expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-unclassified:v1:365d:all:all')!)).toBe(false);
        const unclassifiedRead = (execute.mock.calls as [string, unknown[], unknown][]).find(([query]) =>
          query.includes('ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS')
        );
        expect(unclassifiedRead?.[2]).toEqual({ expectMissingObject: 'ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS' });

        database.exec('ALTER TABLE SAVED_UNCLASSIFIED RENAME TO ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS');
        execute.mockImplementation(sqlite);
        const after = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');
        expect(after.rows.map((row) => row.personKey)).toEqual([formerKey, unclassifiedKey]);
      });

      it('fails the read on any other warehouse error', async () => {
        database.exec('ALTER TABLE ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS RENAME TO SAVED_UNCLASSIFIED');

        await expect(service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include')).rejects.toThrow();
        database.exec('ALTER TABLE SAVED_UNCLASSIFIED RENAME TO ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS');
      });
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
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:730d:all:all')!)).toBe(true);
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

      expect([...cacheValues.keys()].filter((key) => !key.includes('people-team-members')).sort()).toEqual(
        [
          'people-all:v4:30d:all:all',
          'people-all:v4:all:all:all',
          'people-all:v4:all:lf:all',
          'people-former:v3:30d:all:all',
          'people-former:v3:all:all:all',
          'people-unclassified:v1:30d:all:all',
          'people-unclassified:v1:all:all:all',
        ]
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
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all:all')!)).toBe(true);
    });

    // lfx-self-serve#4685
    it('drops CDP team members from the current and former rows and their tiles under exclude, and from neither under include', async () => {
      addRangeRow(ACCOUNT, personKey, '365d', false, 'kept', 'Kept Person', 'kept@company.example', 3);
      addRangeRow(ACCOUNT, 'person-team', '365d', false, 'team', 'Team Person', 'team@company.example', 5);
      addRangeRow(ACCOUNT, 'person-team-left', '365d', true, 'teamleft', 'Team Left', null, 2);
      database.exec("UPDATE ORG_PEOPLE_ALL_RANGES SET IS_CDP_TEAM_MEMBER = 1 WHERE PERSON_KEY IN ('person-team', 'person-team-left')");

      const included = await service.getAllEmployees(ACCOUNT, '365d', FILTERS, 'include');
      const excluded = await service.getAllEmployees(ACCOUNT, '365d', FILTERS, 'exclude');
      const formerIncluded = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'include');
      const formerExcluded = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'exclude');

      expect(included.rows.map((row) => row.personKey).sort()).toEqual([personKey, 'person-team']);
      expect(included.stats.codeContributors).toBe(2);
      expect(excluded.rows.map((row) => row.personKey)).toEqual([personKey]);
      expect(excluded.stats).toEqual({ activeInOss: 1, inGovernance: 0, codeContributors: 1, eventAttendees: 0, trainees: 0 });
      expect(formerIncluded.rows.map((row) => row.personKey)).toEqual(['person-team-left']);
      expect(formerExcluded.rows).toEqual([]);
      // One roster entry per range and scope serves both picks; the team members are cached once per account.
      expect([...cacheValues.keys()].filter((key) => key.includes('people-team-members') || key.includes('people-all:'))).toEqual(
        expect.arrayContaining([buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all:all')!, buildOrgCacheKey(ACCOUNT, 'people-team-members:v1')!])
      );
      expect((execute.mock.calls as [string][]).filter(([query]) => query.includes('IS_CDP_TEAM_MEMBER'))).toHaveLength(1);
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

  describe("Code tab in the opener's view (lfx-self-serve#4404)", () => {
    const LF_COMMITS: OrgCommitFilters = { projectScope: 'lf', commitScope: 'all', metric: 'commits' };
    const ALL_MERGED: OrgCommitFilters = { projectScope: 'all', commitScope: 'merged', metric: 'commits' };
    const NON_LF_CODE: OrgCommitFilters = { projectScope: 'non_lf', commitScope: 'all', metric: 'code' };
    const LF_MERGED: OrgCommitFilters = { projectScope: 'lf', commitScope: 'merged', metric: 'commits' };

    /** One day of code: authored, merged, in-scope authored, in-scope merged commits and code activities. */
    function addCode(key: string, projectId: string, isLfProject: number, daysBefore: number, counts: number[], account = ACCOUNT): void {
      database
        .prepare(
          `INSERT INTO ORG_PEOPLE_CONTRIBUTORS_DAILY (
            ACCOUNT_ID, PERSON_KEY, PROJECT_ID, ACTIVITY_DATE, FOUNDATION_ID, FOUNDATION_NAME, IS_LF_PROJECT, CDP_MEMBER_ID, DISPLAY_NAME, PROJECT_NAME,
            DAILY_COMMITS, DAILY_MERGED_COMMITS, DAILY_SCOPE_COMMITS, DAILY_SCOPE_MERGED_COMMITS, DAILY_CODE_ACTIVITIES
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(account, key, projectId, daysAgo(daysBefore), 'foundation-one', 'Foundation One', isLfProject, `cdp-${key}`, key, `Name ${projectId}`, ...counts);
    }

    async function codeIn(range: OrgLensTimeRange, filters: OrgCommitFilters): Promise<{ total: number; code: [string, number][] }> {
      const detail = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, range, filters);
      return { total: detail.totalCommits, code: detail.code.map((row) => [row.projectId, row.commits]) };
    }

    function dailyReads(): string[] {
      return (execute.mock.calls as [string][]).map(([query]) => query).filter((query) => query.includes('ORG_PEOPLE_CONTRIBUTORS_DAILY'));
    }

    beforeEach(() => {
      // The People → Contributors read filters the maintainer roles by project type and, under the default, team members.
      database.exec('ALTER TABLE ORG_MAINTAINER_ROLES ADD COLUMN IS_LF_PROJECT INTEGER');
      database.exec('ALTER TABLE ORG_MAINTAINER_ROLES ADD COLUMN IS_CDP_TEAM_MEMBER INTEGER DEFAULT 0');
      // A mirrored commit credits each scope once, so an LF day can carry more in-scope than all-project commits.
      addCode(personKey, 'project-lf', 1, 10, [3, 2, 4, 3, 9]);
      addCode(personKey, 'project-lf', 1, 200, [5, 5, 5, 5, 6]);
      addCode(personKey, 'project-other', 0, 50, [1, 0, 2, 1, 4]);
      addCode(personKey, 'project-old', 1, 800, [7, 7, 7, 7, 7]);
      // Another person's and another account's code never counts.
      addCode('person-two', 'project-lf', 1, 10, [50, 50, 50, 50, 50]);
      addCode(personKey, 'project-lf', 1, 10, [90, 90, 90, 90, 90], 'other-account');
    });

    it('counts the range, project type and code count per project and in total, highest count first', async () => {
      expect(await codeIn('90d', LF_COMMITS)).toEqual({ total: 4, code: [['project-lf', 4]] });
      expect(await codeIn('365d', ALL_MERGED)).toEqual({
        total: 7,
        code: [
          ['project-lf', 7],
          ['project-other', 0],
        ],
      });
      expect(await codeIn('365d', NON_LF_CODE)).toEqual({ total: 4, code: [['project-other', 4]] });
      expect(await codeIn('all', LF_MERGED)).toEqual({
        total: 15,
        code: [
          ['project-lf', 8],
          ['project-old', 7],
        ],
      });
    });

    it('equals the People → Contributors row and its project rows for the same range and filters', async () => {
      const contributors = new OrgPeopleContributorsService();
      const combos: [OrgLensTimeRange, OrgCommitFilters][] = [
        ['90d', LF_COMMITS],
        ['365d', ALL_MERGED],
        ['730d', NON_LF_CODE],
        ['all', LF_MERGED],
        ['all', { projectScope: 'all', commitScope: 'all', metric: 'code' }],
      ];

      for (const [range, filters] of combos) {
        const response = await contributors.getContributors(ACCOUNT, range, filters);
        const count = (row: { commits: number; codeActivities: number }): number => (filters.metric === 'code' ? row.codeActivities : row.commits);
        const row = response.contributors.find((contributor) => contributor.personKey === personKey);
        const projects = response.projects.filter((project) => project.personKey === personKey).map((project) => [project.projectId, count(project)]);
        const drawer = await codeIn(range, filters);

        expect(drawer.total).toBe(row ? count(row) : 0);
        expect([...drawer.code].sort()).toEqual(projects.sort());
      }
    });

    it('echoes the view, dates each project by its last activity in it, and never reads the trailing-year table', async () => {
      const detail = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '365d', ALL_MERGED);

      expect(detail.codeView).toEqual({ range: '365d', ...ALL_MERGED });
      expect(detail.code.find((row) => row.projectId === 'project-lf')?.lastActivityDate).toBe(daysAgo(10));
      expect((execute.mock.calls as [string][]).some(([query]) => query.includes('ORG_PEOPLE_CODE_CONTRIBUTIONS'))).toBe(false);
    });

    it('serves every code count of a range and project type from one cached read', async () => {
      await codeIn('365d', LF_COMMITS);
      await codeIn('365d', LF_MERGED);
      await codeIn('365d', { ...LF_COMMITS, metric: 'code' });

      expect(dailyReads()).toHaveLength(1);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail-code-view:v1:${personKey}:365d:lf:all`)!)).toBe(true);
    });

    it('keeps the trailing-year commits, without a view, when the opener sends no filters', async () => {
      const detail = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '90d');

      expect(detail.codeView).toBeUndefined();
      expect(detail.code.map((row) => [row.projectId, row.commits])).toEqual([['project-one', 12]]);
      expect(detail.totalCommits).toBe(12);
      expect(dailyReads()).toEqual([]);
    });

    // lfx-self-serve#4685
    it("shows no code for a CDP team member under the opener's Exclude pick, as their row counts none, and their code under Include", async () => {
      database.exec(`UPDATE ORG_PEOPLE_CONTRIBUTORS_DAILY SET IS_CDP_TEAM_MEMBER = 1 WHERE PERSON_KEY = '${personKey}'`);

      const excluded = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '90d', LF_COMMITS, 'exclude');
      const included = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '90d', LF_COMMITS, 'include');
      const codeFree = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '90d');

      expect([excluded.code, excluded.totalCommits]).toEqual([[], 0]);
      expect(included.totalCommits).toBe(4);
      // Without the opener's code filters the drawer is not a page's view, so the pick does not apply.
      expect(codeFree.totalCommits).toBe(12);
    });

    it('keeps the code view while the team-member flag is not in the warehouse yet', async () => {
      database.exec(`UPDATE ORG_PEOPLE_CONTRIBUTORS_DAILY SET IS_CDP_TEAM_MEMBER = 1 WHERE PERSON_KEY = '${personKey}'`);
      const warehouse = execute.getMockImplementation()!;
      execute.mockImplementation(async (query: string, binds: string[]) => {
        if (query.includes('IS_CDP_TEAM_MEMBER'))
          throw Object.assign(new Error("SQL compilation error:\ninvalid identifier 'IS_CDP_TEAM_MEMBER'"), { code: '000904' });
        return warehouse(query, binds);
      });

      const detail = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '90d', LF_COMMITS, 'exclude');

      expect(detail.totalCommits).toBe(4);
    });

    it('follows the view for a username opener and answers a live-only person with an empty view without a read', async () => {
      addRosterRow(ACCOUNT, personKey, 'mixeduser');

      const byUsername = await service.getEmployeeDetailByUsername(REQ, ACCOUNT, 'mixeduser', '90d', LF_COMMITS);
      expect(byUsername?.codeView).toEqual({ range: '90d', ...LF_COMMITS });
      expect(byUsername?.totalCommits).toBe(4);

      execute.mockClear();
      const liveOnly = await service.getEmployeeDetail(REQ, ACCOUNT, LIVE_PERSON, '90d', LF_COMMITS);
      expect(liveOnly).toMatchObject({ code: [], totalCommits: 0, codeView: { range: '90d', ...LF_COMMITS } });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  // lfx-self-serve-ops#1219
  describe('organization scope', () => {
    const grantInsights = () => resolveOrgScope.mockImplementation(async (_snowflake: unknown, _account: string, scope: string) => scope);
    const queries = (): string[] => (execute.mock.calls as [string][]).map(([query]) => query);

    /** The Insights organization's share of a ranged row's code: `[commits, merged, code activities]`. */
    function setInsightsCounts(table: string, key: string, range: string, counts: [number, number, number], foundations = '["foundation-insights"]'): void {
      database
        .prepare(
          `UPDATE ${table} SET INSIGHTS_COMMITS_COUNT = ?, INSIGHTS_MERGED_COMMITS_COUNT = ?, INSIGHTS_CODE_ACTIVITIES_COUNT = ?, INSIGHTS_ENGAGED_FOUNDATION_IDS = ? WHERE PERSON_KEY = ? AND TIME_RANGE = ?`
        )
        .run(...counts, foundations, key, range);
    }

    beforeEach(() => {
      database.exec('ALTER TABLE ORG_PEOPLE_TRAINING ADD COLUMN FOUNDATION_ID TEXT; ALTER TABLE ORG_PEOPLE_TRAINING ADD COLUMN FOUNDATION_NAME TEXT;');
      for (const table of ['ORG_PEOPLE_ALL_RANGES', 'ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS']) {
        database.exec(`
          ALTER TABLE ${table} ADD COLUMN INSIGHTS_COMMITS_COUNT INTEGER DEFAULT 0;
          ALTER TABLE ${table} ADD COLUMN INSIGHTS_MERGED_COMMITS_COUNT INTEGER DEFAULT 0;
          ALTER TABLE ${table} ADD COLUMN INSIGHTS_CODE_ACTIVITIES_COUNT INTEGER DEFAULT 0;
          ALTER TABLE ${table} ADD COLUMN INSIGHTS_ENGAGED_FOUNDATION_IDS TEXT;
        `);
      }
      database.exec('ALTER TABLE ORG_PEOPLE_ALL_RANGES ADD COLUMN CERTIFICATIONS_COUNT INTEGER DEFAULT 0');
      for (const column of ['COMMITS', 'MERGED_COMMITS', 'SCOPE_COMMITS', 'SCOPE_MERGED_COMMITS', 'CODE_ACTIVITIES']) {
        database.exec(`ALTER TABLE ORG_PEOPLE_CONTRIBUTORS_DAILY ADD COLUMN INSIGHTS_DAILY_${column} INTEGER DEFAULT 0`);
      }
    });

    it('lists current employees with Insights-scoped code or another engagement, counting only that code, under insights', async () => {
      grantInsights();
      addRangeRow(ACCOUNT, 'person-insights', '365d', false, 'insights', 'Insights Coder', 'insights@company.example', 10);
      setInsightsCounts('ORG_PEOPLE_ALL_RANGES', 'person-insights', '365d', [4, 3, 6]);
      addRangeRow(ACCOUNT, 'person-other-org', '365d', false, 'otherorg', 'Other Org Coder', 'other@company.example', 8);
      addRangeRow(ACCOUNT, 'person-seat', '365d', false, 'seat', 'Seat Holder', 'seat@company.example', 5);
      database.exec(`UPDATE ORG_PEOPLE_ALL_RANGES SET SEATS_COUNT = 1 WHERE PERSON_KEY = 'person-seat'`);

      const response = await service.getAllEmployees(ACCOUNT, '365d', FILTERS, 'exclude', 'insights');

      expect(resolveOrgScope).toHaveBeenCalledWith(expect.anything(), ACCOUNT, 'insights');
      expect(response.rows.map((row) => [row.personKey, row.commitsCount])).toEqual([
        ['person-insights', 4],
        ['person-seat', 0],
      ]);
      const rosterRead = queries().find(
        (query) => /FROM ORG_PEOPLE_ALL_RANGES|PLATINUM_LFX_ONE\.ORG_PEOPLE_ALL_RANGES/.test(query) && /IS_FORMER = FALSE/.test(query)
      );
      expect(rosterRead).toContain('INSIGHTS_COMMITS_COUNT AS COMMITS_COUNT');
      expect(rosterRead).toContain('INSIGHTS_CODE_ACTIVITIES_COUNT AS CODE_ACTIVITIES_COUNT');
      expect(rosterRead).toContain('INSIGHTS_ENGAGED_FOUNDATION_IDS AS ENGAGED_FOUNDATION_IDS');
      expect(rosterRead).toContain(
        'AND (INSIGHTS_CODE_ACTIVITIES_COUNT > 0 OR SEATS_COUNT > 0 OR EVENTS_COUNT > 0 OR COURSES_COUNT > 0 OR CERTIFICATIONS_COUNT > 0)'
      );
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all:insights')!)).toBe(true);
    });

    it("reads today's roster SQL and key when an insights request resolves to all", async () => {
      addRangeRow(ACCOUNT, 'person-other-org', '365d', false, 'otherorg', 'Other Org Coder', 'other@company.example', 8);

      const response = await service.getAllEmployees(ACCOUNT, '365d', FILTERS, 'exclude', 'insights');

      expect(response.rows.map((row) => [row.personKey, row.commitsCount])).toEqual([['person-other-org', 8]]);
      expect(queries().some((query) => query.includes('INSIGHTS'))).toBe(false);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all:all')!)).toBe(true);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all:insights')!)).toBe(false);
    });

    it('leaves the unranged roster unscoped, without resolving the scope', async () => {
      grantInsights();

      await service.getAllEmployees(ACCOUNT, null, FILTERS, 'exclude', 'insights');

      expect(resolveOrgScope).not.toHaveBeenCalled();
      expect(queries().some((query) => query.includes('INSIGHTS'))).toBe(false);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-all:v4:roster')!)).toBe(true);
    });

    it('lists former and unclassified people only for Insights-scoped code under insights, with its foundation labels, still naming every unclassified person', async () => {
      grantInsights();
      addRangeRow(ACCOUNT, 'former-insights', '365d', true, 'formerinsights', 'Former Insights', null, 9);
      setInsightsCounts('ORG_PEOPLE_ALL_RANGES', 'former-insights', '365d', [2, 2, 2]);
      addRangeRow(ACCOUNT, 'former-other-org', '365d', true, 'formerother', 'Former Other', null, 9);
      addDailyCode(ACCOUNT, 'former-insights', daysAgo(5), 'foundation-two', 'Foundation Two');
      addDailyCode(ACCOUNT, 'former-other-org', daysAgo(5), 'foundation-x', 'Foundation X');
      addUnclassifiedRow(ACCOUNT, 'unclassified-insights', '365d', 'uninsights', 'Unclassified Insights', 5);
      setInsightsCounts('ORG_PEOPLE_UNCLASSIFIED_CONTRIBUTORS', 'unclassified-insights', '365d', [1, 1, 3]);
      addUnclassifiedRow(ACCOUNT, 'unclassified-other-org', '365d', 'unother', 'Unclassified Other', 5);

      const response = await service.getFormerEmployees(REQ, ACCOUNT, '365d', FILTERS, 'exclude', 'insights');

      expect(response.rows.map((row) => [row.personKey, row.commitsCount])).toEqual([
        ['former-insights', 2],
        ['unclassified-insights', 1],
      ]);
      expect(response.foundations).toEqual([{ foundationId: 'foundation-two', foundationName: 'Foundation Two' }]);
      // Someone with no employment record but only other organizations' code is not listed, but is still named, so the
      // page never takes their access-only live row for a current employee.
      expect(response.unclassifiedUsernames?.sort()).toEqual(['uninsights', 'unother']);
      const offRoster = queries().filter((query) => /ORG_PEOPLE_(ALL_RANGES|UNCLASSIFIED_CONTRIBUTORS)/.test(query) && !/IS_FORMER = FALSE/.test(query));
      const scopedRowReads = offRoster.filter((query) => query.includes('ORDER BY NAME') && query.includes('INSIGHTS_COMMITS_COUNT AS COMMITS_COUNT'));
      const scopedLabelReads = offRoster.filter((query) => query.includes('INNER JOIN') && query.includes('f.INSIGHTS_CODE_ACTIVITIES_COUNT'));
      expect(scopedRowReads).toHaveLength(2);
      expect(scopedLabelReads).toHaveLength(2);
      for (const query of scopedRowReads) expect(query).toContain('AND INSIGHTS_CODE_ACTIVITIES_COUNT > 0');
      for (const query of scopedLabelReads) expect(query).toContain('AND f.INSIGHTS_CODE_ACTIVITIES_COUNT > 0');
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:all:insights')!)).toBe(true);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-unclassified:v1:365d:all:insights')!)).toBe(true);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-unclassified:v1:365d:all:all')!)).toBe(true);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-former:v3:365d:all:all')!)).toBe(false);
    });

    it("counts the Code tab's Insights-scoped code under insights, and today's code under all", async () => {
      database
        .prepare(
          `INSERT INTO ORG_PEOPLE_CONTRIBUTORS_DAILY (
            ACCOUNT_ID, PERSON_KEY, PROJECT_ID, ACTIVITY_DATE, FOUNDATION_ID, FOUNDATION_NAME, IS_LF_PROJECT, CDP_MEMBER_ID, DISPLAY_NAME, PROJECT_NAME,
            DAILY_COMMITS, DAILY_MERGED_COMMITS, DAILY_SCOPE_COMMITS, DAILY_SCOPE_MERGED_COMMITS, DAILY_CODE_ACTIVITIES,
            INSIGHTS_DAILY_COMMITS, INSIGHTS_DAILY_MERGED_COMMITS, INSIGHTS_DAILY_SCOPE_COMMITS, INSIGHTS_DAILY_SCOPE_MERGED_COMMITS, INSIGHTS_DAILY_CODE_ACTIVITIES
          ) VALUES (?, ?, ?, ?, 'foundation-one', 'Foundation One', 1, 'cdp', 'name', 'Project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(ACCOUNT, personKey, 'project-both', daysAgo(10), 6, 6, 6, 6, 9, 2, 2, 2, 2, 3);
      database
        .prepare(
          `INSERT INTO ORG_PEOPLE_CONTRIBUTORS_DAILY (
            ACCOUNT_ID, PERSON_KEY, PROJECT_ID, ACTIVITY_DATE, FOUNDATION_ID, FOUNDATION_NAME, IS_LF_PROJECT, CDP_MEMBER_ID, DISPLAY_NAME, PROJECT_NAME,
            DAILY_COMMITS, DAILY_MERGED_COMMITS, DAILY_SCOPE_COMMITS, DAILY_SCOPE_MERGED_COMMITS, DAILY_CODE_ACTIVITIES
          ) VALUES (?, ?, ?, ?, 'foundation-one', 'Foundation One', 1, 'cdp', 'name', 'Project', 4, 4, 4, 4, 4)`
        )
        .run(ACCOUNT, personKey, 'project-other-org', daysAgo(10));
      const commits: OrgCommitFilters = { projectScope: 'all', commitScope: 'all', metric: 'commits' };

      const all = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '365d', commits, 'include', 'all');
      expect(all.code.map((row) => [row.projectId, row.commits])).toEqual([
        ['project-both', 6],
        ['project-other-org', 4],
      ]);

      grantInsights();
      execute.mockClear();
      const insights = await service.getEmployeeDetail(REQ, ACCOUNT, personKey, '365d', commits, 'include', 'insights');

      expect(insights.code.map((row) => [row.projectId, row.commits])).toEqual([['project-both', 2]]);
      expect(insights.totalCommits).toBe(2);
      const codeRead = queries().find((query) => query.includes('ORG_PEOPLE_CONTRIBUTORS_DAILY') && query.includes('GROUP BY project_id'));
      expect(codeRead).toContain('SUM(insights_daily_commits) AS COMMITS');
      expect(codeRead).toContain('SUM(insights_daily_code_activities) AS CODE_ACTIVITIES');
      expect(codeRead).toContain('AND insights_daily_code_activities > 0');
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail-code-view:v1:${personKey}:365d:all:insights`)!)).toBe(true);
      expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, `people-detail-code-view:v1:${personKey}:365d:all:all`)!)).toBe(true);
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

    const wire = await service.getAllEmployees(ACCOUNT, '365d', FILTERS, 'include');

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
    expect((await service.getAllEmployees(ACCOUNT, '365d', FILTERS, 'include')).stats).toEqual({
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
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-all:v4:365d:all:all')!, JSON.stringify(legacy));
    mockRoster();

    const response = await service.getAllEmployeesInternal(ACCOUNT, '365d', 'all');

    expect(response.rows.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});
