// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

// The real `@lfx-one/shared/utils` barrel transitively pulls Angular-only code that can't load in
// this server-only vitest environment. Spread the submodules this path actually uses — the real
// implementations, so the cache round trip below exercises the true encode/decode, not stubs.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/compact-cache.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-commit-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
// A minimal in-memory Valkey so a write really is serialized and a read really is parsed back —
// the only way a warm-vs-cold divergence can show up at all.
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
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));

import type {
  CompactOrgContributorRowsCache,
  ContributorPersonProjectRow,
  OrgCommitFilters,
  OrgContributorMaintainerRoleRow,
  OrgPersonEmploymentRow,
} from '@lfx-one/shared/interfaces';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgPeopleContributorsService } from './org-people-contributors.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
// Every project, the unscoped read; the scoped reads are named where a test needs them.
const FILTERS: OrgCommitFilters = { projectScope: 'all', commitScope: 'all', metric: 'commits' };

let service: OrgPeopleContributorsService;

/** One person across two projects plus a second person on one of them — enough for the project dictionary to matter. */
const CONTRIBUTOR_ROWS = [
  {
    PERSON_KEY: 'person-one',
    PROJECT_ID: 'project-one',
    LFID: 'lfid-one',
    LF_USERNAME: 'ada',
    CDP_MEMBER_ID: 'cdp-1',
    DISPLAY_NAME: 'Ada Lovelace',
    TITLE: 'Engineer',
    PROJECT_NAME: 'Kubernetes',
    PROJECT_SLUG: 'k8s',
    FOUNDATION_ID: 'foundation-one',
    FOUNDATION_NAME: 'CNCF',
    FOUNDATION_SLUG: 'cncf',
    COMMITS: 40,
    MERGED_COMMITS: 15,
    CODE_ACTIVITIES: 120,
    LAST_ACTIVE_DATE: '2026-04-12',
  },
  {
    PERSON_KEY: 'person-one',
    PROJECT_ID: 'project-two',
    LFID: 'lfid-one',
    LF_USERNAME: 'ada',
    CDP_MEMBER_ID: 'cdp-1',
    DISPLAY_NAME: 'Ada Lovelace',
    TITLE: 'Engineer',
    PROJECT_NAME: null,
    PROJECT_SLUG: null,
    FOUNDATION_ID: null,
    FOUNDATION_NAME: null,
    FOUNDATION_SLUG: null,
    COMMITS: null,
    MERGED_COMMITS: null,
    CODE_ACTIVITIES: null,
    LAST_ACTIVE_DATE: null,
  },
  {
    PERSON_KEY: 'person-two',
    PROJECT_ID: 'project-one',
    LFID: null,
    LF_USERNAME: null,
    CDP_MEMBER_ID: 'cdp-2',
    DISPLAY_NAME: null,
    TITLE: null,
    PROJECT_NAME: 'Kubernetes',
    PROJECT_SLUG: 'k8s',
    FOUNDATION_ID: 'foundation-one',
    FOUNDATION_NAME: 'CNCF',
    FOUNDATION_SLUG: 'cncf',
    COMMITS: 3,
    MERGED_COMMITS: 1,
    CODE_ACTIVITIES: 9,
    LAST_ACTIVE_DATE: '2026-01-05',
  },
];

/**
 * person-one maintains project-one (one segment) and a project they have no code in; a maintainer with no code at
 * all holds two roles on one project id (two segments) — roles count per (member, segment), with or without code.
 */
const ROLE_ROWS: OrgContributorMaintainerRoleRow[] = [
  { PERSON_KEY: 'person-one', MEMBER_ID: 'cdp-1', SEGMENT_ID: 'segment-k8s', PROJECT_ID: 'project-one' },
  { PERSON_KEY: 'person-one', MEMBER_ID: 'cdp-1', SEGMENT_ID: 'segment-docs', PROJECT_ID: 'project-docs' },
  { PERSON_KEY: 'person-no-code', MEMBER_ID: 'cdp-9', SEGMENT_ID: 'segment-a', PROJECT_ID: 'project-three' },
  { PERSON_KEY: 'person-no-code', MEMBER_ID: 'cdp-9', SEGMENT_ID: 'segment-b', PROJECT_ID: 'project-three' },
];

/** Answers the roles read with `roles`, the team members read (excluded by default) with nobody and every other read with `rows`. */
function mockWarehouse(rows: object[] = CONTRIBUTOR_ROWS, roles: OrgContributorMaintainerRoleRow[] = ROLE_ROWS): void {
  execute.mockImplementation(async (sql?: string) => {
    if (sql?.includes('IS_CDP_TEAM_MEMBER')) return { rows: [] };
    return { rows: sql?.includes('ORG_MAINTAINER_ROLES') ? roles : rows };
  });
}

const ROWS_KEY = (suffix: string): string => buildOrgCacheKey(ACCOUNT, `people-contributors:v5:${suffix}`)!;

const isTeamMembersRead = (call: unknown[]): boolean => String(call[0]).includes('IS_CDP_TEAM_MEMBER');

/** Reads of `table`, the team members read (which unions the People tables) aside. */
function readsOf(table: string): unknown[][] {
  return execute.mock.calls.filter((call) => String(call[0]).includes(table) && !isTeamMembersRead(call));
}

beforeEach(() => {
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  execute.mockReset();
  cacheValues.clear();
  ValkeyService.resetInstance();
  mockWarehouse();
  service = new OrgPeopleContributorsService();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

describe('OrgPeopleContributorsService compact cache (GH-1906)', () => {
  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    const fromMiss = await service.getContributors(ACCOUNT, 'all', FILTERS);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getContributors(ACCOUNT, 'all', FILTERS);

    // `toStrictEqual` distinguishes null from undefined from an absent key; the serialized
    // comparison additionally pins key order, which `buildResponse`'s object literals fix and a
    // decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it('rebuilds the project-level columns on the cache-hit path, including the documented id fallbacks', async () => {
    // Deliberately the SECOND call: the first populates the cache and returns the rows the
    // warehouse handed back, so only a read-back exercises the decoder at all. A decode that
    // dropped a dictionary column would silently relabel every project row with its id, and
    // quietly empty the foundation filter.
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    const warehouseReads = execute.mock.calls.length;

    const { projects, projectOptions, foundationOptions } = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);

    expect(projects[0]).toEqual({
      personKey: 'person-one',
      projectId: 'project-one',
      projectName: 'Kubernetes',
      projectSlug: 'k8s',
      foundationId: 'foundation-one',
      foundationName: 'CNCF',
      foundationSlug: 'cncf',
      role: 'Maintainer',
      commits: 40,
      codeActivities: 120,
      lastActiveTs: '2026-04-12',
    });
    expect(projects[1]?.projectName).toBe('project-two');
    expect(projectOptions.map((option) => option.projectId)).toEqual(['project-one', 'project-two']);
    expect(foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'CNCF' }]);
    // Two of the three aggregate rows share a project, so the stored dictionary has to be shorter
    // than the row table — a `keyOf` regression that stopped collapsing them would not be.
    const stored = JSON.parse(cacheValues.get(ROWS_KEY('all:all'))!) as CompactOrgContributorRowsCache;
    expect(stored.projects.r.length).toBe(2);
    expect(stored.rows.r.length).toBe(3);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a tab with
    // holes in it for the rest of the TTL.
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    const key = ROWS_KEY('all:all');
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgContributorRowsCache;
    stored.rows.r = stored.rows.r.map((row) => row.slice(0, -1));
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('keys each time range and project scope separately, one entry serving every commit scope and metric', async () => {
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    await service.getContributors(ACCOUNT, '30d', FILTERS);
    await service.getContributors(ACCOUNT, '30d', { ...FILTERS, projectScope: 'lf' });
    // Commit scope and metric only pick counts after the read, so they reuse the entry.
    await service.getContributors(ACCOUNT, '30d', { ...FILTERS, commitScope: 'merged' });
    await service.getContributors(ACCOUNT, '30d', { ...FILTERS, metric: 'code' });

    const keys = [...cacheValues.keys()].filter((key) => key.includes('people-contributors')).sort();
    const expected = ['all:all', '30d:all', '30d:lf'].flatMap((suffix) => [
      ROWS_KEY(suffix),
      buildOrgCacheKey(ACCOUNT, `people-contributors-roles:v1:${suffix}`)!,
    ]);
    expect(keys).toEqual(expected.sort());
    expect(readsOf('ORG_PEOPLE_CONTRIBUTORS_DAILY')).toHaveLength(3);
    expect(readsOf('ORG_MAINTAINER_ROLES')).toHaveLength(3);
  });

  it.each([
    [
      'an index past the end of the dictionary',
      (stored: CompactOrgContributorRowsCache) => (stored.rowProjects = stored.rowProjects.map(() => stored.projects.r.length)),
    ],
    ['a negative index', (stored: CompactOrgContributorRowsCache) => (stored.rowProjects = stored.rowProjects.map(() => -1))],
    ['a non-integer index', (stored: CompactOrgContributorRowsCache) => (stored.rowProjects = stored.rowProjects.map(() => 1.5))],
    ['an index array shorter than the rows', (stored: CompactOrgContributorRowsCache) => (stored.rowProjects = stored.rowProjects.slice(0, -1))],
  ])('treats a stored entry with %s as a miss', async (_label, corrupt) => {
    // The decode resolves each reference without a fallback, so an unresolvable one would emit a
    // row with no dictionary fields at all. The guard has to reject the entry instead.
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    const key = ROWS_KEY('all:all');
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgContributorRowsCache;
    corrupt(stored);
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('round-trips an empty result unchanged', async () => {
    // The empty envelope has to survive its own guard: rejecting it would make an org with no rows
    // refetch on every request forever.
    mockWarehouse([], []);
    const fromMiss = await service.getContributors(ACCOUNT, 'all', FILTERS);

    const fromHit = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect([...cacheValues.keys()].filter((key) => key.includes('people-contributors'))).toHaveLength(2);
  });

  it.each([
    ['absent', '\u0000'],
    ['a number', 42],
    ['an object', {}],
  ])('treats a stored entry whose required CDP_MEMBER_ID cell is %s as a miss', async (_label, corrupt) => {
    // Exact columns prove the shape, not the value. A required cell that never arrived, or arrived
    // as the wrong type, decodes into a row the mapper then reads — so it has to be a miss.
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    const key = ROWS_KEY('all:all');
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgContributorRowsCache;
    const index = stored.rows.k.indexOf('CDP_MEMBER_ID');
    stored.rows.r = stored.rows.r.map((row) => row.map((cell, position) => (position === index ? corrupt : cell)));
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('caches a row whose CDP_MEMBER_ID aggregate came back null instead of missing forever', async () => {
    // `MIN(cdp_member_id)` over an all-NULL group returns NULL, and the uncached path passes it
    // straight through. A guard stricter than that would turn this org into a permanent miss.
    mockWarehouse(CONTRIBUTOR_ROWS.map((row, index) => (index === 0 ? { ...row, CDP_MEMBER_ID: null } : row)));
    const fromMiss = await service.getContributors(ACCOUNT, 'all', FILTERS);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('caches an aggregate row whose PERSON_KEY and PROJECT_ID are null instead of missing forever', async () => {
    // Same rule as the event-attendee null EVENT_ID: `buildResponse` passes a null person key and a
    // null project id through, so a guard demanding a string in either would make one such row a
    // permanent miss. Both loosened cells are nulled together so each guard branch is exercised.
    mockWarehouse([
      {
        PERSON_KEY: null,
        PROJECT_ID: null,
        LFID: null,
        LF_USERNAME: null,
        CDP_MEMBER_ID: null,
        DISPLAY_NAME: null,
        TITLE: null,
        PROJECT_NAME: null,
        PROJECT_SLUG: null,
        FOUNDATION_ID: null,
        FOUNDATION_NAME: null,
        FOUNDATION_SLUG: null,
        COMMITS: null,
        MERGED_COMMITS: null,
        CODE_ACTIVITIES: null,
        LAST_ACTIVE_DATE: null,
      },
    ]);
    const fromMiss = await service.getContributors(ACCOUNT, 'all', FILTERS);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('treats a pre-compaction cached entry as a miss rather than decoding it', async () => {
    // `v1` stored the bare row array. Reading `projects`/`rows` off an array yields undefined, so
    // the guard — not just the key bump — has to reject it.
    const legacy = [{ PERSON_KEY: 'stale', PROJECT_ID: 'stale-project' }];
    cacheValues.set(ROWS_KEY('all:all'), JSON.stringify(legacy));

    const response = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});

describe('OrgPeopleContributorsService commit filters (lfx-self-serve#4164)', () => {
  function lastQuery(): string {
    return readsOf('ORG_PEOPLE_CONTRIBUTORS_DAILY').at(-1)![0] as string;
  }

  function projectRow(projectId: string, commits: number, codeActivities: number): ContributorPersonProjectRow {
    return {
      PERSON_KEY: 'person-one',
      PROJECT_ID: projectId,
      LFID: 'lfid-one',
      LF_USERNAME: 'ada',
      CDP_MEMBER_ID: 'cdp-1',
      DISPLAY_NAME: 'Ada Lovelace',
      TITLE: null,
      PROJECT_NAME: projectId,
      PROJECT_SLUG: null,
      FOUNDATION_ID: null,
      FOUNDATION_NAME: null,
      FOUNDATION_SLUG: null,
      COMMITS: commits,
      MERGED_COMMITS: Math.floor(commits / 2),
      CODE_ACTIVITIES: codeActivities,
      LAST_ACTIVE_DATE: '2026-04-12',
    };
  }

  it.each([
    ['all', null],
    ['lf', 'AND is_lf_project = TRUE'],
    ['non_lf', 'AND is_lf_project = FALSE'],
  ] as const)('reads project scope %s with the matching LF predicate', async (projectScope, predicate) => {
    await service.getContributors(ACCOUNT, '365d', { ...FILTERS, projectScope });

    if (predicate) expect(lastQuery()).toContain(predicate);
    else expect(lastQuery()).not.toMatch(/is_lf_project/);
    expect(readsOf('ORG_PEOPLE_CONTRIBUTORS_DAILY').at(-1)![1]).toEqual([ACCOUNT]);
  });

  it.each([
    ['30d', 'AND activity_date >= DATEADD(day, -30, CURRENT_DATE())'],
    ['90d', 'AND activity_date >= DATEADD(day, -90, CURRENT_DATE())'],
    ['365d', 'AND activity_date >= DATEADD(day, -365, CURRENT_DATE())'],
    ['730d', 'AND activity_date >= DATEADD(day, -730, CURRENT_DATE())'],
  ] as const)('windows %s by days before today', async (timeRange, predicate) => {
    await service.getContributors(ACCOUNT, timeRange, FILTERS);

    expect(lastQuery()).toContain(predicate);
    expect(lastQuery()).not.toMatch(/month/i);
  });

  it('reads all time without a date predicate', async () => {
    await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(lastQuery()).not.toContain('activity_date >=');
  });

  it("reads authored and merged commits in one query and shows the commit scope's count", async () => {
    await service.getContributors(ACCOUNT, '365d', FILTERS);
    expect(lastQuery()).toContain('SUM(daily_commits) AS commits');
    expect(lastQuery()).toContain('SUM(daily_merged_commits) AS merged_commits');

    const authored = await service.getContributors(ACCOUNT, '365d', FILTERS);
    const merged = await service.getContributors(ACCOUNT, '365d', { ...FILTERS, commitScope: 'merged' });

    expect(readsOf('ORG_PEOPLE_CONTRIBUTORS_DAILY')).toHaveLength(1);
    expect(authored.contributors.find((row) => row.personKey === 'person-one')?.commits).toBe(40);
    expect(merged.contributors.find((row) => row.personKey === 'person-one')?.commits).toBe(15);
    expect(merged.projects.find((row) => row.projectId === 'project-one' && row.personKey === 'person-one')?.commits).toBe(15);
  });

  it.each(['lf', 'non_lf'] as const)('sums the per-scope commit credit for project scope %s', async (projectScope) => {
    await service.getContributors(ACCOUNT, '365d', { ...FILTERS, projectScope });

    expect(lastQuery()).toContain('SUM(daily_scope_commits) AS commits');
    expect(lastQuery()).toContain('SUM(daily_scope_merged_commits) AS merged_commits');
    expect(lastQuery()).not.toMatch(/SUM\(daily_commits\)|SUM\(daily_merged_commits\)/);
  });

  it('sends code activities on every row and picks the most active project by the metric', async () => {
    mockWarehouse([projectRow('commit-heavy', 50, 60), projectRow('review-heavy', 5, 400)]);

    const byCommits = await service.getContributors(ACCOUNT, '365d', FILTERS);
    const byCode = await service.getContributors(ACCOUNT, '365d', { ...FILTERS, metric: 'code' });

    expect(byCommits.contributors[0]).toMatchObject({ commits: 55, codeActivities: 460, mostActiveProjectName: 'commit-heavy' });
    expect(byCode.contributors[0]).toMatchObject({ commits: 55, codeActivities: 460, mostActiveProjectName: 'review-heavy' });
    expect(byCode.projects.map((project) => project.codeActivities)).toEqual([60, 400]);
  });
});

describe('OrgPeopleContributorsService maintainer roles (lfx-self-serve#4482)', () => {
  function lastRolesRead(): { sql: string; binds: unknown[] } {
    const [sql, binds] = readsOf('ORG_MAINTAINER_ROLES').at(-1)!;
    return { sql: String(sql), binds: binds as unknown[] };
  }

  it('reads the roles overlapping the range, binding the range length after the account', async () => {
    await service.getContributors(ACCOUNT, '730d', FILTERS);

    const { sql, binds } = lastRolesRead();
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES');
    expect(sql).toContain('ROLE_START_DATE <= CURRENT_DATE() AND (ROLE_END_DATE IS NULL OR ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE()))');
    expect(binds).toEqual([ACCOUNT, 730]);
  });

  it('reads every started role for all time, binding only the account', async () => {
    await service.getContributors(ACCOUNT, 'all', FILTERS);

    const { sql, binds } = lastRolesRead();
    expect(sql).toContain('ROLE_START_DATE <= CURRENT_DATE()');
    expect(sql).not.toContain('ROLE_END_DATE');
    expect(binds).toEqual([ACCOUNT]);
  });

  it.each([
    ['all', null],
    ['lf', 'AND IS_LF_PROJECT = TRUE'],
    ['non_lf', 'AND IS_LF_PROJECT = FALSE'],
  ] as const)('reads the roles of project scope %s', async (projectScope, predicate) => {
    await service.getContributors(ACCOUNT, '365d', { ...FILTERS, projectScope });

    const { sql } = lastRolesRead();
    if (predicate) expect(sql).toContain(predicate);
    else expect(sql).not.toContain('IS_LF_PROJECT');
  });

  it('counts distinct (member, segment) roles with or without code, and everyone with code as a contributor', async () => {
    const { stats } = await service.getContributors(ACCOUNT, '365d', FILTERS);

    expect(stats).toEqual({ maintainerRoles: 4, contributors: 2, projects: 2, foundations: 1 });
  });

  it('badges a person holding any role and labels each project row by the role on that project', async () => {
    const { contributors, projects } = await service.getContributors(ACCOUNT, '365d', FILTERS);

    expect(contributors.map((row) => [row.personKey, row.role])).toEqual([
      ['person-one', 'Maintainer'],
      ['person-two', 'Contributor'],
    ]);
    expect(projects.map((row) => [row.personKey, row.projectId, row.role])).toEqual([
      ['person-one', 'project-one', 'Maintainer'],
      ['person-one', 'project-two', 'Contributor'],
      ['person-two', 'project-one', 'Contributor'],
    ]);
  });

  it('lists contributors without badges, marks the roles stat unavailable (null), and stores none, when the roles table is missing', async () => {
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      return { rows: sql?.includes('IS_CDP_TEAM_MEMBER') ? [] : CONTRIBUTOR_ROWS };
    });

    const { stats, contributors } = await service.getContributors(ACCOUNT, '365d', FILTERS);

    expect(stats).toMatchObject({ maintainerRoles: null, contributors: 2 });
    expect(contributors.every((row) => row.role === 'Contributor')).toBe(true);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-contributors-roles:v1:365d:all')!)).toBe(false);
  });

  it('still fails on any other error from the roles read', async () => {
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('ORG_MAINTAINER_ROLES')) throw new Error('Warehouse timeout');
      return { rows: CONTRIBUTOR_ROWS };
    });

    await expect(service.getContributors(ACCOUNT, '365d', FILTERS)).rejects.toThrow('Warehouse timeout');
  });

  it('treats a stored roles entry with a missing key as a miss', async () => {
    await service.getContributors(ACCOUNT, '365d', FILTERS);
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-contributors-roles:v1:365d:all')!, JSON.stringify([{ PERSON_KEY: 'person-one' }]));

    await service.getContributors(ACCOUNT, '365d', FILTERS);

    expect(readsOf('ORG_MAINTAINER_ROLES')).toHaveLength(2);
  });
});

describe('OrgPeopleContributorsService employment filter (lfx-self-serve#4627)', () => {
  const EMPLOYMENT_KEY = buildOrgCacheKey(ACCOUNT, 'people-employment:v2:365d:all')!;

  /** A code contributor the roster has no row for in the window and scope — neither current nor former. */
  const UNCLASSIFIED_ROW = {
    ...CONTRIBUTOR_ROWS[2],
    PERSON_KEY: 'person-three',
    CDP_MEMBER_ID: 'cdp-3',
    PROJECT_ID: 'project-three',
    PROJECT_NAME: 'Rails',
    FOUNDATION_ID: null,
    FOUNDATION_NAME: null,
    FOUNDATION_SLUG: null,
  };

  /** person-one is a current employee, person-two a former one; person-three has no roster row. */
  const EMPLOYMENT_ROWS: OrgPersonEmploymentRow[] = [
    { PERSON_KEY: 'person-one', EMPLOYMENT: 'current' },
    { PERSON_KEY: 'person-two', EMPLOYMENT: 'former' },
  ];

  // The roster read answers EMPLOYMENT_ROWS, the roles read ROLE_ROWS and the rows read every contributor.
  beforeEach(() => {
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('IS_CDP_TEAM_MEMBER')) return { rows: [] };
      if (sql?.includes('ORG_PEOPLE_ALL_RANGES')) return { rows: EMPLOYMENT_ROWS };
      return { rows: sql?.includes('ORG_MAINTAINER_ROLES') ? ROLE_ROWS : [...CONTRIBUTOR_ROWS, UNCLASSIFIED_ROW] };
    });
  });

  it("classifies people by their roster row for the request's range and project scope, binding account, range and scope", async () => {
    await service.getContributors(ACCOUNT, '90d', { ...FILTERS, projectScope: 'lf' }, 'current');

    const reads = readsOf('ORG_PEOPLE_ALL_RANGES');
    expect(reads).toHaveLength(1);
    const [sql, binds] = reads[0];
    expect(sql).toContain("SELECT DISTINCT PERSON_KEY, IFF(IS_FORMER, 'former', 'current') AS EMPLOYMENT");
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES');
    expect(sql).toContain('WHERE ACCOUNT_ID = ? AND TIME_RANGE = ? AND PROJECT_SCOPE = ?');
    expect(binds).toEqual([ACCOUNT, '90d', 'lf']);
  });

  it('lists only current employees for current: the list, the Contributors tile and the project and foundation stats follow', async () => {
    const response = await service.getContributors(ACCOUNT, '365d', FILTERS, 'current');

    expect(response.contributors.map((row) => [row.personKey, row.role])).toEqual([['person-one', 'Maintainer']]);
    expect(response.projects.map((row) => [row.personKey, row.projectId])).toEqual([
      ['person-one', 'project-one'],
      ['person-one', 'project-two'],
    ]);
    expect(response.stats).toEqual({ maintainerRoles: 4, contributors: 1, projects: 2, foundations: 1 });
  });

  it('lists only former employees for former, with the project and foundation options they contributed to', async () => {
    const response = await service.getContributors(ACCOUNT, '365d', FILTERS, 'former');

    expect(response.contributors.map((row) => [row.personKey, row.role])).toEqual([['person-two', 'Contributor']]);
    expect(response.projects.map((row) => [row.personKey, row.projectId])).toEqual([['person-two', 'project-one']]);
    expect(response.projectOptions.map((option) => option.projectId)).toEqual(['project-one']);
    expect(response.foundationOptions).toEqual([{ foundationId: 'foundation-one', foundationName: 'CNCF' }]);
    expect(response.stats).toEqual({ maintainerRoles: 4, contributors: 1, projects: 1, foundations: 1 });
  });

  it('lists a contributor with no roster row only under all, neither current nor former', async () => {
    const current = await service.getContributors(ACCOUNT, '365d', FILTERS, 'current');
    const former = await service.getContributors(ACCOUNT, '365d', FILTERS, 'former');
    const all = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all');

    expect(current.contributors.map((row) => row.personKey)).not.toContain('person-three');
    expect(former.contributors.map((row) => row.personKey)).not.toContain('person-three');
    expect(all.contributors.map((row) => row.personKey)).toEqual(['person-one', 'person-two', 'person-three']);
    expect(all.stats).toMatchObject({ contributors: 3, projects: 3 });
  });

  it('keeps the Maintainer roles tile the same whatever the employment pick', async () => {
    const all = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all');
    const current = await service.getContributors(ACCOUNT, '365d', FILTERS, 'current');
    const former = await service.getContributors(ACCOUNT, '365d', FILTERS, 'former');

    expect([all, current, former].map((response) => response.stats.maintainerRoles)).toEqual([4, 4, 4]);
  });

  it('reads no classification for all and answers exactly as without the filter', async () => {
    const withoutFilter = await service.getContributors(ACCOUNT, '365d', FILTERS);
    const all = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all');

    expect(all).toEqual(withoutFilter);
    expect(readsOf('ORG_PEOPLE_ALL_RANGES')).toHaveLength(0);
    expect(cacheValues.has(EMPLOYMENT_KEY)).toBe(false);
  });

  it('caches the classification under its own key, as the person keys of each class, and shares it, the rows and the roles between current and former', async () => {
    await service.getContributors(ACCOUNT, '365d', FILTERS, 'current');
    const former = await service.getContributors(ACCOUNT, '365d', FILTERS, 'former');

    expect(JSON.parse(cacheValues.get(EMPLOYMENT_KEY)!)).toEqual({ current: ['person-one'], former: ['person-two'] });
    expect(readsOf('ORG_PEOPLE_ALL_RANGES')).toHaveLength(1);
    expect(readsOf('ORG_PEOPLE_CONTRIBUTORS_DAILY')).toHaveLength(1);
    expect(readsOf('ORG_MAINTAINER_ROLES')).toHaveLength(1);
    expect(former.contributors.map((row) => row.personKey)).toEqual(['person-two']);
  });

  it.each([
    ['the v1 named-field rows', [{ PERSON_KEY: 'person-two', EMPLOYMENT: 'former' }]],
    ['a class missing', { current: ['person-one'] }],
    ['a class that is not a list', { current: 'person-one', former: [] }],
    ['a key that is not a string', { current: ['person-one'], former: [42] }],
  ])('treats a stored classification with %s as a miss and reads it again', async (_case, stored) => {
    cacheValues.set(EMPLOYMENT_KEY, JSON.stringify(stored));

    const response = await service.getContributors(ACCOUNT, '365d', FILTERS, 'current');

    expect(readsOf('ORG_PEOPLE_ALL_RANGES')).toHaveLength(1);
    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one']);
    expect(JSON.parse(cacheValues.get(EMPLOYMENT_KEY)!)).toEqual({ current: ['person-one'], former: ['person-two'] });
  });

  it('keeps the Maintainer roles tile unavailable when the roles table is missing', async () => {
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      if (sql?.includes('IS_CDP_TEAM_MEMBER')) return { rows: [] };
      return { rows: sql?.includes('ORG_PEOPLE_ALL_RANGES') ? EMPLOYMENT_ROWS : CONTRIBUTOR_ROWS };
    });

    const { stats } = await service.getContributors(ACCOUNT, '365d', FILTERS, 'current');

    expect(stats).toMatchObject({ maintainerRoles: null, contributors: 1 });
  });
});

describe('OrgPeopleContributorsService team members filter (lfx-self-serve#4685)', () => {
  const TEAM_MEMBERS_KEY = buildOrgCacheKey(ACCOUNT, 'people-team-members:v1')!;

  // person-two is a CDP team member; the roles read answers ROLE_ROWS and the rows read every contributor.
  beforeEach(() => {
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('IS_CDP_TEAM_MEMBER')) return { rows: [{ PERSON_KEY: 'person-two' }] };
      return { rows: sql?.includes('ORG_MAINTAINER_ROLES') ? ROLE_ROWS : CONTRIBUTOR_ROWS };
    });
  });

  it('drops team members from the list, the Contributors tile and the project and foundation stats under exclude', async () => {
    const response = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all', 'exclude');

    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one']);
    expect(response.projects.map((row) => row.personKey)).toEqual(['person-one', 'person-one']);
    expect(response.stats).toMatchObject({ contributors: 1, projects: 2, foundations: 1 });
  });

  it("leaves team members' maintainer roles out of the tile under exclude, as LFX Insights does", async () => {
    execute.mockImplementation(async (sql?: string) => {
      // person-no-code holds two roles and is a team member.
      if (sql?.includes('IS_CDP_TEAM_MEMBER')) return { rows: [{ PERSON_KEY: 'person-no-code' }] };
      return { rows: sql?.includes('ORG_MAINTAINER_ROLES') ? ROLE_ROWS : CONTRIBUTOR_ROWS };
    });

    const include = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all', 'include');
    const exclude = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all', 'exclude');

    expect([include.stats.maintainerRoles, exclude.stats.maintainerRoles]).toEqual([4, 2]);
  });

  it('serves everyone, says so and stores no team-member list while the warehouse has no flag yet', async () => {
    const missingColumn = Object.assign(new Error("SQL compilation error: error line 2 at position 90\ninvalid identifier 'IS_CDP_TEAM_MEMBER'"), {
      code: '000904',
    });
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('IS_CDP_TEAM_MEMBER')) throw missingColumn;
      return { rows: sql?.includes('ORG_MAINTAINER_ROLES') ? ROLE_ROWS : CONTRIBUTOR_ROWS };
    });

    const response = await service.getContributors(ACCOUNT, '365d', FILTERS);

    expect(response.teamMembersUnavailable).toBe(true);
    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
    expect(response.stats.maintainerRoles).toBe(4);
    expect(cacheValues.has(TEAM_MEMBERS_KEY)).toBe(false);
    // The missing column is expected during the rollout, so it never counts toward the circuit breaker.
    expect(execute.mock.calls.find(isTeamMembersRead)?.[2]).toEqual({ expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
  });

  it('still fails the tab on any other warehouse error in the team-member read', async () => {
    execute.mockImplementation(async (sql?: string) => {
      if (sql?.includes('IS_CDP_TEAM_MEMBER')) throw new Error('Warehouse timeout');
      return { rows: sql?.includes('ORG_MAINTAINER_ROLES') ? ROLE_ROWS : CONTRIBUTOR_ROWS };
    });

    await expect(service.getContributors(ACCOUNT, '365d', FILTERS)).rejects.toThrow('Warehouse timeout');
  });

  it('excludes team members by default', async () => {
    const response = await service.getContributors(ACCOUNT, '365d', FILTERS);

    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one']);
  });

  it('reads no team members for include and lists everyone', async () => {
    const include = await service.getContributors(ACCOUNT, '365d', FILTERS, 'all', 'include');

    expect(include.contributors.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
    expect(include.stats).toMatchObject({ contributors: 2 });
    expect(execute.mock.calls.filter(isTeamMembersRead)).toHaveLength(0);
    expect(cacheValues.has(TEAM_MEMBERS_KEY)).toBe(false);
  });

  it('caches the team members once per account and shares the rows entry with include', async () => {
    await service.getContributors(ACCOUNT, '365d', FILTERS, 'all', 'include');
    await service.getContributors(ACCOUNT, '365d', FILTERS, 'all', 'exclude');
    await service.getContributors(ACCOUNT, '30d', { ...FILTERS, projectScope: 'lf' }, 'all', 'exclude');

    expect(JSON.parse(cacheValues.get(TEAM_MEMBERS_KEY)!)).toEqual(['person-two']);
    expect(execute.mock.calls.filter(isTeamMembersRead)).toHaveLength(1);
    expect(readsOf('ORG_PEOPLE_CONTRIBUTORS_DAILY')).toHaveLength(2);
  });
});
