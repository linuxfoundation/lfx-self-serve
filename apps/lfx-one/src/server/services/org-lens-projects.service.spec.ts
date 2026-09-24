// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, proxyRequest, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  proxyRequest: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// A minimal in-memory Valkey so a write really is serialized and a read really is parsed back —
// the only way a warm-vs-cold divergence can show up at all. Cleared before every test, so the
// describes that don't care about caching always see a miss.
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
// The real barrel (`@lfx-one/shared/utils`) re-exports every shared util, some of which touch Angular
// platform APIs that aren't available under this server-only, non-Angular vitest environment. Mock the
// barrel but delegate to the real implementations via a direct relative import, so this spec exercises
// actual classification logic instead of stubs.
vi.mock('@lfx-one/shared/utils', async () => {
  const insights = await import('../../../../../packages/shared/src/utils/insights.utils');
  // The compact-cache helpers are real too: `getProjects` encodes through them on every write, so
  // stubbing them here would make the round-trip assertions below vacuous.
  const compactCache = await import('../../../../../packages/shared/src/utils/compact-cache.utils');
  // `valkey.service`'s own key builders need these.
  const orgSelector = await import('../../../../../packages/shared/src/utils/org-selector.utils');
  return {
    normalizeHealthScoreCategoryV2: insights.normalizeHealthScoreCategoryV2,
    ...compactCache,
    ...orgSelector,
  };
});

import { DEFAULT_ORG_PROJECTS_WORKSPACE_NAME } from '@lfx-one/shared/constants';
import type { CompactOrgLensProjectsCache } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { OrgLensProjectsService } from './org-lens-projects.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT_ID = '0014100000Te2QjAAJ';
const ORG_NAME = 'Acme Corp';

beforeEach(() => {
  vi.stubEnv('VALKEY_KEY_NAMESPACE', '');
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  cacheValues.clear();
  ValkeyService.resetInstance();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

function projectsRow(overrides: Record<string, unknown> = {}) {
  return {
    ACCOUNT_ID,
    PROJECT_ID: 'proj-1',
    PROJECT_SLUG: 'k8s',
    PROJECT_NAME: 'Kubernetes',
    PROJECT_LOGO_URL: null,
    FOUNDATION_ID: null,
    FOUNDATION_SLUG: 'cncf',
    FOUNDATION_NAME: 'CNCF',
    FOUNDATION_LOGO_URL: null,
    TECHNICAL_INFLUENCE: null,
    ECOSYSTEM_INFLUENCE: null,
    INFLUENCE_SCORE: 0,
    PRIOR_YEAR_SCORE: 0,
    DELTA_PCT: 0,
    TECHNICAL_DELTA_PCT: 0,
    ECOSYSTEM_DELTA_PCT: 0,
    TREND_DIRECTION: null,
    COMBINED_SCORE_SERIES: null,
    DBT_RUN_AT: null,
    HEALTH_OVERALL_SCORE_V2: null,
    HEALTH_SCORE_CATEGORY_V2: null,
    COVERED_CATEGORY_COUNT_V2: null,
    HEALTH_MAX_SCORE_V2: null,
    HEALTH_MAINTAINER_V2: null,
    HEALTH_SECURITY_V2: null,
    HEALTH_DEVELOPMENT_V2: null,
    DESCRIPTION: null,
    ...overrides,
  };
}

function mockProjectsRow(row: ReturnType<typeof projectsRow>): void {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('ORG_LENS_PROJECTS')) {
      return { rows: [row] };
    }
    return { rows: [] };
  });
}

describe('OrgLensProjectsService health score mapping', () => {
  const service = new OrgLensProjectsService();

  beforeEach(() => {
    execute.mockReset();
  });

  it('uses the warehouse v2 category when present', async () => {
    mockProjectsRow(projectsRow({ HEALTH_OVERALL_SCORE_V2: 65, HEALTH_SCORE_CATEGORY_V2: 'Fair' }));

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('fair');
  });

  it('marks health unavailable when the v2 category is unrecognized (LFXV2-3379)', async () => {
    mockProjectsRow(projectsRow({ HEALTH_SCORE_CATEGORY_V2: 'Typo' }));

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('unavailable');
  });

  it('marks health unavailable when no v2 category is present', async () => {
    mockProjectsRow(projectsRow());

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('unavailable');
  });

  // Split rows: label and score must come from the same snapshot; either one missing is unavailable and every
  // health field is nulled so badge, popup, accessible name and CSV cannot disagree.
  it('marks health unavailable and nulls every health field when the label has no same-row score', async () => {
    mockProjectsRow(
      projectsRow({
        HEALTH_SCORE_CATEGORY_V2: 'Healthy',
        HEALTH_OVERALL_SCORE_V2: null,
        COVERED_CATEGORY_COUNT_V2: 2,
        HEALTH_MAX_SCORE_V2: 65,
        HEALTH_MAINTAINER_V2: 30,
      })
    );

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('unavailable');
    expect(response.projects[0]?.healthOverallScore).toBeNull();
    expect(response.projects[0]?.healthMaxScore).toBeNull();
    expect(response.projects[0]?.healthCoveredCategoryCount).toBeNull();
    expect(response.projects[0]?.healthMaintainer).toBeNull();
  });

  it('marks health unavailable and nulls every health field when the score has no same-row label', async () => {
    mockProjectsRow(
      projectsRow({
        HEALTH_SCORE_CATEGORY_V2: null,
        HEALTH_OVERALL_SCORE_V2: 52,
        COVERED_CATEGORY_COUNT_V2: 2,
        HEALTH_MAX_SCORE_V2: 65,
        HEALTH_MAINTAINER_V2: 30,
        HEALTH_SECURITY_V2: null,
        HEALTH_DEVELOPMENT_V2: 22,
      })
    );

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('unavailable');
    expect(response.projects[0]?.healthOverallScore).toBeNull();
    expect(response.projects[0]?.healthMaxScore).toBeNull();
    expect(response.projects[0]?.healthCoveredCategoryCount).toBeNull();
    expect(response.projects[0]?.healthMaintainer).toBeNull();
    expect(response.projects[0]?.healthSecurity).toBeNull();
    expect(response.projects[0]?.healthDevelopment).toBeNull();
  });

  it('passes the v2 score, max, covered count and category scores straight through from the warehouse', async () => {
    mockProjectsRow(
      projectsRow({
        HEALTH_OVERALL_SCORE_V2: 52,
        HEALTH_SCORE_CATEGORY_V2: 'Healthy',
        COVERED_CATEGORY_COUNT_V2: 2,
        HEALTH_MAX_SCORE_V2: 65,
        HEALTH_MAINTAINER_V2: 30,
        HEALTH_SECURITY_V2: null,
        HEALTH_DEVELOPMENT_V2: 22,
      })
    );

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('healthy');
    expect(response.projects[0]?.healthCoveredCategoryCount).toBe(2);
    expect(response.projects[0]?.healthMaxScore).toBe(65);
    expect(response.projects[0]?.healthOverallScore).toBe(52);
    expect(response.projects[0]?.healthMaintainer).toBe(30);
    expect(response.projects[0]?.healthSecurity).toBeNull();
    expect(response.projects[0]?.healthDevelopment).toBe(22);
  });

  it('passes through a full (3-category) score unchanged, not marked partial', async () => {
    mockProjectsRow(
      projectsRow({ HEALTH_OVERALL_SCORE_V2: 88, HEALTH_SCORE_CATEGORY_V2: 'Excellent', COVERED_CATEGORY_COUNT_V2: 3, HEALTH_MAX_SCORE_V2: 100 })
    );

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('excellent');
    expect(response.projects[0]?.healthCoveredCategoryCount).toBe(3);
    expect(response.projects[0]?.healthMaxScore).toBe(100);
  });
});

describe('OrgLensProjectsService.getWorkspaces', () => {
  const service = new OrgLensProjectsService();
  const req = {} as Request;
  const DEFAULT_WORKSPACE_UID = 'ws-default';

  interface QueryPage {
    resources: { data: Record<string, unknown> }[];
  }

  /** Routes query-service reads by `type`; member-service calls fall through to `onMemberService`. */
  function mockProxy(reads: { org_workspace: () => QueryPage; org_workspace_project: () => QueryPage }, onMemberService?: (path: string) => unknown): void {
    proxyRequest.mockImplementation(async (_req: Request, serviceName: string, path: string, _method: string, query?: Record<string, string>) => {
      if (serviceName === 'LFX_V2_SERVICE') {
        return reads[query?.['type'] as keyof typeof reads]();
      }
      if (!onMemberService) {
        throw new Error(`unexpected member-service call: ${path}`);
      }
      return onMemberService(path);
    });
  }

  function memberServiceCalls(): string[] {
    return proxyRequest.mock.calls.filter((call) => call[1] === 'LFX_V2_MEMBER_SERVICE').map((call) => `${call[3]} ${call[2]}`);
  }

  beforeEach(() => {
    execute.mockReset();
    proxyRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty list without bootstrapping when a non-editor has no workspaces', async () => {
    mockProxy({ org_workspace: () => ({ resources: [] }), org_workspace_project: () => ({ resources: [] }) });

    const response = await service.getWorkspaces(req, ACCOUNT_ID, false);

    expect(response).toEqual({ workspaces: [] });
    expect(memberServiceCalls()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the empty default workspace as indexed without seeding or retrying for a non-editor', async () => {
    execute.mockResolvedValue({ rows: [{ PROJECT_SLUG: 'k8s' }] });
    const projectReads = vi.fn(() => ({ resources: [] }));
    mockProxy({
      org_workspace: () => ({ resources: [{ data: { uid: DEFAULT_WORKSPACE_UID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME } }] }),
      org_workspace_project: projectReads,
    });

    // No fake timers: the empty-retry (two 1 s waits) exists for a seed write this caller never
    // performs, so the read must resolve on the first indexed answer.
    const response = await service.getWorkspaces(req, ACCOUNT_ID, false);

    expect(response).toEqual({ workspaces: [{ id: DEFAULT_WORKSPACE_UID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME, projectSlugs: [] }] });
    expect(projectReads).toHaveBeenCalledTimes(1);
    expect(memberServiceCalls()).toEqual([]);
  });

  it('bootstraps the default workspace for an editor with no workspaces', async () => {
    let created = false;
    execute.mockResolvedValue({ rows: [] });
    mockProxy(
      {
        org_workspace: () =>
          created ? { resources: [{ data: { uid: DEFAULT_WORKSPACE_UID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME } }] } : { resources: [] },
        org_workspace_project: () => ({ resources: [{ data: { project_slug: 'k8s' } }] }),
      },
      () => {
        created = true;
        return { workspace: { uid: DEFAULT_WORKSPACE_UID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME } };
      }
    );

    const response = await service.getWorkspaces(req, ACCOUNT_ID, true);

    expect(memberServiceCalls()).toEqual([`POST /b2b_orgs/${ACCOUNT_ID}/workspaces`]);
    expect(response.workspaces).toEqual([{ id: DEFAULT_WORKSPACE_UID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME, projectSlugs: ['k8s'] }]);
  });
});

describe('OrgLensProjectsService.getProjects compact cache (GH-1906)', () => {
  const service = new OrgLensProjectsService();
  const SLUGS = ['k8s', 'etcd', 'ghost'];

  /** One shared person across two projects, so a round trip has to survive the people dictionary. */
  function person(slug: string, id: string, role: string, name: string | null, avatar: string | null) {
    return { PROJECT_SLUG: slug, PARTICIPANT_ID: id, INVOLVEMENT_ROLE: role, PARTICIPANT_NAME: name, PARTICIPANT_AVATAR_URL: avatar };
  }

  function storedValue(): CompactOrgLensProjectsCache {
    return JSON.parse([...cacheValues.values()][0]) as CompactOrgLensProjectsCache;
  }

  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_LENS_PROJECT_PEOPLE')) {
        return {
          rows: [
            person('k8s', 'p-1', 'maintainer', 'Ada Lovelace', 'https://avatars.example.com/ada.png'),
            person('k8s', 'p-2', 'contributor', null, null),
            person('etcd', 'p-1', 'participant', 'Ada Lovelace', 'https://avatars.example.com/ada.png'),
          ],
        };
      }
      if (sql.includes('ORG_LENS_PROJECTS')) {
        return {
          rows: [
            projectsRow({ HEALTH_OVERALL_SCORE_V2: 88, HEALTH_SCORE_CATEGORY_V2: 'Excellent', COMBINED_SCORE_SERIES: [1, 2, 3] }),
            projectsRow({ PROJECT_ID: 'proj-2', PROJECT_SLUG: 'etcd', PROJECT_NAME: 'etcd', DESCRIPTION: 'A distributed key-value store.' }),
          ],
        };
      }
      // ONBOARDED_PROJECTS — hydrates the requested-but-absent slug as a no-activity row, which is
      // the only producer of the optional `noActivityYet` flag.
      return { rows: [projectsRow({ PROJECT_ID: 'proj-3', PROJECT_SLUG: 'ghost', PROJECT_NAME: 'Ghost' })] };
    });
  });

  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    const fromMiss = await service.getProjects(ACCOUNT_ID, ORG_NAME, SLUGS);
    const warehouseReads = execute.mock.calls.length;

    // The second call decodes the entry the first one stored, through the real serialize/parse
    // round trip the in-memory Valkey fixture performs — and, because `withCompactCache` returns a
    // miss's value uncoded, these two really are different computations.
    const fromHit = await service.getProjects(ACCOUNT_ID, ORG_NAME, SLUGS);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    // `toStrictEqual` distinguishes null from undefined from an absent key — the absent-vs-null
    // distinction this fixture exercises via `noActivityYet`, which the two real rows omit and the
    // hydrated `ghost` row sets.
    expect(fromHit).toStrictEqual(fromMiss);
    // The serialized comparison additionally pins key ORDER: `decodeProjectsResponse` deliberately
    // rebuilds each project in `mapProject`'s field order and appends `noActivityYet` last, exactly
    // as `fetchNoActivityProjects` does. Reordering either list breaks this — deliberately, since a
    // warm and a cold cache must put the same bytes on the wire.
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(fromMiss.projects.map((project) => project.noActivityYet)).toEqual([undefined, undefined, true]);
    expect(fromMiss.projects[0]?.maintainers).toEqual([{ id: 'p-1', name: 'Ada Lovelace', avatarUrl: 'https://avatars.example.com/ada.png' }]);
  });

  it('stores each person once no matter how many projects reference them', async () => {
    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    // `p-1` appears in two projects; the dictionary is what keeps the largest org's payload under
    // the write cap, so a regression that inlined people again must fail here.
    expect(storedValue().people.r).toEqual([
      ['p-1', 'Ada Lovelace', 'https://avatars.example.com/ada.png'],
      ['p-2', 'p-2', ''],
    ]);
  });

  it('serves but does not store a response whose no-activity hydration failed', async () => {
    // `fetchProjects` degrades to activity rows only when the onboarded-catalog read fails, which
    // is the right answer for one request and the wrong one for an hour: the response is silently
    // missing projects the caller explicitly asked for. Now that compaction brings the largest orgs
    // under the write cap for the first time, that response would actually get stored.
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ONBOARDED_PROJECTS')) {
        throw new Error('onboarded catalog unavailable');
      }
      if (sql.includes('ORG_LENS_PROJECT_PEOPLE')) {
        return { rows: [] };
      }
      return { rows: [projectsRow()] };
    });

    const degraded = await service.getProjects(ACCOUNT_ID, ORG_NAME, ['k8s', 'ghost']);

    expect(degraded.projects.map((project) => project.slug)).toEqual(['k8s']);
    expect(cacheValues.size).toBe(0);

    // And the next call refetches rather than replaying the gap.
    const warehouseReads = execute.mock.calls.length;
    await service.getProjects(ACCOUNT_ID, ORG_NAME, ['k8s', 'ghost']);
    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('keeps two people whose fields differ only in where a NUL falls', async () => {
    // Any single-character separator is a legal character inside a display name or an avatar URL,
    // so joining the triple with one is ambiguous: these two people join to the same string and a
    // delimiter-keyed dictionary would store one and hand it back for both.
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_LENS_PROJECT_PEOPLE')) {
        return {
          rows: [person('k8s', 'p-1', 'maintainer', 'a\u0000b', 'c'), person('k8s', 'p-1', 'maintainer', 'a', 'b\u0000c')],
        };
      }
      if (sql.includes('ORG_LENS_PROJECTS')) {
        return { rows: [projectsRow()] };
      }
      return { rows: [] };
    });
    const fromMiss = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    const fromHit = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(storedValue().people.r).toHaveLength(2);
    expect(fromHit.projects[0]?.maintainers).toEqual([
      { id: 'p-1', name: 'a\u0000b', avatarUrl: 'c' },
      { id: 'p-1', name: 'a', avatarUrl: 'b\u0000c' },
    ]);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it.each([
    ['a non-string slug', 'slug', 42],
    ['an unknown metricsState', 'metricsState', 'partial'],
    ['a non-numeric healthOverallScore', 'healthOverallScore', '88'],
    ['an unrecognized health band', 'health', 'golden'],
    ['a non-numeric healthMaxScore', 'healthMaxScore', 'many'],
  ])('treats a stored entry with %s as a miss', async (_label, column, corruptValue) => {
    // Exact columns prove the shape, not the values. Without the per-value checks the pre-change
    // guard made, a corrupt entry decodes into a project the browser then renders — a blank badge,
    // a broken popup denominator, or a slug that is not a string at all.
    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);
    const [key] = [...cacheValues.keys()];
    const stored = storedValue();
    stored.projects.r = stored.projects.r.map((row) => {
      const corrupted = [...row];
      corrupted[stored.projects.k.indexOf(column)] = corruptValue;
      return corrupted;
    });
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into
    // projects missing data, so the guard has to reject the entry up front rather than render a
    // page with holes in it for the rest of the TTL.
    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);
    const [key] = [...cacheValues.keys()];
    const stored = storedValue();
    stored.people.k = [...stored.people.k, 'id'];
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it.each([
    ['an index past the end of the people dictionary', (stored: CompactOrgLensProjectsCache) => (stored.maintainers = [[stored.people.r.length]])],
    ['a negative index', (stored: CompactOrgLensProjectsCache) => (stored.maintainers = [[-1]])],
    ['a non-integer index', (stored: CompactOrgLensProjectsCache) => (stored.maintainers = [[1.5]])],
    ['an index list shorter than the projects', (stored: CompactOrgLensProjectsCache) => (stored.maintainers = [])],
  ])('treats a stored entry with %s as a miss', async (_label, corrupt) => {
    // The decode resolves each reference without a fallback, so an unresolvable one would emit a
    // project whose maintainers are `undefined`. The guard has to reject the entry instead.
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => (sql.includes('ORG_LENS_PROJECTS') ? { rows: [projectsRow()] } : { rows: [] }));
    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);
    const [key] = [...cacheValues.keys()];
    const stored = storedValue();
    corrupt(stored);
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('round-trips an org with no projects unchanged', async () => {
    // The empty envelope has to survive its own guard: rejecting it would make an org with no
    // onboarded projects refetch on every request forever.
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    const fromHit = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  it('fetches directly, reading and writing nothing, when Valkey is disabled', async () => {
    // `withCompactCache` must bypass entirely rather than encode into a client that is not there.
    vi.stubEnv('VALKEY_URL', '');
    ValkeyService.resetInstance();

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects.map((project) => project.slug)).toEqual(['k8s', 'etcd']);
    expect(cacheValues.size).toBe(0);
  });

  it('treats a pre-compaction cached response as a miss rather than decoding it', async () => {
    // A `v6` entry is the full response object. Nothing evicts it on deploy other than the key
    // change, so the guard has to reject the shape too — decoding one would read `projects.k`/
    // `projects.r` off an array and serve an empty page for the whole TTL.
    const legacy = { orgSlug: 'acme', orgName: ORG_NAME, dataUpdatedAt: '2026-01-01T00:00:00.000Z', projects: [{ slug: 'k8s', name: 'Kubernetes' }] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT_ID, `projects:v7:${encodeURIComponent(ORG_NAME)}|__top__`)!, JSON.stringify(legacy));

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects.map((project) => project.slug)).toEqual(['k8s', 'etcd']);
    expect(execute).toHaveBeenCalled();
  });
});
