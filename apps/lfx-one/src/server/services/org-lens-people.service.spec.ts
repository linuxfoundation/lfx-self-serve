// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { OrgPersonCompanyEmailsResponse } from '@lfx-one/shared/interfaces';
import { agreedUsername } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getLive, isServerFeatureEnabled, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  getLive: vi.fn(),
  isServerFeatureEnabled: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/string.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/org-people.constants')),
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
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
vi.mock('../helpers/server-feature-flag.helper', () => ({
  isServerFeatureEnabled,
  ServerFeatureFlag: { OrgLensCompanyEmails: 'org-lens-company-emails' },
}));

import { OrgLensPeopleService } from './org-lens-people.service';
import { ValkeyService } from './valkey.service';

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: (string | number)[]): unknown;
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

function addPerson(account: string, personKey: string, username: string, emails: string[] = []): void {
  const insertEmail = database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)');
  for (const [index, email] of emails.entries()) {
    insertEmail.run(account, personKey, username, email, index === 0 ? 1 : 0);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  cacheValues.clear();
  ValkeyService.resetInstance();
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE ORG_PEOPLE_COMPANY_EMAILS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT, EMAIL TEXT, IS_PRIMARY INTEGER)');
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
  isServerFeatureEnabled.mockReturnValue(true);
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
  expect(await service.getEmployeeDetail({} as never, ACCOUNT, LIVE_PERSON)).toMatchObject(expected);
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

  it('keeps addresses unavailable when the server flag is disabled', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['someone@company.example']);
    isServerFeatureEnabled.mockReturnValue(false);

    await expectBothPaths(UNAVAILABLE);
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
    expect(cacheValues.size).toBe(2);
    for (const key of cacheValues.keys()) {
      expect(key.toLowerCase()).not.toContain('mixeduser');
    }
  });

  it('does not serve cached username addresses when the server kill switch is off', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser');
    isServerFeatureEnabled.mockReturnValue(false);
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual(UNAVAILABLE);
    isServerFeatureEnabled.mockReturnValue(true);
    expect(await service.getCompanyEmailsByUsername(ACCOUNT, 'mixeduser')).toEqual({
      companyEmails: ['first@company.example'],
      companyEmailsStatus: 'resolved',
    });
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

  it('returns only the keyed person and account addresses in primary-first alphabetical order alongside activity', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['z-primary@company.example', 'b-secondary@company.example', 'a-secondary@company.example']);
    addPerson('other-account', personKey, 'MixedUser', ['other-employer@other.example']);
    addPerson(ACCOUNT, 'person-two', 'mixeduser', ['other-person@company.example']);

    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toEqual({
      personKey,
      ...activity,
      companyEmails: ['z-primary@company.example', 'a-secondary@company.example', 'b-secondary@company.example'],
      companyEmailsStatus: 'resolved',
    });
  });

  it('preserves board, committee, code, event and training activity when the optional keyed email lookup fails', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['first@company.example']);
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');

    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toEqual({
      personKey,
      ...activity,
      companyEmails: [],
      companyEmailsStatus: 'failed',
    });
  });

  it('retries a failed email lookup instead of replaying the failure from cache', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['first@company.example']);
    database.exec('ALTER TABLE ORG_PEOPLE_COMPANY_EMAILS RENAME TO SAVED_EMAILS');
    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toMatchObject({
      companyEmailsStatus: 'failed',
      companyEmails: [],
    });
    database.exec('ALTER TABLE SAVED_EMAILS RENAME TO ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toMatchObject({
      companyEmailsStatus: 'resolved',
      companyEmails: ['first@company.example'],
    });
    database.exec('DROP TABLE ORG_PEOPLE_COMPANY_EMAILS');
    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toMatchObject({
      companyEmailsStatus: 'resolved',
      companyEmails: ['first@company.example'],
    });
  });

  it('does not serve cached addresses after the server flag turns off or retain the off state after enabling', async () => {
    addPerson(ACCOUNT, personKey, 'MixedUser', ['first@company.example']);
    isServerFeatureEnabled.mockReturnValue(false);
    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toMatchObject(UNAVAILABLE);
    isServerFeatureEnabled.mockReturnValue(true);
    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toMatchObject({
      companyEmailsStatus: 'resolved',
      companyEmails: ['first@company.example'],
    });
    isServerFeatureEnabled.mockReturnValue(false);
    expect(await service.getEmployeeDetail({} as never, ACCOUNT, personKey)).toMatchObject(UNAVAILABLE);
  });
});
