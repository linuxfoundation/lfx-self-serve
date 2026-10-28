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

  it('shapes the foundation-projects detail rows behind the Org Projects count', async () => {
    execute.mockResolvedValue({
      rows: [
        {
          PROJECT_ID: 'p-1',
          PROJECT_SLUG: 'kubernetes',
          PROJECT_NAME: 'Kubernetes',
          IS_LF_PROJECT: true,
          INFLUENCE_MAX_BUCKET: 'Leading',
          MAINTAINER_ROLES: 2,
          CONTRIBUTORS_COUNT: 9,
          COLLABORATORS_COUNT: 4,
          COMMITS_COUNT: 120,
        },
      ],
    });

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

    const [query, binds] = execute.mock.calls[0];
    expect(query).toContain('ORG_LENS_FOUNDATION_PROJECTS_DETAIL');
    expect(query).toContain('WHERE p.ACCOUNT_ID = ?');
    expect(query).toContain('AND p.FOUNDATION_ID = ?');
    // The roles join comes first in the text, so its binds (account, then the 365-day range) lead.
    expect(binds).toEqual(['acc-1', 365, 'acc-1', 'cncf']);
  });

  it('scopes the cache entry per foundation', async () => {
    execute.mockResolvedValue({ rows: [] });
    const service = new OrgLensMembershipsService();

    await service.getFoundationProjects('acc-1', 'cncf');
    await service.getFoundationProjects('acc-1', 'lf-edge');

    expect(cacheKeys).toEqual(['memberships-projects:v2:cncf', 'memberships-projects:v2:lf-edge']);
  });

  it('counts maintainers per project as LF maintainer roles overlapping the past 365 days, joined on the project id', async () => {
    execute.mockResolvedValue({ rows: [{ PROJECT_ID: 'p-2', IS_LF_PROJECT: false, INFLUENCE_MAX_BUCKET: 'Silent', MAINTAINER_ROLES: null }] });

    const { projects } = await new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf');

    const [query] = execute.mock.calls[0];
    expect(query).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES');
    expect(query).toContain('COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES');
    expect(query).toContain('IS_LF_PROJECT = TRUE');
    expect(query).toContain('ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE())');
    expect(query).toContain('ON roles.PROJECT_ID = p.PROJECT_ID');
    expect(projects[0]?.maintainers).toBe(0);
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
