// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_ORG_TEAM_MEMBERS, ORG_OVERVIEW_MAINTAINER_ROLES_RANGE } from '@lfx-one/shared/constants';
import type {
  OrgLensTimeRange,
  OrgMaintainerRoleOverlap,
  OrgMaintainerRolesTable,
  OrgProjectMaintainerRolesCountRow,
  SnowflakeQueryOptions,
} from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';

import type { SnowflakeService } from '../services/snowflake.service';
import { isMissingObjectError } from './snowflake-error.helper';
import { orgTeamMembersPredicate, orgTeamMembersQueryOptions, readWithOrgTeamMembersFallback } from './org-team-members.helper';

/**
 * The one rule for whether a maintainer role counts in a range (lfx-self-serve#4482, LFX Insights' rule): it has
 * started by today and has not ended before the range starts. `all` keeps every role that has started. The range
 * start is bound, never inlined; `alias` qualifies the ORG_MAINTAINER_ROLES columns when the read joins it.
 */
export function orgMaintainerRoleOverlap(range: OrgLensTimeRange, alias?: string): OrgMaintainerRoleOverlap {
  const column = (name: string): string => (alias ? `${alias}.${name}` : name);
  const started = `${column('ROLE_START_DATE')} <= CURRENT_DATE()`;
  if (range === 'all') {
    return { sql: started, binds: [] };
  }
  return {
    sql: `${started} AND (${column('ROLE_END_DATE')} IS NULL OR ${column('ROLE_END_DATE')} >= DATEADD(day, 0 - ?, CURRENT_DATE()))`,
    binds: [orgLensTimeRangeDays(range)],
  };
}

/**
 * Runs a read of a maintainer roles table, answering `null` when that table does not exist (yet): the tables ship
 * from lf-dbt ahead of this app, and a view must keep loading without its maintainer counts rather than fail. Any
 * other error — including a different missing object in the same statement — still rejects. `options` adds the
 * caller's own expected rollout errors (e.g. a not-yet-built column).
 */
export async function readMaintainerRoles<T>(
  snowflakeService: SnowflakeService,
  table: OrgMaintainerRolesTable,
  sql: string,
  binds: (string | number)[],
  options?: SnowflakeQueryOptions
): Promise<T[] | null> {
  try {
    return (await snowflakeService.execute<T>(sql, binds, { ...options, expectMissingObject: table })).rows;
  } catch (error) {
    if (isMissingObjectError(error, table)) return null;
    throw error;
  }
}

/**
 * The account's LF maintainer roles per project overlapping the Overview window (last 2 years), keyed by project id —
 * the per-project count of the Overview's Foundations & Projects and the Memberships projects drawer. CDP team
 * members' roles are left out, the Overview default and LFX Insights' rule (lfx-self-serve#4685). `roles` is `null`
 * when the roles table is missing; `teamMembersUnavailable` when its team-member flag is (team members then counted).
 * Either way the caller must not cache the answer. Its own read, so a missing table never takes the project list down.
 */
export async function fetchLfProjectMaintainerRoles(
  snowflakeService: SnowflakeService,
  accountId: string
): Promise<{ roles: Map<string, number> | null; teamMembersUnavailable: boolean }> {
  const overlap = orgMaintainerRoleOverlap(ORG_OVERVIEW_MAINTAINER_ROLES_RANGE);
  const { value: rows, teamMembersUnavailable } = await readWithOrgTeamMembersFallback(
    DEFAULT_ORG_TEAM_MEMBERS,
    'read_org_project_maintainer_roles',
    (teamMembers) =>
      readMaintainerRoles<OrgProjectMaintainerRolesCountRow>(
        snowflakeService,
        'ORG_MAINTAINER_ROLES',
        `
      SELECT PROJECT_ID, COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
      WHERE ACCOUNT_ID = ? AND IS_LF_PROJECT = TRUE AND ${overlap.sql}
        ${orgTeamMembersPredicate(teamMembers, 'IS_CDP_TEAM_MEMBER')}
      GROUP BY PROJECT_ID
    `,
        [accountId, ...overlap.binds],
        orgTeamMembersQueryOptions(teamMembers)
      )
  );
  return { roles: rows === null ? null : new Map(rows.map((row) => [row.PROJECT_ID, row.MAINTAINER_ROLES ?? 0])), teamMembersUnavailable };
}
