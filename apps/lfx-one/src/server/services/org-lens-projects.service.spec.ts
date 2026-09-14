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
