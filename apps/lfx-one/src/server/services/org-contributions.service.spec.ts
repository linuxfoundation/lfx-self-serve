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
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache }));

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
const projectOptionCall = () => callSelecting('AS parent_slug');
const employeeOptionCall = () => callSelecting('ANY_VALUE(member_display_name)');

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

    expect(execute).toHaveBeenCalledTimes(5);
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
    await service.getContributions(ACCOUNT, query({ commitScope: 'merged' }));
    expect(execute).toHaveBeenCalledTimes(5);
    for (const { sql } of calls()) {
      expect(sql).toContain('is_merged = TRUE');
    }
  });

  it('reads every surface from the commits table with metric=commits', async () => {
    await service.getContributions(ACCOUNT, query());

    for (const { sql } of calls()) {
      expect(sql).toContain(COMMITS_TABLE);
      expect(sql).not.toContain(CODE_TABLE);
    }
  });
});

describe('OrgContributionsService — range window', () => {
  it('windows the default Past 365 days as 365 calendar days, on every commit read', async () => {
    await service.getContributions(ACCOUNT, query());

    expect(execute).toHaveBeenCalledTimes(5);
    for (const { sql } of calls()) {
      expect(sql).toContain('activity_ts::date >= DATEADD(day, -365, CURRENT_DATE())');
      expect(sql).not.toContain('CURRENT_TIMESTAMP');
      expect(sql).not.toContain('month');
    }
  });

  it('windows Past 365 days code activity on activity_date', async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code' }));

    expect(kpiCall().sql).toContain('activity_date >= DATEADD(day, -365, CURRENT_DATE())');
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

    for (const call of [kpiCall(), repoCall(), projectOptionCall(), employeeOptionCall()]) {
      expect(call.sql).toContain(CODE_TABLE);
      expect(call.sql).toContain('code_activities');
      expect(call.sql).toContain('is_lf_project = TRUE');
      // Commit scope has no meaning for code activity.
      expect(call.sql).not.toContain('is_merged');
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
  it.each(['commits', 'code'] as const)('binds one value per placeholder with projects, employees and search (metric=%s)', async (metric) => {
    for (const view of ['repositories', 'commits'] as const) {
      execute.mockClear();
      await service.getContributions(ACCOUNT, query({ metric, view, projects: ['cncf', 'k8s'], employees: ['m-1', 'm-2', 'm-3'], search: 'api' }));

      expect(execute).toHaveBeenCalledTimes(5);
      for (const { sql, binds } of calls()) {
        expect(binds).toHaveLength((sql.match(/\?/g) ?? []).length);
      }
    }
  });

  it("filters code activity on the daily table's own project and member columns, with no commits-table subquery", async () => {
    await service.getContributions(ACCOUNT, query({ metric: 'code', projects: ['cncf'], employees: ['m-1'], search: 'api' }));

    expect(kpiCall().sql).toContain('parent_slug IN (?)');
    expect(kpiCall().sql).toContain('member_id IN (?)');
    for (const call of [kpiCall(), repoCall(), projectOptionCall(), employeeOptionCall()]) {
      expect(call.sql).not.toContain(COMMITS_TABLE);
    }
    expect(kpiCall().binds).toEqual([ACCOUNT, 'cncf', 'cncf', 'cncf', 'm-1', '%api%']);
    // The lifetime first-activity CTE takes its own account bind.
    expect(repoCall().binds).toEqual([ACCOUNT, ACCOUNT, 'cncf', 'cncf', 'cncf', 'm-1', '%api%']);
  });
});

describe('OrgContributionsService — cache key', () => {
  it('is versioned and differs per projectScope, commitScope and metric', async () => {
    const variants: Partial<OrgContributionsQuery>[] = [{}, { projectScope: 'lf' }, { projectScope: 'non_lf' }, { commitScope: 'merged' }, { metric: 'code' }];
    for (const overrides of variants) {
      await service.getContributions(ACCOUNT, query(overrides));
    }
    const keys = withOrgCache.mock.calls.map((call) => call[1] as string);

    for (const key of keys) {
      expect(key).toMatch(/^contributions:v3:[0-9a-f]{64}$/);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays the same length however long the search is', async () => {
    await service.getContributions(ACCOUNT, query({ search: 'x' }));
    await service.getContributions(ACCOUNT, query({ search: 'x'.repeat(5000) }));
    const [shortKey, longKey] = withOrgCache.mock.calls.map((call) => call[1] as string);

    expect(longKey).not.toBe(shortKey);
    expect(longKey.length).toBe(shortKey.length);
  });
});
