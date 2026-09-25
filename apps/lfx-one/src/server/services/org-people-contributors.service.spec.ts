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

import type { CompactOrgContributorRowsCache } from '@lfx-one/shared/interfaces';

import { OrgPeopleContributorsService } from './org-people-contributors.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = '0014100000Te2ovAAB';

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
    const fromMiss = await service.getContributors(ACCOUNT, 'all');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getContributors(ACCOUNT, 'all');

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
    await service.getContributors(ACCOUNT, 'all');
    const warehouseReads = execute.mock.calls.length;

    const { projects, projectOptions, foundationOptions } = await service.getContributors(ACCOUNT, 'all');

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
    await service.getContributors(ACCOUNT, 'all');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgContributorRowsCache;
    stored.rows.r = stored.rows.r.map((row) => row.slice(0, -1));
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getContributors(ACCOUNT, 'all');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('keys each time range separately so one window cannot serve another', async () => {
    await service.getContributors(ACCOUNT, 'all');
    await service.getContributors(ACCOUNT, '30d');

    expect([...cacheValues.keys()]).toEqual([buildOrgCacheKey(ACCOUNT, 'people-contributors:v2:all'), buildOrgCacheKey(ACCOUNT, 'people-contributors:v2:30d')]);
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
    await service.getContributors(ACCOUNT, 'all');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgContributorRowsCache;
    corrupt(stored);
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getContributors(ACCOUNT, 'all');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('round-trips an empty result unchanged', async () => {
    // The empty envelope has to survive its own guard: rejecting it would make an org with no rows
    // refetch on every request forever.
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getContributors(ACCOUNT, 'all');

    const fromHit = await service.getContributors(ACCOUNT, 'all');

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  // Every required cell the guard checks, crossed with every way a cell can be corrupt, so dropping
  // any one of the three checks fails a case here.
  it.each(
    (
      [
        ['rows', 'PERSON_KEY'],
        ['rows', 'CDP_MEMBER_ID'],
        ['projects', 'PROJECT_ID'],
      ] as const
    ).flatMap(([table, column]) =>
      (
        [
          ['absent', '\u0000'],
          ['a number', 42],
          ['an object', {}],
        ] as const
      ).map(([label, corrupt]) => [table, column, label, corrupt] as const)
    )
  )('treats a stored entry whose required %s.%s cell is %s as a miss', async (table, column, _label, corrupt) => {
    // Exact columns prove the shape, not the value. A required cell that never arrived, or arrived
    // as the wrong type, decodes into a row the mapper then reads — so it has to be a miss.
    await service.getContributors(ACCOUNT, 'all');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgContributorRowsCache;
    const target = stored[table];
    const index = target.k.indexOf(column);
    target.r = target.r.map((row) => row.map((cell, position) => (position === index ? corrupt : cell)));
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getContributors(ACCOUNT, 'all');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('caches a row whose CDP_MEMBER_ID aggregate came back null instead of missing forever', async () => {
    // `MIN(cdp_member_id)` over an all-NULL group returns NULL, and the uncached path passes it
    // straight through. A guard stricter than that would turn this org into a permanent miss.
    const { rows } = (await execute()) as { rows: Record<string, unknown>[] };
    execute.mockReset();
    execute.mockResolvedValue({ rows: rows.map((row, index) => (index === 0 ? { ...row, CDP_MEMBER_ID: null } : row)) });
    const fromMiss = await service.getContributors(ACCOUNT, 'all');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getContributors(ACCOUNT, 'all');

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
          CODE_ACTIVITIES: null,
          LAST_ACTIVE_DATE: null,
          IS_DECLARED_MAINTAINER_FOR_PROJECT: null,
          IS_DECLARED_MAINTAINER_FOR_ORG: null,
        },
      ],
    });
    const fromMiss = await service.getContributors(ACCOUNT, 'all');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getContributors(ACCOUNT, 'all');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('treats a pre-compaction cached entry as a miss rather than decoding it', async () => {
    // `v1` stored the bare row array. Reading `projects`/`rows` off an array yields undefined, so
    // the guard — not just the key bump — has to reject it.
    const legacy = [{ PERSON_KEY: 'stale', PROJECT_ID: 'stale-project' }];
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-contributors:v2:all')!, JSON.stringify(legacy));

    const response = await service.getContributors(ACCOUNT, 'all');

    expect(response.contributors.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});
