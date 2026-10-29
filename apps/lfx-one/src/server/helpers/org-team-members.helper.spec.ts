// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { orgTeamMembersPredicate } from './org-team-members.helper';

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../services/valkey.service', () => ({ withOrgCache: vi.fn() }));

// node:sqlite needs Node >= 22.13; this app's Node typings predate the module, hence the local shape.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => { exec(sql: string): void; prepare(sql: string): { all(): Record<string, unknown>[] } };
};

/** The people a read keeps for the pick, over one row flagged TRUE, one FALSE and one with an unknown (NULL) flag. */
function keptPeople(teamMembers: 'include' | 'exclude'): unknown[] {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE ROWS (PERSON_KEY TEXT, IS_CDP_TEAM_MEMBER INTEGER)');
  database.exec("INSERT INTO ROWS VALUES ('team-member', 1), ('employee', 0), ('unknown-flag', NULL)");
  return database
    .prepare(`SELECT PERSON_KEY FROM ROWS WHERE 1 = 1 ${orgTeamMembersPredicate(teamMembers, 'IS_CDP_TEAM_MEMBER')} ORDER BY PERSON_KEY`)
    .all()
    .map((row) => row['PERSON_KEY']);
}

describe('orgTeamMembersPredicate (lfx-self-serve#4685)', () => {
  it('drops only rows flagged TRUE under exclude, keeping a row whose flag is unknown (NULL)', () => {
    expect(orgTeamMembersPredicate('exclude', 'IS_CDP_TEAM_MEMBER')).toBe('AND NOT COALESCE(IS_CDP_TEAM_MEMBER, FALSE)');
    expect(keptPeople('exclude')).toEqual(['employee', 'unknown-flag']);
  });

  it('adds nothing under include, so every row is kept', () => {
    expect(orgTeamMembersPredicate('include')).toBe('');
    expect(keptPeople('include')).toEqual(['employee', 'team-member', 'unknown-flag']);
  });

  it('defaults to the lowercase column of the People models', () => {
    expect(orgTeamMembersPredicate('exclude')).toBe('AND NOT COALESCE(is_cdp_team_member, FALSE)');
  });
});
