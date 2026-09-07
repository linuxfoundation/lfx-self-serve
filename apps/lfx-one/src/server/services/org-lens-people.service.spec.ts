// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import { agreedUsername } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getLive, isServerFeatureEnabled } = vi.hoisted(() => ({
  execute: vi.fn(),
  getLive: vi.fn(),
  isServerFeatureEnabled: vi.fn(),
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
vi.mock('./valkey.service', () => ({
  withOrgCache: (_account: string, _key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
}));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn() },
}));
vi.mock('../helpers/server-feature-flag.helper', () => ({
  isServerFeatureEnabled,
  ServerFeatureFlag: { OrgLensCompanyEmails: 'org-lens-company-emails' },
}));

import { OrgLensPeopleService } from './org-lens-people.service';

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: (string | number)[]): unknown;
    all(...values: string[]): Record<string, unknown>[];
  };
  close(): void;
}

// The runtime is Node 22+, while this app's Node typings predate its built-in SQLite module.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqlDatabase };

const ACCOUNT = 'account-one';
const LIVE_PERSON = 'live-access-mixeduser';
const GOVERNANCE_USERNAME = agreedUsername([' MixedUser ', 'mixeduser'])!;
const UNAVAILABLE = { companyEmails: [], companyEmailsStatus: 'unavailable' };
let database: SqlDatabase;
let service: OrgLensPeopleService;

function addPerson(account: string, personKey: string, username: string, emails: string[] = []): void {
  database.prepare('INSERT INTO _ORG_PEOPLE_SPINE VALUES (?, ?, ?)').run(account, personKey, username);
  const insertEmail = database.prepare('INSERT INTO ORG_PEOPLE_COMPANY_EMAILS VALUES (?, ?, ?, ?, ?)');
  for (const [index, email] of emails.entries()) {
    insertEmail.run(account, personKey, username, email, index === 0 ? 1 : 0);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE _ORG_PEOPLE_SPINE (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT);
    CREATE TABLE ORG_PEOPLE_COMPANY_EMAILS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LF_USERNAME TEXT, EMAIL TEXT, IS_PRIMARY INTEGER);
  `);
  // Execute the service's relational query rather than duplicating its identity matching in a mock.
  // Only Snowflake's database/schema qualifier is removed for the in-memory SQL engine.
  execute.mockImplementation(async (query: string, binds: string[]) => ({
    rows: database.prepare(query.replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')).all(...binds),
  }));
  isServerFeatureEnabled.mockReturnValue(true);
  getLive.mockResolvedValue({ rows: [{ personKey: LIVE_PERSON, lfUsername: 'mixeduser' }] });
  service = new OrgLensPeopleService();
});

afterEach(() => {
  database.close();
});

async function expectBothPaths(expected: { companyEmails: string[]; companyEmailsStatus: string }): Promise<void> {
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

  it('reports no addresses only for a uniquely resolved mixed-case identity', async () => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser');

    await expectBothPaths({ companyEmails: [], companyEmailsStatus: 'resolved' });
  });

  it.each([
    { description: 'both people have addresses', secondEmails: ['second@company.example'] },
    { description: 'only one person has addresses', secondEmails: [] },
  ])('fails closed for case-folded identity collisions when $description', async ({ secondEmails }) => {
    addPerson(ACCOUNT, 'person-one', 'MixedUser', ['first@company.example']);
    addPerson(ACCOUNT, 'person-two', 'mixeduser', secondEmails);

    await expectBothPaths(UNAVAILABLE);
  });

  it('does not treat identities that exist only at another account as resolved', async () => {
    addPerson('other-account', 'person-one', 'MixedUser', ['other@other.example']);

    await expectBothPaths(UNAVAILABLE);
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

  it('reports warehouse failures without claiming there are no addresses', async () => {
    execute.mockRejectedValue(new Error('warehouse unavailable'));

    await expectBothPaths({ companyEmails: [], companyEmailsStatus: 'failed' });
  });
});
