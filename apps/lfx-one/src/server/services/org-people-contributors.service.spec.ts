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

import type { CompactOrgContributorRowsCache, ContributorPersonProjectRow, OrgCommitFilters } from '@lfx-one/shared/interfaces';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgPeopleContributorsService } from './org-people-contributors.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
// Every project, the unscoped read; the scoped reads are named where a test needs them.
const FILTERS: OrgCommitFilters = { projectScope: 'all', commitScope: 'all', metric: 'commits' };

let service: OrgPeopleContributorsService;

/** One person across two projects plus a second person on one of them — enough for the project dictionary to matter. */
function mockWarehouse(): void {
  execute.mockResolvedValue({
    rows: [
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
        IS_DECLARED_MAINTAINER_FOR_PROJECT: true,
        IS_DECLARED_MAINTAINER_FOR_ORG: true,
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
        IS_DECLARED_MAINTAINER_FOR_PROJECT: null,
        IS_DECLARED_MAINTAINER_FOR_ORG: null,
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
        IS_DECLARED_MAINTAINER_FOR_PROJECT: false,
        IS_DECLARED_MAINTAINER_FOR_ORG: false,
      },
    ],
  });
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
    const stored = JSON.parse([...cacheValues.values()][0]) as CompactOrgContributorRowsCache;
    expect(stored.projects.r.length).toBe(2);
    expect(stored.rows.r.length).toBe(3);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a tab with
    // holes in it for the rest of the TTL.
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    const [key] = [...cacheValues.keys()];
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

    expect([...cacheValues.keys()]).toEqual(['all:all', '30d:all', '30d:lf'].map((suffix) => buildOrgCacheKey(ACCOUNT, `people-contributors:v4:${suffix}`)));
    expect(execute).toHaveBeenCalledTimes(3);
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
    const [key] = [...cacheValues.keys()];
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
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getContributors(ACCOUNT, 'all', FILTERS);

    const fromHit = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  it.each([
    ['absent', '\u0000'],
    ['a number', 42],
    ['an object', {}],
  ])('treats a stored entry whose required CDP_MEMBER_ID cell is %s as a miss', async (_label, corrupt) => {
    // Exact columns prove the shape, not the value. A required cell that never arrived, or arrived
    // as the wrong type, decodes into a row the mapper then reads — so it has to be a miss.
    await service.getContributors(ACCOUNT, 'all', FILTERS);
    const [key] = [...cacheValues.keys()];
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
    const { rows } = (await execute()) as { rows: Record<string, unknown>[] };
    execute.mockReset();
    execute.mockResolvedValue({ rows: rows.map((row, index) => (index === 0 ? { ...row, CDP_MEMBER_ID: null } : row)) });
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
    execute.mockReset();
    execute.mockResolvedValue({
      rows: [
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
          IS_DECLARED_MAINTAINER_FOR_PROJECT: null,
          IS_DECLARED_MAINTAINER_FOR_ORG: null,
        },
      ],
    });
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
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-contributors:v4:all:all')!, JSON.stringify(legacy));

    const response = await service.getContributors(ACCOUNT, 'all', FILTERS);

    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});

describe('OrgPeopleContributorsService commit filters (lfx-self-serve#4164)', () => {
  function lastQuery(): string {
    return execute.mock.calls.at(-1)![0] as string;
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
      IS_DECLARED_MAINTAINER_FOR_PROJECT: false,
      IS_DECLARED_MAINTAINER_FOR_ORG: false,
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
    expect(execute.mock.calls.at(-1)![1]).toEqual([ACCOUNT]);
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

    expect(execute).toHaveBeenCalledTimes(1);
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
    execute.mockReset();
    execute.mockResolvedValue({ rows: [projectRow('commit-heavy', 50, 60), projectRow('review-heavy', 5, 400)] });

    const byCommits = await service.getContributors(ACCOUNT, '365d', FILTERS);
    const byCode = await service.getContributors(ACCOUNT, '365d', { ...FILTERS, metric: 'code' });

    expect(byCommits.contributors[0]).toMatchObject({ commits: 55, codeActivities: 460, mostActiveProjectName: 'commit-heavy' });
    expect(byCode.contributors[0]).toMatchObject({ commits: 55, codeActivities: 460, mostActiveProjectName: 'review-heavy' });
    expect(byCode.projects.map((project) => project.codeActivities)).toEqual([60, 400]);
  });
});
