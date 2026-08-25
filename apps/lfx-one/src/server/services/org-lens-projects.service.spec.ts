// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static getInstance() {
      return { execute };
    }
  },
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
    classifyHealthScore: actual.classifyHealthScore,
    normalizeHealthScoreCategoryV2: actual.normalizeHealthScoreCategoryV2,
  };
});

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
    HEALTH_OVERALL_SCORE: null,
    HEALTH_OVERALL_SCORE_V2: null,
    HEALTH_SCORE_CATEGORY_V2: null,
    HEALTH_CONTRIBUTOR_PERCENTAGE: null,
    HEALTH_POPULARITY_PERCENTAGE: null,
    HEALTH_DEVELOPMENT_PERCENTAGE: null,
    HEALTH_SECURITY_PERCENTAGE: null,
    DESCRIPTION: null,
    ...overrides,
  };
}

function mockProjectsRow(row: ReturnType<typeof projectsRow>): void {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('ORG_LENS_PROJECTS\n')) {
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

  it('classifies via the v1 score when no v2 category is present', async () => {
    mockProjectsRow(projectsRow({ HEALTH_OVERALL_SCORE: 90 }));

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('excellent');
  });

  it('prefers the warehouse v2 category over the v1 score when both are present', async () => {
    mockProjectsRow(projectsRow({ HEALTH_OVERALL_SCORE: 10, HEALTH_SCORE_CATEGORY_V2: 'Fair' }));

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('fair');
  });

  it('falls back to the raw v2 score when v1 is null and the v2 category is unrecognized', async () => {
    mockProjectsRow(projectsRow({ HEALTH_OVERALL_SCORE: null, HEALTH_OVERALL_SCORE_V2: 50, HEALTH_SCORE_CATEGORY_V2: 'Typo' }));

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('fair');
  });

  it('marks health unavailable when neither v1 nor v2 score is present', async () => {
    mockProjectsRow(projectsRow());

    const response = await service.getProjects(ACCOUNT_ID, ORG_NAME, null);

    expect(response.projects[0]?.health).toBe('unavailable');
  });
});
