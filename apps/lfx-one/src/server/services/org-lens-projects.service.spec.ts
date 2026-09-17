// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, proxyRequest } = vi.hoisted(() => ({ execute: vi.fn(), proxyRequest: vi.fn() }));

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
vi.mock('./valkey.service', () => ({
  buildOrgCacheKey: () => null,
  valkeyService: { getJson: vi.fn(), setJson: vi.fn() },
}));
// The real barrel (`@lfx-one/shared/utils`) re-exports every shared util, some of which touch Angular
// platform APIs that aren't available under this server-only, non-Angular vitest environment. Mock the
// barrel but delegate to the real implementations via a direct relative import, so this spec exercises
// actual classification logic instead of stubs.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/insights.utils');
  return {
    normalizeHealthScoreCategoryV2: actual.normalizeHealthScoreCategoryV2,
  };
});

import { DEFAULT_ORG_PROJECTS_WORKSPACE_NAME } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { OrgLensProjectsService } from './org-lens-projects.service';

const ACCOUNT_ID = '0014100000Te2QjAAJ';
const ORG_NAME = 'Acme Corp';

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
