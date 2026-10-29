// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_CONTRIBUTIONS_QUERY } from '@lfx-one/shared/constants';
import type { OrgContributionsQuery } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, withOrgCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withOrgCache: vi.fn(),
}));

// The `@lfx-one/shared/utils` barrel pulls Angular; the service only needs these modules
// (vi.mock factories are hoisted, so they load dynamically).
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-commit-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-team-members.utils')),
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache }));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgContributionsService } from './org-contributions.service';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
const COMMITS_TABLE = 'ORG_CODE_CONTRIBUTIONS';
const CODE_TABLE = 'ORG_CODE_ACTIVITY_DAILY';

function query(overrides: Partial<OrgContributionsQuery> = {}): OrgContributionsQuery {
  return { ...EMPTY_ORG_CONTRIBUTIONS_QUERY, ...overrides };
}

/** Every Snowflake call of the last request as `{ sql, binds }`. */
function calls(): { sql: string; binds: unknown[] }[] {
  return execute.mock.calls.map(([sql, binds]) => ({ sql: sql as string, binds: binds as unknown[] }));
}

/** The one call whose SQL selects the given column alias (each read has a distinctive one). */
function callSelecting(marker: string): { sql: string; binds: unknown[] } {
  const match = calls().find((call) => call.sql.includes(marker));
  if (!match) {
    throw new Error(`no query selects ${marker}`);
  }
  return match;
}

const kpiCall = () => callSelecting('PROJECTS_WITH_ACTIVITY');
const repoCall = () => callSelecting('repository_path,');
const feedCall = () => callSelecting('commit_message,');
const foundationOptionCall = () => callSelecting('GROUP BY foundation_id');
const projectOptionCall = () => callSelecting('GROUP BY project_id');
const employeeOptionCall = () => callSelecting('ANY_VALUE(member_display_name)');
/** Every read but the foundation options, which always read code activity. */
const commitReads = () => calls().filter((call) => !call.sql.includes('GROUP BY foundation_id'));

let service: OrgContributionsService;

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ rows: [] });
  withOrgCache.mockImplementation(async (_account: string, _key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
  service = new OrgContributionsService();
});

describe('OrgContributionsService — commit filters', () => {
  it.each([
    ['all', null],
    ['lf', 'is_lf_project = TRUE'],
    ['non_lf', 'is_lf_project = FALSE'],
  ] as const)('projectScope=%s narrows every commit read', async (projectScope, predicate) => {
    await service.getContributions(ACCOUNT, query({ projectScope }));

    expect(execute).toHaveBeenCalledTimes(6);
    for (const { sql } of calls()) {
      if (predicate) {
        expect(sql).toContain(predicate);
      } else {
        expect(sql).not.toContain('is_lf_project');
      }
    }
  });

  it('adds is_merged = TRUE to every commit read only when commitScope=merged', async () => {
    await service.getContributions(ACCOUNT, query());
    expect(calls().some(({ sql }) => sql.includes('is_merged'))).toBe(false);

    execute.mockClear();
    await service.getContributions(ACCOUNT, query({ metric: 'commits', commitScope: 'merged' }));
    expect(execute).toHaveBeenCalledTimes(6);
    for (const { sql } of commitReads()) {
      expect(sql).toContain('is_merged = TRUE');
    }
  });

  it('reads every surface but the foundation options from the commits table with metric=commits', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'commits' }));

    expect(commitReads()).toHaveLength(5);
    for (const { sql } of commitReads()) {
      expect(sql).toContain(COMMITS_TABLE);
      expect(sql).not.toContain(CODE_TABLE);
    }
  });
});

describe('OrgContributionsService — range window', () => {
  it('windows Past 365 days as 365 calendar days, on every commit read', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'commits', dateRange: '365d' }));

    expect(execute).toHaveBeenCalledTimes(6);
    for (const { sql } of commitReads()) {
      expect(sql).toContain('activity_ts::date >= DATEADD(day, -365, CURRENT_DATE())');
      expect(sql).not.toContain('CURRENT_TIMESTAMP');
      expect(sql).not.toContain('month');
    }
  });

  it('windows Past 365 days code activity on activity_date', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code', dateRange: '365d' }));

    expect(kpiCall().sql).toContain('activity_date >= DATEADD(day, -365, CURRENT_DATE())');
  });

  it('windows Past 2 years as 730 calendar days on the commit reads and on code activity', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'commits', dateRange: '730d' }));

    for (const { sql } of commitReads()) {
      expect(sql).toContain('activity_ts::date >= DATEADD(day, -730, CURRENT_DATE())');
    }

    execute.mockClear();
    await service.getContributions(ACCOUNT, query({ metric: 'code', dateRange: '730d' }));

    expect(kpiCall().sql).toContain('activity_date >= DATEADD(day, -730, CURRENT_DATE())');
    expect(feedCall().sql).toContain('activity_ts::date >= DATEADD(day, -730, CURRENT_DATE())');
  });

  it('reads all time without a date predicate', async () => {
    await service.getContributions(ACCOUNT, query({ dateRange: 'all' }));

    for (const { sql } of calls()) {
      expect(sql).not.toContain('DATEADD');
    }
  });
});

describe('OrgContributionsService — metric=code', () => {
  it('reads KPI, repositories and options from the daily code-activity table; the feed stays on commits', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code', projectScope: 'lf', commitScope: 'merged' }));

    for (const call of [kpiCall(), repoCall(), foundationOptionCall(), projectOptionCall(), employeeOptionCall()]) {
      expect(call.sql).toContain(CODE_TABLE);
      expect(call.sql).toContain('is_lf_project = TRUE');
      // Commit scope has no meaning for code activity.
      expect(call.sql).not.toContain('is_merged');
    }
    for (const call of [kpiCall(), repoCall(), projectOptionCall(), employeeOptionCall()]) {
      expect(call.sql).toContain('code_activities');
    }
    expect(kpiCall().sql).toContain(`FROM ANALYTICS.PLATINUM_LFX_ONE.${CODE_TABLE}`);

    const feed = feedCall();
    expect(feed.sql).toContain(COMMITS_TABLE);
    expect(feed.sql).not.toContain(CODE_TABLE);
    expect(feed.sql).toContain('is_lf_project = TRUE');
    expect(feed.sql).toContain('is_merged = TRUE');
  });

  it('windows code activity and the Commits feed on the same calendar-day boundary', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code', dateRange: '90d' }));

    expect(kpiCall().sql).toContain('activity_date >= DATEADD(day, -90, CURRENT_DATE())');
    expect(feedCall().sql).toContain('activity_ts::date >= DATEADD(day, -90, CURRENT_DATE())');
  });

  it('drops the search from the code KPI on the Commits tab but keeps it on the feed', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code', view: 'commits', search: 'fix' }));

    expect(kpiCall().sql).not.toContain('ILIKE');
    expect(kpiCall().binds).toEqual([ACCOUNT]);
    expect(feedCall().sql).toContain('commit_message ILIKE ?');
  });

  it('maps the activity total onto the commits KPI field', async () => {
    execute.mockImplementation(async (sql: string) =>
      sql.includes('PROJECTS_WITH_ACTIVITY') ? { rows: [{ PROJECTS_WITH_ACTIVITY: 3, REPOSITORIES: 7, COMMITS: 120 }] } : { rows: [] }
    );

    const response = await service.getContributions(ACCOUNT, query({ metric: 'code' }));

    expect(response.kpis).toEqual({ projectsWithActivity: 3, repositories: 7, commits: 120 });
  });
});

describe('OrgContributionsService — binds', () => {
  it.each(['commits', 'code'] as const)('binds one value per placeholder with foundation, projects, employees and search (metric=%s)', async (metric) => {
    for (const view of ['repositories', 'commits'] as const) {
      execute.mockClear();
      await service.getContributions(
        ACCOUNT,
        query({ metric, view, foundation: 'f-cncf', projects: ['cncf', 'k8s'], employees: ['m-1', 'm-2', 'm-3'], search: 'api' })
      );

      expect(execute).toHaveBeenCalledTimes(6);
      for (const { sql, binds } of calls()) {
        expect(binds).toHaveLength((sql.match(/\?/g) ?? []).length);
      }
    }
  });

  it("filters code activity on the daily table's own project and member columns, with no commits-table subquery", async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code', projects: ['cncf'], employees: ['m-1'], search: 'api' }));

    expect(kpiCall().sql).toContain('project_slug IN (?) OR project_id IN (?)');
    expect(kpiCall().sql).toContain('member_id IN (?)');
    for (const call of [kpiCall(), repoCall(), foundationOptionCall(), projectOptionCall(), employeeOptionCall()]) {
      expect(call.sql).not.toContain(COMMITS_TABLE);
    }
    expect(kpiCall().binds).toEqual([ACCOUNT, 'cncf', 'cncf', 'm-1', '%api%']);
    // The lifetime first-activity CTE takes its own account bind.
    expect(repoCall().binds).toEqual([ACCOUNT, ACCOUNT, 'cncf', 'cncf', 'm-1', '%api%']);
  });
});

// lfx-self-serve#4559 — the Project and Foundation filters mean what they mean on People → Contributors.
describe('OrgContributionsService — exact project and foundation filters', () => {
  it.each(['commits', 'code'] as const)(
    'matches a picked project by slug or id only, so a parent no longer pulls in its sub-projects (metric=%s)',
    async (metric) => {
      await service.getContributions(ACCOUNT, query({ metric, projects: ['cncf'] }));

      for (const call of [kpiCall(), repoCall(), feedCall()]) {
        expect(call.sql).toContain('AND (project_slug IN (?) OR project_id IN (?))');
        expect(call.sql).not.toContain('parent_slug');
      }
    }
  );

  it.each([
    // The code metric's lifetime first-activity CTE takes its own account bind; the commits metric reads lf-dbt's
    // lifetime first commit column, so it binds the account once.
    ['commits', [ACCOUNT]],
    ['code', [ACCOUNT, ACCOUNT]],
  ] as const)(
    'adds foundation_id = ? to every data read and the employee options, bound before the project, employee and search binds (metric=%s)',
    async (metric, repoAccountBinds) => {
      await service.getContributions(ACCOUNT, query({ metric, foundation: 'f-cncf', projects: ['k8s', 'helm'], employees: ['m-1'], search: 'api' }));

      for (const call of [kpiCall(), repoCall(), feedCall(), employeeOptionCall()]) {
        expect(call.sql).toContain('AND foundation_id = ?');
      }
      const picks = ['f-cncf', 'k8s', 'helm', 'k8s', 'helm', 'm-1'];
      expect(kpiCall().binds).toEqual([ACCOUNT, ...picks, '%api%']);
      expect(repoCall().binds).toEqual([...repoAccountBinds, ...picks, '%api%']);
      expect(feedCall().binds).toEqual([ACCOUNT, ...picks, '%api%', '%api%', '%api%', '%api%']);
      // Employee options skip the project and employee picks but narrow to the foundation.
      expect(employeeOptionCall().binds).toEqual([ACCOUNT, 'f-cncf']);
    }
  );

  it.each(['commits', 'code'] as const)('builds project options from the window and project type alone, whatever is picked (metric=%s)', async (metric) => {
    await service.getContributions(ACCOUNT, query({ metric, projectScope: 'lf', foundation: 'f-cncf', projects: ['k8s'], employees: ['m-1'] }));

    const { sql, binds } = projectOptionCall();
    expect(sql).toContain('is_lf_project = TRUE');
    expect(sql).toContain('ANY_VALUE(foundation_id) AS foundation_id');
    expect(sql).not.toContain('foundation_id = ?');
    expect(sql).not.toContain('project_slug IN');
    expect(sql).not.toContain('member_id IN');
    expect(binds).toEqual([ACCOUNT]);
  });

  it.each([
    ['commits', 'all'],
    ['commits', 'merged'],
    ['code', 'all'],
  ] as const)(
    'builds foundation options from code activity in the window and project type alone, whatever is picked (metric=%s, commitScope=%s)',
    async (metric, commitScope) => {
      await service.getContributions(
        ACCOUNT,
        query({ metric, commitScope, projectScope: 'lf', dateRange: '90d', foundation: 'f-cncf', projects: ['k8s'], employees: ['m-1'] })
      );

      const { sql, binds } = foundationOptionCall();
      expect(sql).toContain(`FROM ANALYTICS.PLATINUM_LFX_ONE.${CODE_TABLE}`);
      expect(sql).toContain('activity_date >= DATEADD(day, -90, CURRENT_DATE())');
      expect(sql).toContain('is_lf_project = TRUE');
      expect(sql).not.toContain('is_merged');
      expect(sql).not.toContain('foundation_id = ?');
      expect(sql).not.toContain('project_slug IN');
      expect(sql).not.toContain('member_id IN');
      expect(binds).toEqual([ACCOUNT]);
    }
  );

  it('leaves the foundation out of every read when none is picked', async () => {
    await service.getContributions(ACCOUNT, query());

    for (const { sql } of calls()) {
      expect(sql).not.toContain('foundation_id = ?');
    }
  });

  it('returns foundation options and each project option with its foundation', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY foundation_id')) {
        return { rows: [{ FOUNDATION_ID: 'f-cncf', FOUNDATION_NAME: 'CNCF' }] };
      }
      if (sql.includes('GROUP BY project_id')) {
        return { rows: [{ PROJECT_ID: 'p-k8s', PROJECT_SLUG: 'k8s', PROJECT_NAME: 'Kubernetes', FOUNDATION_ID: 'f-cncf', COMMITS: 4 }] };
      }
      return { rows: [] };
    });

    const response = await service.getContributions(ACCOUNT, query());

    expect(response.foundationOptions).toEqual([{ foundationId: 'f-cncf', foundationName: 'CNCF' }]);
    expect(response.projectOptions).toEqual([{ slug: 'k8s', projectId: 'p-k8s', name: 'Kubernetes', commits: 4, foundationId: 'f-cncf' }]);
  });
});

describe('OrgContributionsService — team members', () => {
  it.each(['commits', 'code'] as const)('leaves team members in every read under include (metric=%s)', async (metric) => {
    await service.getContributions(ACCOUNT, query({ metric, teamMembers: 'include' }));

    expect(calls().some(({ sql }) => sql.includes('is_cdp_team_member'))).toBe(false);
  });

  it.each(['commits', 'code'] as const)('drops team members from every read by default (metric=%s)', async (metric) => {
    await service.getContributions(ACCOUNT, query({ metric }));

    expect(execute).toHaveBeenCalledTimes(6);
    for (const { sql } of calls()) {
      expect(sql).toContain('NOT COALESCE(is_cdp_team_member, FALSE)');
    }
  });

  it('keys include and exclude apart in the cache', async () => {
    await service.getContributions(ACCOUNT, query({ teamMembers: 'include' }));
    await service.getContributions(ACCOUNT, query({ teamMembers: 'exclude' }));
    const [include, exclude] = withOrgCache.mock.calls.map((call) => call[1] as string);

    expect(include).not.toBe(exclude);
  });

  it.each(['commits', 'code'] as const)(
    'tells Snowflake a missing flag column is expected on every read under exclude, and nothing under include (metric=%s)',
    async (metric) => {
      await service.getContributions(ACCOUNT, query({ metric }));
      // The commits metric's repository read also expects lf-dbt's non-team first commit column (lfx-self-serve#4685).
      const repoSql = repoCall().sql;
      for (const [sql, , options] of execute.mock.calls as [string, unknown, { expectInvalidIdentifier?: string | string[] } | undefined][]) {
        expect(options?.expectInvalidIdentifier).toEqual(
          metric === 'commits' && sql === repoSql ? ['IS_CDP_TEAM_MEMBER', 'ORG_REPO_FIRST_NON_TEAM_COMMIT_TS'] : 'IS_CDP_TEAM_MEMBER'
        );
      }

      execute.mockClear();
      await service.getContributions(ACCOUNT, query({ metric, teamMembers: 'include' }));
      expect(execute.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    }
  );

  it("reads lf-dbt's lifetime first commit without team members under the commits metric, with no first-commit CTE", async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'commits', projectScope: 'lf', commitScope: 'merged' }));

    const { sql, binds } = repoCall();
    expect(sql).toContain('MIN(ORG_REPO_FIRST_NON_TEAM_COMMIT_TS) AS first_commit_ts');
    expect(sql).not.toContain('org_repo_first_commit_ts');
    expect(sql).not.toContain('repo_first');
    expect(binds[0]).toBe(ACCOUNT);
    expect(binds.filter((bind) => bind === ACCOUNT)).toHaveLength(1);
  });

  it("keeps the warehouse's lifetime first commit under include", async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'commits', teamMembers: 'include' }));

    expect(repoCall().sql).toContain('MIN(org_repo_first_commit_ts) AS first_commit_ts');
    expect(repoCall().sql).not.toContain('FIRST_NON_TEAM');
  });

  it('reads the inclusive first commit, says so and never stores the payload while the non-team column is not built yet', async () => {
    const missingFirstCommit = Object.assign(
      new Error("SQL compilation error: error line 11 at position 14\ninvalid identifier 'ORG_REPO_FIRST_NON_TEAM_COMMIT_TS'"),
      {
        code: '000904',
      }
    );
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_REPO_FIRST_NON_TEAM_COMMIT_TS')) throw missingFirstCommit;
      return { rows: [] };
    });

    const response = await service.getContributions(ACCOUNT, query({ metric: 'commits' }));

    expect(response.teamMembersUnavailable).toBe(true);
    const repoReads = execute.mock.calls.filter(([sql]) => String(sql).includes('first_commit_ts'));
    expect(repoReads.at(-1)?.[0]).toContain('MIN(org_repo_first_commit_ts) AS first_commit_ts');
    // Only the First Commit falls back: team members stay out of the counts.
    expect(repoReads.at(-1)?.[0]).toContain('NOT COALESCE(is_cdp_team_member, FALSE)');
    const storable = withOrgCache.mock.calls[0][5] as (value: unknown) => boolean;
    expect(storable({ teamMembersUnavailable: true })).toBe(false);
  });

  describe('while the warehouse has no team-member flag yet', () => {
    const missingColumn = Object.assign(new Error("SQL compilation error: error line 9 at position 18\ninvalid identifier 'IS_CDP_TEAM_MEMBER'"), {
      code: '000904',
    });

    beforeEach(() => {
      execute.mockImplementation(async (sql: string) => {
        if (sql.includes('is_cdp_team_member')) throw missingColumn;
        return { rows: [] };
      });
    });

    it('serves every read with team members, says so, and never stores the payload', async () => {
      const response = await service.getContributions(ACCOUNT, query());

      expect(response.teamMembersUnavailable).toBe(true);
      const unfiltered = execute.mock.calls.filter(([sql]) => !String(sql).includes('is_cdp_team_member'));
      expect(unfiltered).toHaveLength(6);
      const storable = withOrgCache.mock.calls[0][5] as (value: unknown) => boolean;
      expect(storable({ teamMembersUnavailable: true })).toBe(false);
      expect(storable({})).toBe(true);
    });

    it('still rejects any other warehouse error', async () => {
      execute.mockRejectedValue(new Error('Warehouse timeout'));

      await expect(service.getContributions(ACCOUNT, query())).rejects.toThrow('Warehouse timeout');
    });
  });
});

describe('OrgContributionsService — cache key', () => {
  it('is versioned and differs per projectScope, commitScope, metric and foundation', async () => {
    const variants: Partial<OrgContributionsQuery>[] = [
      {},
      { projectScope: 'lf' },
      { projectScope: 'non_lf' },
      { commitScope: 'merged' },
      { metric: 'commits' },
      { foundation: 'f-cncf' },
      { foundation: 'f-lfai' },
    ];
    for (const overrides of variants) {
      await service.getContributions(ACCOUNT, query(overrides));
    }
    const keys = withOrgCache.mock.calls.map((call) => call[1] as string);

    for (const key of keys) {
      expect(key).toMatch(/^contributions:v5:[0-9a-f]{64}$/);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps a value holding a comma apart from two values', async () => {
    await service.getContributions(ACCOUNT, query({ projects: ['a,b'] }));
    await service.getContributions(ACCOUNT, query({ projects: ['a', 'b'] }));
    const [joined, split] = withOrgCache.mock.calls.map((call) => call[1] as string);

    expect(joined).not.toBe(split);
  });

  it('stays the same length however long the search is', async () => {
    await service.getContributions(ACCOUNT, query({ search: 'x' }));
    await service.getContributions(ACCOUNT, query({ search: 'x'.repeat(5000) }));
    const [shortKey, longKey] = withOrgCache.mock.calls.map((call) => call[1] as string);

    expect(longKey).not.toBe(shortKey);
    expect(longKey.length).toBe(shortKey.length);
  });
});
