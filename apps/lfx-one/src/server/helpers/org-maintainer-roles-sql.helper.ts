// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_OVERVIEW_MAINTAINER_ROLES_RANGE } from '@lfx-one/shared/constants/org-maintainer-roles.constants';
import type { OrgLensTimeRange, OrgMaintainerRoleOverlap, OrgMaintainerRolesJoin } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils/org-lens-time-range.utils';

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
 * `LEFT JOIN` of the account's LF maintainer roles per project overlapping the Overview window (past 365 days), exposing
 * `${alias}.MAINTAINER_ROLES` (NULL for a project without any) — the per-project count of the Overview's Foundations &
 * Projects and the Memberships projects drawer. Binds the account, then the overlap's range length.
 */
export function orgLfProjectMaintainerRolesJoin(accountId: string, projectIdColumn: string, alias = 'roles'): OrgMaintainerRolesJoin {
  const overlap = orgMaintainerRoleOverlap(ORG_OVERVIEW_MAINTAINER_ROLES_RANGE);
  return {
    sql: `LEFT JOIN (
        SELECT PROJECT_ID, COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
        WHERE ACCOUNT_ID = ? AND IS_LF_PROJECT = TRUE AND ${overlap.sql}
        GROUP BY PROJECT_ID
      ) ${alias}
        ON ${alias}.PROJECT_ID = ${projectIdColumn}`,
    binds: [accountId, ...overlap.binds],
  };
}
