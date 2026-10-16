// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, filterReadableAccountIds } = vi.hoisted(() => ({ execute: vi.fn(), filterReadableAccountIds: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = vi.fn(() => false);
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../helpers/org-analytics-access.helper', () => ({ filterReadableAccountIds }));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import { MAX_SNOWFLAKE_PAGINATION_PAGE, PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS, PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE } from '@lfx-one/shared/constants';

import { logger } from './logger.service';
import { ProjectParticipatingOrgsService } from './project-participating-orgs.service';

import type { ProjectParticipatingOrgsQuery } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const req = {} as Request;
const MEMBER_A = '001SYNTHMEMBERAAAA';
const MEMBER_B = '001SYNTHMEMBERBBBB';
const NON_MEMBER = '001SYNTHNONMEMBERA';

const baseQuery: ProjectParticipatingOrgsQuery = { range: '12mo', segment: 'all', sort: 'commits', dir: 'desc', pageSize: 25, offset: 0 };

function row(overrides: Record<string, unknown> = {}) {
  return {
    TOTAL_RECORDS: 3,
    FOUNDATION_SLUG_TOTAL: 'synthetic-foundation',
    IS_PAGE_ROW: true,
    PARTICIPANT_KEY: MEMBER_A,
    ACCOUNT_ID: MEMBER_A,
    PARTICIPANT_NAME: 'Synthetic Member A',
    PARTICIPANT_LOGO_URL: null,
    IS_UNIDENTIFIED: false,
    IS_MEMBER: true,
    MEMBERSHIP_TIER_CLASS: 'Gold',
    COMMITS: 120,
    COMMITS_PREV: 80,
    CONTRIBUTORS: 9,
    CONTRIBUTORS_PREV: null,
    ...overrides,
  };
}

function lastCall(): [string, unknown[]] {
  return execute.mock.calls.at(-1) as [string, unknown[]];
}

function placeholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

describe('ProjectParticipatingOrgsService.getPage', () => {
  const service = new ProjectParticipatingOrgsService();

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [row()] });
    filterReadableAccountIds.mockResolvedValue([]);
  });

  it.each([
    ['no filters', {}, ['synthetic-project', '12mo']],
    ['search', { search: '50%_off!' }, ['synthetic-project', '12mo', '%50!%!_off!!%']],
    ['tier', { tier: 'Gold' }, ['synthetic-project', '12mo', 'Gold']],
    ['tier + search', { tier: 'Silver', search: 'syn' }, ['synthetic-project', '12mo', 'Silver', '%syn%']],
  ])('binds one value per placeholder (%s)', async (_label, extra, expectedBinds) => {
    await service.getPage(req, 'synthetic-project', { ...baseQuery, ...extra } as ProjectParticipatingOrgsQuery);
    const [sql, binds] = lastCall();
    expect(binds).toEqual(expectedBinds);
    expect(placeholders(sql)).toBe(binds.length);
  });

  it('applies segment and tier predicates', async () => {
    await service.getPage(req, 's', { ...baseQuery, segment: 'members' });
    expect(lastCall()[0]).toMatch(/WHERE is_member\s/);

    await service.getPage(req, 's', { ...baseQuery, segment: 'non_members' });
    expect(lastCall()[0]).toContain('WHERE NOT is_member');

    // A tier implies members even on the All tab.
    await service.getPage(req, 's', { ...baseQuery, tier: 'Gold' });
    expect(lastCall()[0]).toContain('WHERE is_member AND membership_tier_class = ?');

    await service.getPage(req, 's', baseQuery);
    expect(lastCall()[0]).toContain('SELECT * FROM scoped \n');
  });

  it.each(['asc', 'desc'] as const)('ranks members by tier and keeps non-members last (%s)', async (dir) => {
    await service.getPage(req, 's', { ...baseQuery, sort: 'tier', dir });
    const sql = lastCall()[0];
    expect(sql).toContain(`ORDER BY CASE WHEN is_member THEN tier_rank END ${dir.toUpperCase()} NULLS LAST, commits DESC NULLS LAST, participant_key ASC`);
    expect(sql).toContain(`ORDER BY CASE WHEN page.is_member THEN page.tier_rank END ${dir.toUpperCase()} NULLS LAST`);
  });

  it('maps sort keys to allowlisted expressions and ignores unknown ones', async () => {
    await service.getPage(req, 's', { ...baseQuery, sort: 'name', dir: 'asc' });
    expect(lastCall()[0]).toContain('ORDER BY LOWER(TRIM(participant_name)) ASC NULLS LAST');

    await service.getPage(req, 's', { ...baseQuery, sort: 'contributors' });
    expect(lastCall()[0]).toContain('ORDER BY contributors DESC NULLS LAST');

    await service.getPage(req, 's', { ...baseQuery, sort: 'x; DROP TABLE t' as never, dir: 'sideways' as never });
    const sql = lastCall()[0];
    expect(sql).not.toContain('DROP');
    expect(sql).toContain('ORDER BY commits DESC NULLS LAST');
  });

  it.each(['asc', 'desc'] as const)('sorts on the %% change with no-baseline rows last (%s)', async (dir) => {
    await service.getPage(req, 's', { ...baseQuery, sort: 'commits_change', dir });
    expect(lastCall()[0]).toContain(`ORDER BY (commits - commits_prev) / NULLIF(commits_prev, 0) ${dir.toUpperCase()} NULLS LAST`);

    await service.getPage(req, 's', { ...baseQuery, sort: 'contributors_change', dir });
    expect(lastCall()[0]).toContain(`ORDER BY (contributors - contributors_prev) / NULLIF(contributors_prev, 0) ${dir.toUpperCase()} NULLS LAST`);
  });

  it('trims warehouse names, falling back to the row key when nothing is left', async () => {
    execute.mockResolvedValue({
      rows: [row({ PARTICIPANT_NAME: '  Synthetic Spaced Co  ' }), row({ PARTICIPANT_KEY: MEMBER_B, ACCOUNT_ID: MEMBER_B, PARTICIPANT_NAME: '   ' })],
    });

    const page = await service.getPage(req, 's', baseQuery);

    expect(page.rows.map((r) => r.name)).toEqual(['Synthetic Spaced Co', MEMBER_B]);
  });

  it('clamps page size and offset before interpolating them', async () => {
    await service.getPage(req, 's', { ...baseQuery, pageSize: 10_000, offset: -5 });
    expect(lastCall()[0]).toContain(`LIMIT ${PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE} OFFSET 0`);

    await service.getPage(req, 's', { ...baseQuery, pageSize: 25, offset: Number.MAX_SAFE_INTEGER });
    expect(lastCall()[0]).toContain(`LIMIT 25 OFFSET ${MAX_SNOWFLAKE_PAGINATION_PAGE * 25}`);
  });

  it('maps rows, totals and the foundation slug, and keeps totals for an empty page', async () => {
    const page = await service.getPage(req, 's', baseQuery);
    expect(page).toEqual({
      totalRecords: 3,
      foundationSlug: 'synthetic-foundation',
      rows: [
        {
          participantKey: MEMBER_A,
          accountId: MEMBER_A,
          name: 'Synthetic Member A',
          logoUrl: null,
          isUnidentified: false,
          isMember: true,
          membershipTierClass: 'Gold',
          commits: 120,
          commitsPrev: 80,
          contributors: 9,
          contributorsPrev: null,
          canOpenOrgLens: false,
        },
      ],
    });

    execute.mockResolvedValueOnce({ rows: [{ TOTAL_RECORDS: 0, FOUNDATION_SLUG_TOTAL: 'synthetic-foundation', IS_PAGE_ROW: null, PARTICIPANT_KEY: null }] });
    expect(await service.getPage(req, 's', baseQuery)).toEqual({ rows: [], totalRecords: 0, foundationSlug: 'synthetic-foundation' });
  });

  it('marks canOpenOrgLens only on readable member rows and asks only about members', async () => {
    execute.mockResolvedValue({
      rows: [
        row(),
        row({ PARTICIPANT_KEY: MEMBER_B, ACCOUNT_ID: MEMBER_B, PARTICIPANT_NAME: 'Synthetic Member B' }),
        row({ PARTICIPANT_KEY: NON_MEMBER, ACCOUNT_ID: NON_MEMBER, IS_MEMBER: false, MEMBERSHIP_TIER_CLASS: null }),
        row({ PARTICIPANT_KEY: 'cdev:synthetic-1', ACCOUNT_ID: null, IS_MEMBER: false, IS_UNIDENTIFIED: true, MEMBERSHIP_TIER_CLASS: null }),
      ],
    });
    filterReadableAccountIds.mockResolvedValue([MEMBER_A, NON_MEMBER]);

    const page = await service.getPage(req, 's', baseQuery);

    expect(filterReadableAccountIds).toHaveBeenCalledWith(req, [MEMBER_A, MEMBER_B], 'get_project_participating_orgs');
    expect(page.rows.map((r) => [r.participantKey, r.canOpenOrgLens])).toEqual([
      [MEMBER_A, true],
      [MEMBER_B, false],
      [NON_MEMBER, false],
      ['cdev:synthetic-1', false],
    ]);
  });

  it('degrades every link to false when the Org Lens check throws, still returning the page', async () => {
    filterReadableAccountIds.mockRejectedValue(new Error('authorizer down'));

    const page = await service.getPage(req, 's', baseQuery);

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].canOpenOrgLens).toBe(false);
    expect(logger.warning).toHaveBeenCalled();
  });
});

describe('ProjectParticipatingOrgsService.getExportRows', () => {
  const service = new ProjectParticipatingOrgsService();
  const filters = { range: 'all' as const, segment: 'all' as const, sort: 'commits' as const, dir: 'desc' as const };

  beforeEach(() => vi.clearAllMocks());

  it('reads one row past the cap and reports truncation without Org Lens checks', async () => {
    execute.mockResolvedValue({
      rows: Array.from({ length: PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS + 1 }, (_, i) => row({ PARTICIPANT_KEY: `cdev:${i}` })),
    });

    const result = await service.getExportRows(req, 's', { ...filters, search: 'syn' });
    const [sql, binds] = lastCall();

    expect(sql).toContain(`LIMIT ${PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS + 1}`);
    expect(placeholders(sql)).toBe(binds.length);
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS);
    expect(filterReadableAccountIds).not.toHaveBeenCalled();
  });

  it('is not truncated at exactly the cap', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS }, (_, i) => row({ PARTICIPANT_KEY: `cdev:${i}` })) });
    expect((await service.getExportRows(req, 's', filters)).truncated).toBe(false);
  });
});

describe('ProjectParticipatingOrgsService.getSummary', () => {
  const service = new ProjectParticipatingOrgsService();

  beforeEach(() => vi.clearAllMocks());

  it('returns null when the project has no activity in the range', async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await service.getSummary(req, 's', '30d')).toBeNull();
    const [sql, binds] = lastCall();
    expect(binds).toEqual(['s', '30d']);
    expect(placeholders(sql)).toBe(2);
  });

  it('maps counts and keeps an unmeasurable share null', async () => {
    execute.mockResolvedValue({
      rows: [
        {
          PROJECT_SLUG: 's',
          FOUNDATION_SLUG: 'synthetic-foundation',
          FOUNDATION_NAME: 'Synthetic Foundation',
          AS_OF_DATE: new Date(Date.UTC(2026, 9, 1)),
          ORGS_COUNT: 10,
          MEMBERS_COUNT: 4,
          NON_MEMBERS_COUNT: 6,
          UNIDENTIFIED_COUNT: 2,
          MEMBER_COMMITS: 0,
          COMPANY_COMMITS: 0,
          ALL_COMMITS: 5,
          MEMBER_COMMIT_SHARE_OF_COMPANY_COMMITS: null,
        },
      ],
    });

    expect(await service.getSummary(req, 's', '12mo')).toEqual({
      projectSlug: 's',
      foundationSlug: 'synthetic-foundation',
      foundationName: 'Synthetic Foundation',
      range: '12mo',
      asOfDate: '2026-10-01',
      orgsCount: 10,
      membersCount: 4,
      nonMembersCount: 6,
      unidentifiedCount: 2,
      memberCommits: 0,
      companyCommits: 0,
      allCommits: 5,
      memberCommitShareOfCompanyCommits: null,
    });
  });
});
