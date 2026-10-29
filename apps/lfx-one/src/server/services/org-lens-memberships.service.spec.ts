// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factories below can reference them.
const { execute, withOrgCacheMock, cacheKeys } = vi.hoisted(() => {
  const keys: string[] = [];
  return {
    execute: vi.fn(),
    cacheKeys: keys,
    // Pass-through: records the sub-resource the service asked for, then runs the fetcher.
    withOrgCacheMock: vi.fn(async (_accountId: string, subResource: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      keys.push(subResource);
      return fetcher();
    }),
  };
});

// The utils barrel pulls Angular into this plain-Node run; the real range helpers are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('./valkey.service', () => ({ withOrgCache: withOrgCacheMock }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./org-lens-key-contacts.service', () => ({ OrgLensKeyContactsService: class {} }));

const { OrgLensMembershipsService } = await import('./org-lens-memberships.service');

describe('OrgLensMembershipsService.getFoundationProjects', () => {
  beforeEach(() => {
    execute.mockReset();
    withOrgCacheMock.mockClear();
    cacheKeys.length = 0;
  });

  it('shapes the foundation-projects detail rows behind the Org Projects count, with LF maintainer roles from their own read', async () => {
    execute.mockImplementation(async (sql: string) =>
      sql.includes('ORG_MAINTAINER_ROLES')
        ? { rows: [{ PROJECT_ID: 'p-1', MAINTAINER_ROLES: 2 }] }
        : {
            rows: [
              {
                PROJECT_ID: 'p-1',
                PROJECT_SLUG: 'kubernetes',
                PROJECT_NAME: 'Kubernetes',
                IS_LF_PROJECT: true,
                INFLUENCE_MAX_BUCKET: 'Leading',
                CONTRIBUTORS_COUNT: 9,
                COLLABORATORS_COUNT: 4,
                COMMITS_COUNT: 120,
              },
            ],
          }
    );

    const result = await new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf');

    expect(result).toEqual({
      accountId: 'acc-1',
      foundationId: 'cncf',
      projects: [
        {
          projectId: 'p-1',
          projectSlug: 'kubernetes',
          projectName: 'Kubernetes',
          isLfProject: true,
          influence: 'Leading',
          maintainers: 2,
          contributors: 9,
          collaborators: 4,
          commits: 120,
        },
      ],
    });

    const [query, binds] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_LENS_FOUNDATION_PROJECTS_DETAIL'))!;
    expect(query).toContain('WHERE ACCOUNT_ID = ?');
    expect(query).toContain('AND FOUNDATION_ID = ?');
    expect(query).not.toContain('ORG_MAINTAINER_ROLES');
    expect(binds).toEqual(['acc-1', 'cncf']);
    const [rolesQuery, rolesBinds] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_MAINTAINER_ROLES'))!;
    expect(rolesQuery).toContain('COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES');
    expect(rolesQuery).toContain('IS_LF_PROJECT = TRUE');
    expect(rolesQuery).toContain('ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE())');
    expect(rolesBinds).toEqual(['acc-1', 365]);
  });

  it('keeps listing the projects, with unavailable (null) roles and uncached, when the roles table is missing', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      return {
        rows: [
          { PROJECT_ID: 'p-1', IS_LF_PROJECT: true, INFLUENCE_MAX_BUCKET: 'Leading' },
          { PROJECT_ID: 'p-2', IS_LF_PROJECT: false, INFLUENCE_MAX_BUCKET: 'Silent' },
        ],
      };
    });

    const { projects } = await new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf');

    expect(projects.map((project) => [project.projectId, project.maintainers])).toEqual([
      ['p-1', null],
      ['p-2', 0],
    ]);
    const storable = (withOrgCacheMock.mock.calls[0] as unknown[] | undefined)?.[5] as ((value: unknown) => boolean) | undefined;
    expect(storable?.([])).toBe(false);
  });

  it('scopes the cache entry per foundation', async () => {
    execute.mockResolvedValue({ rows: [] });
    const service = new OrgLensMembershipsService();

    await service.getFoundationProjects('acc-1', 'cncf');
    await service.getFoundationProjects('acc-1', 'lf-edge');

    expect(cacheKeys).toEqual(['memberships-projects:v3:cncf', 'memberships-projects:v3:lf-edge']);
  });

  it('returns an empty envelope rather than failing when the org has no projects for the foundation', async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf')).resolves.toEqual({
      accountId: 'acc-1',
      foundationId: 'cncf',
      projects: [],
    });
  });
});
