// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, withOrgCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  // Pass-through that keeps the `storable` predicate the service hands over, so a test can ask it.
  withOrgCache: vi.fn<
    (accountId: string, key: string, ttl: number, fetcher: () => Promise<unknown>, accept?: unknown, storable?: (value: unknown) => boolean) => Promise<unknown>
  >(async (...args) => args[3]()),
}));

// The utils barrel pulls Angular into this plain-Node run; the real range helpers are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('./valkey.service', () => ({ withOrgCache }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const { OrgLensFoundationsService } = await import('./org-lens-foundations.service');

const MISSING_ROLES = "SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.";

function projectRow(projectId: string, isLf: boolean): Record<string, unknown> {
  return {
    ACCOUNT_ID: 'acc-1',
    ACCOUNT_NAME: 'Acme',
    FOUNDATION_ID: 'cncf',
    FOUNDATION_SLUG: 'cncf',
    FOUNDATION_NAME: 'CNCF',
    ROW_KIND: 'member',
    PROJECT_ID: projectId,
    PROJECT_SLUG: projectId,
    PROJECT_NAME: projectId,
    PROJECT_IS_LF_PROJECT: isLf,
    PROJECT_INFLUENCE_MAX_BUCKET: 'Leading',
  };
}

describe('OrgLensFoundationsService maintainer roles (lfx-self-serve#4482)', () => {
  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
  });

  it('reads LF roles over the last 2 years on their own, binding the account then 730 days', async () => {
    execute.mockImplementation(async (sql: string) =>
      sql.includes('ORG_MAINTAINER_ROLES')
        ? {
            rows: [
              { PROJECT_ID: 'lf-project', MAINTAINER_ROLES: 4 },
              { PROJECT_ID: 'non-lf-project', MAINTAINER_ROLES: 9 },
            ],
          }
        : { rows: [projectRow('lf-project', true), projectRow('non-lf-project', false)] }
    );

    const response = await new OrgLensFoundationsService().getFoundationsAndProjects('acc-1');

    expect(response.rows[0]?.projects.map((project) => [project.projectId, project.maintainers])).toEqual([
      ['lf-project', 4],
      ['non-lf-project', 0],
    ]);
    const [rolesSql, rolesBinds] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_MAINTAINER_ROLES'))!;
    expect(rolesSql).toContain('IS_LF_PROJECT = TRUE');
    expect(rolesBinds).toEqual(['acc-1', 730]);
    const [mainSql, mainBinds] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_LENS_FOUNDATIONS_AND_PROJECTS'))!;
    expect(mainSql).not.toContain('ORG_MAINTAINER_ROLES');
    expect(mainBinds).toEqual(['acc-1']);
  });

  it('serves the section with unavailable (null) roles, not zero, and never stores it, when the roles table is missing', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES')) throw new Error(MISSING_ROLES);
      return { rows: [projectRow('lf-project', true), projectRow('non-lf-project', false)] };
    });

    const response = await new OrgLensFoundationsService().getFoundationsAndProjects('acc-1');

    expect(response.rows[0]?.projects.map((project) => [project.projectId, project.maintainers])).toEqual([
      ['lf-project', null],
      ['non-lf-project', 0],
    ]);
    const storable = withOrgCache.mock.calls[0]?.[5];
    expect(storable?.(response)).toBe(false);
  });

  // lfx-self-serve#4685: the company's per-project roles leave team members out, as the Overview's Maintainer roles card.
  it("leaves CDP team members' roles out of the per-project counts, under a new cache key", async () => {
    execute.mockImplementation(async (sql: string) =>
      sql.includes('ORG_MAINTAINER_ROLES') ? { rows: [{ PROJECT_ID: 'lf-project', MAINTAINER_ROLES: 2 }] } : { rows: [projectRow('lf-project', true)] }
    );

    await new OrgLensFoundationsService().getFoundationsAndProjects('acc-1');

    const [rolesSql, , options] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_MAINTAINER_ROLES'))!;
    expect(rolesSql).toContain('AND NOT IS_CDP_TEAM_MEMBER');
    expect(options).toMatchObject({ expectMissingObject: 'ORG_MAINTAINER_ROLES', expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    expect(withOrgCache.mock.calls[0]?.[1]).toBe('foundations:v4');
  });

  it('counts team members, and never stores the section, while the roles table has no team-member flag yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('IS_CDP_TEAM_MEMBER'))
        throw Object.assign(new Error("SQL compilation error:\ninvalid identifier 'IS_CDP_TEAM_MEMBER'"), { code: '000904' });
      return sql.includes('ORG_MAINTAINER_ROLES') ? { rows: [{ PROJECT_ID: 'lf-project', MAINTAINER_ROLES: 5 }] } : { rows: [projectRow('lf-project', true)] };
    });

    const response = await new OrgLensFoundationsService().getFoundationsAndProjects('acc-1');

    expect(response.rows[0]?.projects.map((project) => project.maintainers)).toEqual([5]);
    expect(withOrgCache.mock.calls[0]?.[5]?.(response)).toBe(false);
  });

  it('still fails on any other error from the roles read', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES')) throw new Error('Warehouse timeout');
      return { rows: [projectRow('lf-project', true)] };
    });

    await expect(new OrgLensFoundationsService().getFoundationsAndProjects('acc-1')).rejects.toThrow('Warehouse timeout');
  });
});
